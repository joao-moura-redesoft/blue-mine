/**
 * fetchAllIssuesMeta pagina até a trava MAX_ISSUES e AVISA quando cortou.
 * O corte mudo era o problema: a tela recebia um pedaço achando que era o todo.
 */
import { describe, it, expect } from 'vitest';
import { fetchAllIssuesMeta, fetchAllIssues } from './pagination.js';

// Redmine falso: `total` tarefas, devolvidas de 100 em 100.
function fakeRedmine(total) {
  const calls = [];
  return {
    calls,
    async get(path, { params }) {
      calls.push(params);
      const { offset = 0, limit = 100 } = params;
      const issues = Array.from(
        { length: Math.max(0, Math.min(limit, total - offset)) },
        (_, i) => ({
          id: offset + i + 1,
        }),
      );
      return { data: { issues, total_count: total } };
    },
  };
}

describe('fetchAllIssuesMeta', () => {
  it('junta todas as páginas quando cabe na trava', async () => {
    const redmine = fakeRedmine(250);
    const { issues, totalCount, truncated } = await fetchAllIssuesMeta(redmine, { foo: 1 });
    expect(issues).toHaveLength(250);
    expect(totalCount).toBe(250);
    expect(truncated).toBe(false);
    expect(redmine.calls).toHaveLength(3);
  });

  it('marca truncated quando bate no teto', async () => {
    const { issues, totalCount, truncated } = await fetchAllIssuesMeta(fakeRedmine(900), {}, 300);
    expect(issues).toHaveLength(300);
    expect(totalCount).toBe(900); // total REAL do Redmine, não o que coube
    expect(truncated).toBe(true);
  });

  it('lista vazia não conta como truncada', async () => {
    const { issues, truncated } = await fetchAllIssuesMeta(fakeRedmine(0), {});
    expect(issues).toEqual([]);
    expect(truncated).toBe(false);
  });

  it('fetchAllIssues continua devolvendo só o array (compat)', async () => {
    const issues = await fetchAllIssues(fakeRedmine(120), {});
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toHaveLength(120);
  });
});
