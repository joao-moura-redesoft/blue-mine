/**
 * Colunas acompanhadas: tarefas ligadas a mim (sou o DEV, criei ou observo) que
 * estão com outra pessoa (ex.: Pendente Revisão, atribuída à revisora) aparecem
 * no board, só leitura.
 *
 * O que este arquivo trava:
 *  - nada aparece sem o usuário ligar a coluna (o board continua sendo "minhas");
 *  - a coluna ligada aparece mesmo sem nenhuma tarefa minha naquele status;
 *  - a tarefa que voltou para mim não duplica (as listas atrasam um ciclo);
 *  - o card acompanhado não pode ser arrastado;
 *  - o botão "Acompanhadas" esconde tudo sem perder a escolha;
 *  - "criadas por mim" e "observadas" só entram quando ligadas, sem repetir, e
 *    observada fechada fica de fora (a lista local traz qualquer status);
 *  - com projeto escolhido, vale o recorte do servidor (que inclui subprojetos):
 *    a tarefa de um subprojeto aparece mesmo com outro `project.id`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JitsiProvider } from './jitsi/JitsiContext';
import { FOLLOW_KEY, collectFollowed, type FollowConfig } from '../utils/followedColumns';
import { localWatches } from '../utils/localWatches';
import type { Issue } from '../types/redmine';

const { KanbanBoard } = await import('./KanbanBoard');

const ANDAMENTO = { id: 2, name: 'Em andamento' };
const REVISAO = { id: 71, name: 'Pendente Revisão' };
const TESTE = { id: 72, name: 'Pendente Teste' };
const FECHADO = { id: 5, name: 'Fechado' };

const issue = (
  id: number,
  subject: string,
  status: { id: number; name: string },
  assignee?: string,
  projectId = 1,
): Issue =>
  ({
    id,
    subject,
    description: '',
    status,
    priority: { id: 1, name: 'Normal' },
    project: { id: projectId, name: `P${projectId}` },
    tracker: { id: 1, name: 'Desenvolvimento' },
    author: { id: 1, name: 'Eu' },
    ...(assignee ? { assigned_to: { id: 99, name: assignee } } : {}),
    done_ratio: 0,
    created_on: '2026-07-01T10:00:00Z',
    updated_on: '2026-10-01T10:00:00Z',
    frente: null,
  }) as unknown as Issue;

const MINE = [issue(1, 'Minha em andamento', ANDAMENTO), issue(3, 'Voltou pra mim', ANDAMENTO)];
const MONITORED = [
  issue(2, 'Em revisão com a Ana', REVISAO, 'Ana Revisora'),
  issue(3, 'Voltou pra mim', REVISAO, 'Ana Revisora'), // atraso de um ciclo
  issue(4, 'Em teste com o QA', TESTE, 'Quim QA'),
];
const AUTHORED = [
  issue(2, 'Em revisão com a Ana', REVISAO, 'Ana Revisora'), // também sou DEV: não repete
  issue(6, 'Criei para o Bia', REVISAO, 'Bia Dev'),
];
const WATCHED_ID = 8;
const WATCHED = [
  issue(WATCHED_ID, 'Observo a do Caio', REVISAO, 'Caio Dev'),
  issue(9, 'Observada já fechada', FECHADO, 'Caio Dev'),
];

const STATUSES = [
  ...[ANDAMENTO, REVISAO, TESTE].map((s) => ({ ...s, is_closed: false })),
  { ...FECHADO, is_closed: true },
];

function renderBoard({
  projectId,
  monitored = MONITORED,
}: { projectId?: number; monitored?: Issue[] } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['statuses'], STATUSES);
  qc.setQueryData(['priorities'], [{ id: 1, name: 'Normal' }]);
  qc.setQueryData(['issues', projectId], MINE);
  const key = (k: string) => (projectId ? [k, projectId] : [k]);
  qc.setQueryData(key('issues-monitored'), monitored);
  qc.setQueryData(key('issues-authored'), AUTHORED);
  const ids = localWatches.getIds();
  qc.setQueryData(
    projectId ? ['issues-watched-local', ids, projectId] : ['issues-watched-local', ids],
    WATCHED,
  );
  render(
    <QueryClientProvider client={qc}>
      <JitsiProvider>
        <KanbanBoard onIssueClick={() => {}} projectId={projectId} />
      </JitsiProvider>
    </QueryClientProvider>,
  );
}

const follow = (cfg: object) => localStorage.setItem(FOLLOW_KEY, JSON.stringify(cfg));
const cardOf = (subject: string) =>
  screen.getByText(subject).closest('[data-issue-id]') as HTMLElement | null;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kanban-group-by', 'none');
  // Com a lista local vazia o hook busca `[]` de verdade e apaga o cache semeado.
  if (!localWatches.isWatching(WATCHED_ID)) localWatches.toggle(WATCHED_ID);
});

afterEach(() => cleanup());

describe('colunas acompanhadas no board', () => {
  it('sem configuração, só as minhas aparecem', () => {
    renderBoard();
    expect(screen.queryByText('Em revisão com a Ana')).toBeNull();
    expect(screen.queryByText('Pendente Revisão')).toBeNull();
  });

  it('a coluna ligada aparece com a tarefa e o selo de quem está com ela', () => {
    follow({ all: false, statusIds: [REVISAO.id], hidden: false });
    renderBoard();
    expect(screen.getByRole('heading', { name: 'Pendente Revisão' })).toBeTruthy();
    expect(screen.getByText('Em revisão com a Ana')).toBeTruthy();
    expect(screen.getByText('Sou DEV · com Ana Revisora')).toBeTruthy();
    // Status não ligado continua fora; configuração antiga = só a fonte DEV.
    expect(screen.queryByText('Em teste com o QA')).toBeNull();
    expect(screen.queryByText('Criei para o Bia')).toBeNull();
    expect(screen.queryByText('Observo a do Caio')).toBeNull();
  });

  it('a tarefa que já voltou para mim não duplica', () => {
    follow({ all: true, statusIds: [], hidden: false });
    renderBoard();
    expect(screen.getAllByText('Voltou pra mim')).toHaveLength(1);
    expect(screen.getByText('Em teste com o QA')).toBeTruthy();
  });

  it('o card acompanhado não arrasta; o meu sim', () => {
    follow({ all: true, statusIds: [], hidden: false });
    renderBoard();
    expect(cardOf('Em revisão com a Ana')?.getAttribute('aria-disabled')).toBe('true');
    expect(cardOf('Minha em andamento')?.getAttribute('aria-disabled')).toBe('false');
  });

  it('"Acompanhadas" esconde e mostra sem perder a escolha', () => {
    follow({ all: false, statusIds: [REVISAO.id], hidden: false });
    renderBoard();
    const toggle = screen.getByRole('button', { name: /Acompanhadas/ });
    fireEvent.click(toggle);
    expect(screen.queryByText('Em revisão com a Ana')).toBeNull();
    expect(JSON.parse(localStorage.getItem(FOLLOW_KEY)!)).toMatchObject({
      statusIds: [REVISAO.id],
      hidden: true,
    });
    fireEvent.click(toggle);
    expect(screen.getByText('Em revisão com a Ana')).toBeTruthy();
  });

  it('criadas por mim e observadas entram ligadas, com o selo da fonte e sem repetir', () => {
    follow({
      all: true,
      statusIds: [],
      hidden: false,
      sources: { dev: true, authored: true, watched: true },
    });
    renderBoard();
    expect(screen.getByText('Criada por mim · com Bia Dev')).toBeTruthy();
    expect(screen.getByText('Observada · com Caio Dev')).toBeTruthy();
    // #2 está nas duas listas: aparece uma vez, pela primeira fonte (DEV).
    expect(screen.getAllByText('Em revisão com a Ana')).toHaveLength(1);
    expect(screen.getByText('Sou DEV · com Ana Revisora')).toBeTruthy();
    // Observada fechada não vira coluna nem card.
    expect(screen.queryByText('Observada já fechada')).toBeNull();
  });

  it('com projeto escolhido, a tarefa de subprojeto (recorte do servidor) aparece', () => {
    follow({ all: true, statusIds: [], hidden: false });
    renderBoard({
      projectId: 1,
      monitored: [issue(20, 'Do subprojeto', REVISAO, 'Ana Revisora', 7)],
    });
    expect(screen.getByText('Do subprojeto')).toBeTruthy();
  });
});

describe('collectFollowed', () => {
  const cfg: FollowConfig = {
    all: true,
    statusIds: [],
    hidden: false,
    sources: { dev: true, authored: false, watched: false },
  };
  const open = () => false;

  it('sem status ligado, nada; contagem do menu ignora a escolha de status', () => {
    const none = { ...cfg, all: false };
    expect(collectFollowed({ dev: MONITORED }, none, new Set(), open).issues).toEqual([]);
    expect(
      collectFollowed({ dev: MONITORED }, none, new Set(), open, false).issues.map((i) => i.id),
    ).toEqual([2, 3, 4]);
  });

  it('fonte desligada não entra; a razão é a primeira fonte que trouxe', () => {
    const sel = collectFollowed(
      { dev: MONITORED, authored: AUTHORED },
      { ...cfg, sources: { dev: true, authored: true, watched: false } },
      new Set([3]),
      open,
    );
    expect(sel.issues.map((i) => i.id)).toEqual([2, 4, 6]);
    expect(sel.reasons.get(2)).toBe('dev');
    expect(sel.reasons.get(6)).toBe('authored');
  });
});
