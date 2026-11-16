/**
 * Fila de classificação por teclado. Os pontos frágeis: o número da tecla tem
 * que bater com a ordem das frentes na configuração, Enter num botão não pode
 * abrir a tarefa (fecharia a fila por trás do clique), e atalhos com modificador
 * (Ctrl+1 troca de aba do navegador) não podem classificar nada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FrentesConfig } from '../../api/frentes';
import type { Issue } from '../../types/redmine';

const setManual = vi.fn().mockResolvedValue({});
vi.mock('../../api/frentes', async (orig) => ({
  ...(await orig<typeof import('../../api/frentes')>()),
  setManualFrente: (...a: unknown[]) => setManual(...a),
}));

const { FrenteTriageModal } = await import('./FrenteTriageModal');

const CFG: FrentesConfig = {
  frentes: [
    { id: 'crm', name: 'CRM', color: '#3b82f6' },
    { id: 'consync', name: 'Consync', color: '#14b8a6' },
    { id: 'velha', name: 'Velha', color: '#999999', archived: true },
  ],
  rules: [],
  manual: {},
  fallback: null,
  customized: true,
};

const issue = (id: number, created: string, over: Partial<Issue> = {}): Issue =>
  ({
    id,
    subject: `Tarefa ${id}`,
    created_on: created,
    project: { id: 1, name: 'DEV' },
    status: { id: 1, name: 'Pendente Análise' }, // a API não manda is_closed
    frente: null,
    ...over,
  }) as unknown as Issue;

function renderModal(issues: Issue[], cfg: FrentesConfig | null = CFG) {
  const onClose = vi.fn();
  const onOpenIssue = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cfg) qc.setQueryData(['frentes'], cfg);
  qc.setQueryData(
    ['statuses'],
    [
      { id: 1, name: 'Pendente Análise', is_closed: false },
      { id: 5, name: 'Fechado', is_closed: true },
    ],
  );
  render(
    <QueryClientProvider client={qc}>
      <FrenteTriageModal issues={issues} onClose={onClose} onOpenIssue={onOpenIssue} />
    </QueryClientProvider>,
  );
  return { onClose, onOpenIssue };
}

beforeEach(() => {
  setManual.mockClear();
});

// Sem globals do vitest o RTL não limpa sozinho: modais antigos continuariam
// escutando o teclado e classificando tarefas de outros testes.
afterEach(() => {
  cleanup();
});

describe('FrenteTriageModal', () => {
  const issues = [
    issue(20, '2026-09-01T00:00:00Z'), // mais nova
    issue(10, '2026-07-01T00:00:00Z'), // mais antiga: primeira da fila
    issue(30, '2026-08-01T00:00:00Z', {
      frente: { id: 'crm', name: 'CRM', color: '#3b82f6', hidden: false, src: 'regra' },
    }),
    issue(40, '2026-06-01T00:00:00Z', {
      status: { id: 5, name: 'Fechado' } as Issue['status'],
    }),
  ];

  it('lista só abertas sem frente, da mais antiga para a mais nova', () => {
    renderModal(issues);
    const titles = screen.getAllByText(/Tarefa \d+/).map((e) => e.textContent);
    expect(titles.join(' ')).toMatch(/Tarefa 10.*Tarefa 20/);
    expect(screen.queryByText(/Tarefa 30/)).toBeNull();
    expect(screen.queryByText(/Tarefa 40/)).toBeNull();
  });

  it('a tecla é o número da frente na ordem da configuração (arquivadas ficam de fora)', async () => {
    renderModal(issues);
    fireEvent.keyDown(document, { key: '2' });
    await waitFor(() => expect(setManual).toHaveBeenCalledWith(10, 'consync'));
    setManual.mockClear();
    fireEvent.keyDown(document, { key: '3' }); // só 2 frentes ativas
    await new Promise((r) => setTimeout(r, 20));
    expect(setManual).not.toHaveBeenCalled();
  });

  it('seta para baixo troca a tarefa que recebe a frente', async () => {
    renderModal(issues);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: '1' });
    await waitFor(() => expect(setManual).toHaveBeenCalledWith(20, 'crm'));
  });

  it('Ctrl+número não classifica (é atalho do navegador)', async () => {
    renderModal(issues);
    fireEvent.keyDown(document, { key: '1', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(setManual).not.toHaveBeenCalled();
  });

  it('Enter abre a tarefa atual, mas Enter num botão não', () => {
    const { onOpenIssue } = renderModal(issues);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onOpenIssue).toHaveBeenCalledWith(10);

    onOpenIssue.mockClear();
    const botao = screen.getAllByRole('button', { name: /CRM/ })[0];
    fireEvent.keyDown(botao, { key: 'Enter' });
    expect(onOpenIssue).not.toHaveBeenCalled();
  });

  it('Escape fecha', () => {
    const { onClose } = renderModal(issues);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('sem nenhuma tarefa pendente mostra o estado "tudo classificado"', () => {
    renderModal([issues[2]]);
    expect(screen.getByText('Tudo classificado')).toBeTruthy();
  });

  it('sem frentes criadas explica o que fazer em vez de uma fila inútil', () => {
    renderModal(issues, { ...CFG, frentes: [] });
    expect(screen.getByText(/ainda não tem nenhuma frente/i)).toBeTruthy();
  });
});
