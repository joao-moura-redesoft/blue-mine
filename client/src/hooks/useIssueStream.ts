import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Canal SSE que avisa quando as tarefas mudaram no Redmine.
 *
 * O servidor já varre o Redmine a cada 60s para o Web Push; antes disto o
 * cliente varria de novo, sozinho, a cada 60-90s — o mesmo trabalho duas vezes.
 * Agora o servidor avisa e o cliente rebusca sob demanda.
 *
 * Recebemos INVALIDAÇÃO, não dados: as rotas do cliente continuam sendo a fonte
 * da verdade (a varredura do push usa `status_id: 'open'`, enquanto o quadro
 * precisa de `'*'` com as colunas fechadas). Assim nenhum filtro muda e não há
 * risco de a tela ficar com um subconjunto do que deveria.
 *
 * `connected` é o que autoriza o resto do app a afrouxar os intervalos. Sem
 * canal — PUSH_ENABLED=0, sem inscrição, servidor reiniciando — ele volta a
 * false e o polling de segurança reassume. O EventSource reconecta sozinho.
 */
const QUERIES_A_INVALIDAR = [
  ['issues'],
  ['issues-monitored'],
  ['issues-authored'],
  ['issues-to-review'],
  ['issues-watched-local'],
  ['issues-mentions'],
];

// ── Estado do canal, fora do React ────────────────────────────────────────────
// As queries em useRedmine.ts precisam saber se o canal está de pé para escolher
// o intervalo, e elas são chamadas em vários componentes — passar isso por props
// espalharia o acoplamento. Mesmo padrão do disjuntor do Talk.
let streamConnected = false;
const listeners = new Set<() => void>();

function setStreamConnected(v: boolean) {
  if (streamConnected === v) return;
  streamConnected = v;
  listeners.forEach((l) => l());
}

function subscribeStream(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * O canal está entregando avisos agora?
 *
 * Quem consome isto deve tratar `false` como "volte a pollar" — nunca como
 * "espere um pouco". Um canal caído com polling afrouxado deixaria a tela
 * parada sem ninguém perceber.
 */
export function useIssueStreamConnected() {
  return useSyncExternalStore(
    subscribeStream,
    () => streamConnected,
    () => false, // sem DOM (SSR/teste): assume desconectado, ou seja, pollando
  );
}

export function useIssueStream(enabled: boolean) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setStreamConnected(false);
      return;
    }

    const sse = new EventSource('/api/issues/stream', { withCredentials: true });

    const marcar = (v: boolean) => {
      setConnected(v);
      setStreamConnected(v);
    };

    sse.onopen = () => marcar(true);
    sse.onmessage = () => {
      for (const queryKey of QUERIES_A_INVALIDAR) qc.invalidateQueries({ queryKey });
    };
    sse.onerror = () => {
      // Só reflete a queda; o EventSource tenta reconectar sozinho. Marcar
      // desconectado é o que devolve a responsabilidade ao polling de segurança.
      marcar(false);
    };

    return () => {
      sse.close();
      marcar(false);
    };
  }, [enabled, qc]);

  return connected;
}
