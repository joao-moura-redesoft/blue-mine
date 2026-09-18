/**
 * A rota /issues (board "Minhas Tarefas") busca abertas sem corte + fechadas
 * dentro de uma janela, com o filtro de data NA QUERY do Redmine.
 *
 * Antes era `status_id: '*'`: todas as fechadas de sempre, a cada poll, para
 * telas que descartam fechadas ou escondem as colunas. Estes testes falham se
 * alguém voltar a trazer o histórico inteiro.
 */
import { describe, it, expect } from 'vitest';
import issuesRouter from './issues.js';

const { myIssuesQueries } = issuesRouter.__testables;

const BASE = { assigned_to_id: 'me', include: 'children' };
const NOW = Date.UTC(2026, 7, 5, 12, 0); // 05/ago/2026

describe('myIssuesQueries', () => {
  it('separa em duas buscas: abertas e fechadas', () => {
    const qs = myIssuesQueries(BASE, NOW, 180);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ ...BASE, status_id: 'open' });
    expect(qs[1]).toMatchObject({ ...BASE, status_id: 'closed' });
  });

  it('não corta as abertas por data — são as que a tela usa', () => {
    const [open] = myIssuesQueries(BASE, NOW, 180);
    expect(open).not.toHaveProperty('updated_on');
  });

  it('corta as fechadas na janela, no formato de data do Redmine', () => {
    const [, closed] = myIssuesQueries(BASE, NOW, 180);
    expect(closed.updated_on).toMatch(/^>=\d{4}-\d{2}-\d{2}$/);
    expect(closed.updated_on).toBe('>=2026-02-06'); // 180 dias antes de 05/ago/2026
  });

  it('janela menor aproxima a data de corte', () => {
    const [, closed] = myIssuesQueries(BASE, NOW, 30);
    expect(closed.updated_on).toBe('>=2026-07-06');
  });

  it('ISSUES_CLOSED_DAYS=0 tira as fechadas de vez', () => {
    const qs = myIssuesQueries(BASE, NOW, 0);
    expect(qs).toHaveLength(1);
    expect(qs[0].status_id).toBe('open');
  });

  it("ISSUES_CLOSED_DAYS='all' (null) volta ao escopo antigo, numa query só", () => {
    const qs = myIssuesQueries(BASE, NOW, null);
    expect(qs).toHaveLength(1);
    expect(qs[0].status_id).toBe('*');
    expect(qs[0]).not.toHaveProperty('updated_on');
  });

  it('respeita status_id explícito do cliente (aba Pessoas pede só abertas)', () => {
    const qs = myIssuesQueries(BASE, NOW, 180, 'open');
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ status_id: 'open' });
    expect(qs[0]).not.toHaveProperty('updated_on');
  });

  it("status_id '*' pede o escopo do board, não o histórico inteiro", () => {
    const qs = myIssuesQueries(BASE, NOW, 180, '*');
    expect(qs).toHaveLength(2);
    expect(qs[1].updated_on).toBe('>=2026-02-06');
  });

  it('não vaza limit/offset — a paginação é do fetchAllIssuesMeta', () => {
    for (const q of myIssuesQueries(BASE, NOW, 180)) {
      expect(q).not.toHaveProperty('limit');
      expect(q).not.toHaveProperty('offset');
    }
  });
});
