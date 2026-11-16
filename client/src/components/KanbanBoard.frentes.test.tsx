/**
 * Frentes no quadro: chips, contadores e a seção de arquivadas.
 *
 * Os dois erros que este arquivo trava:
 *  - o rodapé "Arquivadas" saía da lista inteira e não da filtrada, então
 *    mostrava arquivadas de outra frente (ou de frente oculta) com filtro ligado;
 *  - os chips contavam Fechado/Cancelado: a listagem do Redmine 4.2 não traz
 *    `status.is_closed`, e o contador conferia justamente esse campo.
 *
 * As tarefas aqui imitam a API: `status` é só { id, name }.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ARCHIVE_KEY } from '../utils/archive';
import { JitsiProvider } from './jitsi/JitsiContext';
import type { Issue, IssueFrente } from '../types/redmine';

const { KanbanBoard } = await import('./KanbanBoard');

const ABERTA = { id: 30, name: 'Pendente Análise' };
const FECHADA = { id: 5, name: 'Fechado' };

const crm: IssueFrente = { id: 'crm', name: 'CRM', color: '#3b82f6', hidden: false, src: 'regra' };
const consync: IssueFrente = {
  id: 'consync',
  name: 'Consync',
  color: '#14b8a6',
  hidden: false,
  src: 'regra',
};
const infra: IssueFrente = {
  id: 'infra',
  name: 'Pedidos à infra',
  color: '#64748b',
  hidden: true,
  src: 'regra',
};

const issue = (id: number, subject: string, frente: IssueFrente | null, status = ABERTA): Issue =>
  ({
    id,
    subject,
    description: '',
    status,
    priority: { id: 1, name: 'Normal' },
    project: { id: 1, name: 'DEV' },
    tracker: { id: 1, name: 'Desenvolvimento' },
    author: { id: 1, name: 'Eu' },
    done_ratio: 0,
    created_on: '2026-07-01T10:00:00Z',
    updated_on: '2026-10-01T10:00:00Z',
    frente,
  }) as unknown as Issue;

const ISSUES = [
  issue(1, 'CRM ativa', crm),
  issue(2, 'CRM arquivada', crm),
  issue(3, 'Consync arquivada', consync),
  issue(4, 'Infra arquivada', infra),
  issue(5, 'Consync ativa', consync),
  issue(6, 'Infra ativa', infra), // dá chip à frente oculta (sem aberta o chip não aparece)
  issue(7, 'CRM fechada', crm, FECHADA),
  issue(8, 'Orfã fechada', null, FECHADA),
  issue(9, 'Orfã aberta', null),
];

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // /issue_statuses é a única fonte confiável de "fechado".
  qc.setQueryData(
    ['statuses'],
    [
      { ...ABERTA, is_closed: false },
      { ...FECHADA, is_closed: true },
    ],
  );
  qc.setQueryData(['priorities'], [{ id: 1, name: 'Normal' }]);
  qc.setQueryData(['issues', undefined], ISSUES);
  qc.setQueryData(['frentes'], {
    frentes: [crm, consync, infra].map(({ id, name, color, hidden }) => ({
      id,
      name,
      color,
      ...(hidden ? { hidden } : {}),
    })),
    rules: [],
    manual: {},
    fallback: null,
    customized: true,
  });
  render(
    <QueryClientProvider client={qc}>
      <JitsiProvider>
        <KanbanBoard onIssueClick={() => {}} />
      </JitsiProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kanban-group-by', 'none');
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify([2, 3, 4]));
});

afterEach(() => {
  cleanup();
});

// Chip de filtro = botão com aria-pressed; o cabeçalho da raia tem o mesmo nome
// (nome da frente + contagem), mas usa aria-expanded.
const chip = (name: RegExp) => screen.getByRole('button', { name, pressed: false });

const ARQ = /^Arquivadas \(\d+\)$/;
const archivedLabel = () => screen.queryByText(ARQ)?.textContent;
const archivedSubjects = () =>
  screen
    .queryAllByText(/arquivada$/)
    .map((e) => e.textContent?.replace(/^#\d+\s*/, '').trim())
    .sort();
// Abre todos os rodapés de arquivadas visíveis.
const openArchived = () => screen.queryAllByText(ARQ).forEach((l) => fireEvent.click(l));

describe('contadores dos chips de frente', () => {
  it('contam só tarefas abertas (Fechado/Cancelado ficam de fora)', () => {
    renderBoard();
    // CRM: 1 ativa (a arquivada e a fechada não contam). Consync: 1. Infra: 1.
    expect(chip(/^CRM\s*1$/)).toBeTruthy();
    expect(chip(/^Consync\s*1$/)).toBeTruthy();
    expect(chip(/Pedidos à infra\s*1/)).toBeTruthy();
    // Sem frente: só a aberta, não a fechada.
    expect(chip(/^Sem frente\s*1$/)).toBeTruthy();
  });

  it('o aviso "Classificar N" usa a mesma conta', () => {
    renderBoard();
    expect(screen.getByRole('button', { name: /^Classificar 1$/ })).toBeTruthy();
  });
});

describe('rodapé "Arquivadas" do quadro (sem raias)', () => {
  it('sem filtro mostra as arquivadas visíveis e deixa de fora as de frente oculta', () => {
    renderBoard();
    expect(archivedLabel()).toBe('Arquivadas (2)'); // CRM + Consync; a de infra é oculta
    openArchived();
    expect(archivedSubjects()).toEqual(['CRM arquivada', 'Consync arquivada']);
  });

  it('filtrar por uma frente leva só as arquivadas dela', () => {
    renderBoard();
    fireEvent.click(chip(/^CRM\s*1$/));
    expect(archivedLabel()).toBe('Arquivadas (1)');
    openArchived();
    expect(archivedSubjects()).toEqual(['CRM arquivada']);
  });

  it('trocar o filtro para outra frente troca as arquivadas', () => {
    renderBoard();
    fireEvent.click(chip(/^Consync\s*1$/));
    openArchived();
    expect(archivedSubjects()).toEqual(['Consync arquivada']);
  });

  it('filtrar pela frente oculta mostra a arquivada dela', () => {
    renderBoard();
    fireEvent.click(chip(/Pedidos à infra/));
    openArchived();
    expect(archivedSubjects()).toEqual(['Infra arquivada']);
  });

  it('a busca também filtra o rodapé', () => {
    renderBoard();
    fireEvent.change(screen.getByPlaceholderText(/Buscar/i), { target: { value: 'Consync' } });
    openArchived();
    expect(archivedSubjects()).toEqual(['Consync arquivada']);
  });
});

describe('arquivadas nas raias de frente', () => {
  beforeEach(() => {
    localStorage.setItem('kanban-group-by', 'frente');
  });

  it('cada raia mostra as arquivadas dela (a de frente oculta fica de fora)', () => {
    renderBoard();
    expect(screen.getAllByText(ARQ)).toHaveLength(2); // raia CRM e raia Consync
    openArchived();
    expect(archivedSubjects()).toEqual(['CRM arquivada', 'Consync arquivada']);
  });

  it('filtrar uma frente deixa só a raia e as arquivadas dela', () => {
    renderBoard();
    fireEvent.click(chip(/^Consync\s*1$/));
    expect(screen.getAllByText(ARQ)).toHaveLength(1);
    openArchived();
    expect(archivedSubjects()).toEqual(['Consync arquivada']);
  });

  it('"Restaurar" devolve a tarefa ao quadro', () => {
    renderBoard();
    fireEvent.click(chip(/^CRM\s*1$/));
    openArchived();
    fireEvent.click(screen.getByRole('button', { name: /Restaurar/ }));

    expect(JSON.parse(localStorage.getItem(ARCHIVE_KEY)!)).toEqual([3, 4]);
    expect(screen.queryByText(ARQ)).toBeNull();
    // A tarefa voltou como card normal da coluna.
    const card = screen.getByText('CRM arquivada');
    expect(within(card.closest('div')!).queryByText(/Restaurar/)).toBeNull();
  });
});
