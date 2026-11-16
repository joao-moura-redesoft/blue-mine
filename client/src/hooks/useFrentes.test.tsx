/**
 * Escolha manual de frente: atualização otimista nas listas e no detalhe, com
 * rollback no erro — e a reaplicação no sucesso, que cobre a busca que já
 * estava a caminho quando o servidor gravou e devolveria a classificação velha.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FrentesConfig } from '../api/frentes';
import type { Issue } from '../types/redmine';

const setManual = vi.fn();
vi.mock('../api/frentes', async (orig) => ({
  ...(await orig<typeof import('../api/frentes')>()),
  setManualFrente: (...a: unknown[]) => setManual(...a),
}));

const { useSetManualFrente } = await import('./useFrentes');

const CFG: FrentesConfig = {
  frentes: [
    { id: 'crm', name: 'CRM', color: '#3b82f6' },
    { id: 'infra', name: 'Infra', color: '#64748b', hidden: true },
  ],
  rules: [],
  manual: {},
  fallback: null,
  customized: true,
};

const issue = (id: number, frente: Issue['frente'] = null): Issue =>
  ({ id, subject: `t${id}`, frente }) as unknown as Issue;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['frentes'], CFG);
  qc.setQueryData(['issues', undefined], [issue(1), issue(2)]);
  qc.setQueryData(['issue', 1], issue(1));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSetManualFrente(), { wrapper });
  const list = () => qc.getQueryData<Issue[]>(['issues', undefined])!;
  return { qc, result, list };
}

beforeEach(() => {
  setManual.mockReset();
});

describe('useSetManualFrente', () => {
  it('reflete a escolha na hora, na lista e no detalhe, sem tocar nas outras tarefas', async () => {
    let resolve!: (c: FrentesConfig) => void;
    setManual.mockReturnValue(new Promise((r) => (resolve = r)));
    const { qc, result, list } = setup();

    act(() => result.current.mutate({ issueId: 1, frenteId: 'crm' }));

    await waitFor(() => expect(list()[0].frente).toMatchObject({ id: 'crm', src: 'manual' }));
    expect(list()[0].frente).toMatchObject({ name: 'CRM', color: '#3b82f6', hidden: false });
    expect(list()[1].frente).toBeNull();
    expect(qc.getQueryData<Issue>(['issue', 1])!.frente).toMatchObject({ id: 'crm' });

    await act(async () => resolve({ ...CFG, manual: { 1: 'crm' } }));
    await waitFor(() =>
      expect(qc.getQueryData<FrentesConfig>(['frentes'])!.manual).toEqual({ 1: 'crm' }),
    );
  });

  it('frente oculta mantém hidden:true no otimismo (a tarefa some do quadro na hora)', async () => {
    setManual.mockResolvedValue(CFG);
    const { result, list } = setup();
    await act(async () => result.current.mutate({ issueId: 2, frenteId: 'infra' }));
    expect(list()[1].frente).toMatchObject({ id: 'infra', hidden: true });
  });

  it('erro do servidor desfaz o otimismo', async () => {
    setManual.mockImplementation(async () => {
      throw new Error('500');
    });
    const { qc, result, list } = setup();

    await act(async () => {
      result.current.mutate({ issueId: 1, frenteId: 'crm' });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(list()[0].frente).toBeNull();
    expect(qc.getQueryData<Issue>(['issue', 1])!.frente).toBeNull();
  });

  it('busca em voo que devolveu a classificação velha não desfaz a escolha', async () => {
    let resolve!: (c: FrentesConfig) => void;
    setManual.mockReturnValue(new Promise((r) => (resolve = r)));
    const { qc, result, list } = setup();

    act(() => result.current.mutate({ issueId: 1, frenteId: 'crm' }));
    await waitFor(() => expect(list()[0].frente?.id).toBe('crm'));

    // Resposta atrasada de uma busca de tarefas, anterior à gravação no servidor.
    qc.setQueryData(['issues', undefined], [issue(1), issue(2)]);
    expect(list()[0].frente).toBeNull();

    await act(async () => resolve({ ...CFG, manual: { 1: 'crm' } }));
    await waitFor(() => expect(list()[0].frente).toMatchObject({ id: 'crm', src: 'manual' }));
  });

  it('voltar ao automático não inventa frente: manda null e rebusca', async () => {
    setManual.mockResolvedValue(CFG);
    const { qc, result, list } = setup();
    qc.setQueryData(
      ['issues', undefined],
      [issue(1, { id: 'crm', name: 'CRM', color: '#3b82f6', hidden: false, src: 'manual' })],
    );

    await act(async () => result.current.mutate({ issueId: 1, frenteId: null }));

    expect(setManual).toHaveBeenCalledWith(1, null);
    expect(list()[0].frente?.src).toBe('manual'); // só o refetch troca; nada é adivinhado
  });
});
