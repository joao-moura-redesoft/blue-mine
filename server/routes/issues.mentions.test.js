/**
 * A rota /issues/mentions filtra por data NO SERVIDOR do Redmine.
 *
 * Antes, os 4 conjuntos de candidatas vinham inteiros (o teto de 2000 do
 * fetchAllIssues = até 20 páginas por conjunto, ~80 requisições) e o corte de
 * 7 dias acontecia em memória logo depois — ou seja, quase tudo que trafegava
 * era descartado. Estes testes falham se alguém tirar o filtro da query.
 */
import { describe, it, expect } from 'vitest';
import issuesRouter from './issues.js';

const { mentionCandidateQueries } = issuesRouter.__testables;

const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;

describe('mentionCandidateQueries', () => {
  it('põe updated_on>=<data> em TODAS as queries', () => {
    const qs = mentionCandidateQueries(7, Date.now() - SETE_DIAS);
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q, 'sem filtro de data → volta a trazer tudo').toHaveProperty('updated_on');
      expect(q.updated_on).toMatch(/^>=\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('usa o formato de data do Redmine (>=YYYY-MM-DD), como analytics.js e digest.js', () => {
    const sinceMs = Date.UTC(2026, 6, 27, 15, 30); // 27/jul/2026 15:30 UTC
    const [q] = mentionCandidateQueries(7, sinceMs);
    expect(q.updated_on).toBe('>=2026-07-27'); // só a data, sem hora
  });

  it('mantém os 4 conjuntos: responsável, autor, dev e revisor', () => {
    const qs = mentionCandidateQueries(7, Date.now() - SETE_DIAS);
    expect(qs).toHaveLength(4);

    expect(qs[0]).toMatchObject({ assigned_to_id: 'me', status_id: '*' });
    expect(qs[1]).toMatchObject({ author_id: 'me', status_id: 'open' });

    // Os dois últimos filtram por campo custom com o id do usuário.
    const cfs = qs.slice(2).map((q) => Object.keys(q).find((k) => k.startsWith('cf_')));
    expect(cfs.filter(Boolean)).toHaveLength(2);
    expect(new Set(cfs).size).toBe(2); // dev e revisor são campos distintos
    for (const q of qs.slice(2)) {
      const cf = Object.keys(q).find((k) => k.startsWith('cf_'));
      expect(q[cf]).toBe(7); // recebe o userId, não 'me'
    }
  });

  it('ordena por atualização decrescente (o corte de 60 candidatas pega as mais recentes)', () => {
    for (const q of mentionCandidateQueries(7, Date.now() - SETE_DIAS)) {
      expect(q.sort).toBe('updated_on:desc');
    }
  });

  it('não vaza limit/offset — a paginação é do fetchAllIssues', () => {
    for (const q of mentionCandidateQueries(7, Date.now() - SETE_DIAS)) {
      expect(q).not.toHaveProperty('limit');
      expect(q).not.toHaveProperty('offset');
    }
  });
});
