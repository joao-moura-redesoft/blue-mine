import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const initLoginFlow = vi.fn();
const pollLoginFlow = vi.fn();
const saveTalkAuth = vi.fn();

vi.mock('../api/talk', () => ({
  initLoginFlow: (...a: unknown[]) => initLoginFlow(...a),
  pollLoginFlow: (...a: unknown[]) => pollLoginFlow(...a),
  saveTalkAuth: (...a: unknown[]) => saveTalkAuth(...a),
}));

const { useTalkLoginFlow } = await import('./useTalkLoginFlow');

const FLOW = {
  loginUrl: 'https://nc.exemplo.com/login/v2/flow/abc',
  pollEndpoint: 'https://nc.exemplo.com/login/v2/poll',
  pollToken: 'tok',
};

// Erro no formato que o axios entrega (o hook lê err.response.status).
const httpError = (status: number) => Object.assign(new Error('http'), { response: { status } });

// Avança o timer e deixa as promises pendentes do callback resolverem.
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('useTalkLoginFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initLoginFlow.mockReset().mockResolvedValue(FLOW);
    pollLoginFlow.mockReset().mockResolvedValue({ done: false });
    saveTalkAuth.mockReset();
    vi.stubGlobal('open', vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const startFlow = async (hook: { current: ReturnType<typeof useTalkLoginFlow> }) => {
    await act(async () => {
      await hook.current.start('https://nc.exemplo.com/');
    });
  };

  it('abre a autorização no navegador e entra em espera', async () => {
    const { result } = renderHook(() => useTalkLoginFlow());
    await startFlow(result);

    expect(initLoginFlow).toHaveBeenCalledWith('https://nc.exemplo.com');
    expect(window.open).toHaveBeenCalledWith(FLOW.loginUrl, '_blank', 'noopener');
    expect(result.current.phase).toBe('waiting');
    expect(result.current.loginUrl).toBe(FLOW.loginUrl);
  });

  it('conclui quando o usuário autoriza e salva o vínculo', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useTalkLoginFlow(onDone));
    await startFlow(result);

    pollLoginFlow.mockResolvedValue({
      done: true,
      server: 'https://nc.exemplo.com/',
      user: 'joao.moura',
    });
    await tick(2000);

    const auth = { url: 'https://nc.exemplo.com', user: 'joao.moura' };
    expect(saveTalkAuth).toHaveBeenCalledWith(auth); // dispara TALK_AUTH_CHANGED
    expect(onDone).toHaveBeenCalledWith(auth);
    expect(result.current.phase).toBe('done');
  });

  it('para de perguntar depois de concluído', async () => {
    const { result } = renderHook(() => useTalkLoginFlow());
    await startFlow(result);
    pollLoginFlow.mockResolvedValue({ done: true, server: 'https://nc.exemplo.com', user: 'x' });
    await tick(2000);

    const calls = pollLoginFlow.mock.calls.length;
    await tick(10_000);
    expect(pollLoginFlow.mock.calls.length).toBe(calls);
  });

  // O bug central da versão anterior: sem teto, o poll girava para sempre.
  it('desiste quando a autorização expira, em vez de girar para sempre', async () => {
    const { result } = renderHook(() => useTalkLoginFlow());
    await startFlow(result);

    await tick(3 * 60_000 + 2000);

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/expirou/i);

    const calls = pollLoginFlow.mock.calls.length;
    await tick(10_000);
    expect(pollLoginFlow.mock.calls.length).toBe(calls); // parou mesmo
  });

  it('trata 401 no poll como sessão do Bluemine e para na hora', async () => {
    const { result } = renderHook(() => useTalkLoginFlow());
    await startFlow(result);

    pollLoginFlow.mockRejectedValue(httpError(401));
    await tick(2000);

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/sessão do Bluemine/i);

    const calls = pollLoginFlow.mock.calls.length;
    await tick(10_000);
    expect(pollLoginFlow.mock.calls.length).toBe(calls);
  });

  it('tolera falha de rede pontual e segue tentando', async () => {
    const { result } = renderHook(() => useTalkLoginFlow());
    await startFlow(result);

    pollLoginFlow.mockRejectedValueOnce(httpError(500));
    await tick(2000);
    expect(result.current.phase).toBe('waiting');

    pollLoginFlow.mockResolvedValue({ done: true, server: 'https://nc.exemplo.com', user: 'x' });
    await tick(2000);
    expect(result.current.phase).toBe('done');
  });

  it('desiste após falhas seguidas', async () => {
    const { result } = renderHook(() => useTalkLoginFlow());
    await startFlow(result);

    pollLoginFlow.mockRejectedValue(httpError(500));
    await tick(2000 * 5);

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/falhou várias vezes/i);
  });

  it('explica quando o Nextcloud não responde ao iniciar', async () => {
    initLoginFlow.mockRejectedValue(new Error('rede'));
    const { result } = renderHook(() => useTalkLoginFlow());
    await startFlow(result);

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/endereço/i);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('cancelar interrompe as tentativas', async () => {
    const { result } = renderHook(() => useTalkLoginFlow());
    await startFlow(result);
    act(() => result.current.cancel());

    expect(result.current.phase).toBe('idle');
    const calls = pollLoginFlow.mock.calls.length;
    await tick(10_000);
    expect(pollLoginFlow.mock.calls.length).toBe(calls);
  });

  it('não continua perguntando depois de sair da tela', async () => {
    const { result, unmount } = renderHook(() => useTalkLoginFlow());
    await startFlow(result);
    unmount();

    const calls = pollLoginFlow.mock.calls.length;
    await tick(10_000);
    expect(pollLoginFlow.mock.calls.length).toBe(calls);
  });
});
