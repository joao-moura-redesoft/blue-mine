import { useCallback, useEffect, useRef, useState } from 'react';
import { initLoginFlow, pollLoginFlow, saveTalkAuth, type TalkAuth } from '../api/talk';

// O Nextcloud invalida o token do Login Flow sozinho depois de alguns minutos.
// Sem um teto aqui, o poll de 2s girava para sempre e a tela ficava eternamente
// em "aguardando", mesmo com a autorização já impossível de concluir.
const FLOW_TIMEOUT_MS = 3 * 60_000;
const POLL_INTERVAL_MS = 2000;
// Falha de rede pontual não deve abortar; falha persistente precisa aparecer.
const MAX_CONSECUTIVE_ERRORS = 5;

export type FlowPhase = 'idle' | 'starting' | 'waiting' | 'error' | 'done';

/**
 * Login Flow v2 do Nextcloud: abre a autorização no navegador e fica perguntando
 * ao servidor se o usuário concluiu.
 *
 * Centralizado num hook porque a versão anterior vivia dentro do SettingsModal e
 * engolia TODO erro do poll (`catch {}`) sem timeout — se a sessão do Redmine
 * caísse no meio (o poll grava usando o uid do Redmine), ele repetia a cada 2s
 * indefinidamente sem nunca dizer o que houve.
 */
export function useTalkLoginFlow(onDone?: (auth: TalkAuth) => void) {
  const [phase, setPhase] = useState<FlowPhase>('idle');
  const [error, setError] = useState('');
  const [loginUrl, setLoginUrl] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const paramsRef = useRef<{ pollEndpoint: string; pollToken: string } | null>(null);
  const deadlineRef = useRef(0);
  const failuresRef = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    paramsRef.current = null;
  }, []);

  // Não deixa o poll rodando depois que o componente sai da tela.
  useEffect(() => stop, [stop]);

  const fail = useCallback(
    (msg: string) => {
      stop();
      setError(msg);
      setPhase('error');
    },
    [stop],
  );

  const start = useCallback(
    async (rawUrl: string) => {
      const base = rawUrl.trim().replace(/\/$/, '');
      if (!base) return;
      stop();
      setError('');
      setPhase('starting');

      let flow;
      try {
        flow = await initLoginFlow(base);
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        fail(
          status === 401
            ? 'Sua sessão do Bluemine expirou. Entre no app novamente e refaça a conexão.'
            : 'Não foi possível falar com o Nextcloud. Confira o endereço e tente de novo.',
        );
        return;
      }

      setLoginUrl(flow.loginUrl);
      window.open(flow.loginUrl, '_blank', 'noopener');
      paramsRef.current = { pollEndpoint: flow.pollEndpoint, pollToken: flow.pollToken };
      deadlineRef.current = Date.now() + FLOW_TIMEOUT_MS;
      failuresRef.current = 0;
      setPhase('waiting');

      timerRef.current = setInterval(async () => {
        const params = paramsRef.current;
        if (!params) return;

        if (Date.now() > deadlineRef.current) {
          fail('A autorização expirou antes de ser concluída. Clique para tentar de novo.');
          return;
        }

        try {
          const result = await pollLoginFlow(params.pollEndpoint, params.pollToken);
          failuresRef.current = 0;
          if (!result.done) return;

          stop();
          const auth = { url: result.server.replace(/\/$/, ''), user: result.user };
          saveTalkAuth(auth); // dispara TALK_AUTH_CHANGED → o chat volta sem recarregar
          setPhase('done');
          onDoneRef.current?.(auth);
        } catch (e: unknown) {
          const status = (e as { response?: { status?: number } })?.response?.status;
          // 401 aqui é a sessão do Redmine, não o Talk: insistir não adianta.
          if (status === 401) {
            fail('Sua sessão do Bluemine expirou. Entre no app novamente e refaça a conexão.');
            return;
          }
          if (++failuresRef.current >= MAX_CONSECUTIVE_ERRORS) {
            fail('A conexão com o servidor falhou várias vezes seguidas. Tente de novo.');
          }
        }
      }, POLL_INTERVAL_MS);
    },
    [fail, stop],
  );

  const cancel = useCallback(() => {
    stop();
    setError('');
    setPhase('idle');
  }, [stop]);

  const reopen = useCallback(() => {
    if (loginUrl) window.open(loginUrl, '_blank', 'noopener');
  }, [loginUrl]);

  return { phase, error, loginUrl, start, cancel, reopen };
}
