/**
 * Recorte por projeto das listas que o board usa como "acompanhadas"
 * (/issues/monitored, /issues/authored, /issues/by-ids). O valor vai direto
 * para a query do Redmine — que inclui os subprojetos — então só passa id ou
 * identificador; qualquer outra coisa é ignorada (lista sem recorte).
 */
import { describe, it, expect } from 'vitest';
import issuesRouter from './issues.js';

const { projectScope } = issuesRouter.__testables;
const req = (project_id) => ({ query: project_id === undefined ? {} : { project_id } });

describe('projectScope', () => {
  it('aceita id numérico e identificador', () => {
    expect(projectScope(req('901'))).toEqual({ project_id: '901' });
    expect(projectScope(req('dev-crm_2'))).toEqual({ project_id: 'dev-crm_2' });
  });

  it('sem projeto, sem recorte', () => {
    expect(projectScope(req(undefined))).toEqual({});
    expect(projectScope(req(''))).toEqual({});
  });

  it('ignora valor que não é id/identificador', () => {
    expect(projectScope(req('1&status_id=*'))).toEqual({});
    expect(projectScope(req(['1', '2']))).toEqual({});
    expect(projectScope(req('a'.repeat(101)))).toEqual({});
  });
});
