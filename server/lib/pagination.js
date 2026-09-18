// Utilitários de paginação e concorrência para a API do Redmine.

// Busca TODAS as páginas de um recurso paginado (genérico).
async function fetchAllPages(redmine, path, key, params, max = 2000) {
  const limit = 100;
  let offset = 0,
    all = [],
    total = Infinity;
  while (offset < total && all.length < max) {
    const { data } = await redmine.get(path, { params: { ...params, limit, offset } });
    if (data.total_count != null) total = data.total_count;
    all = all.concat(data[key] || []);
    if ((data[key] || []).length === 0) break;
    offset += limit;
  }
  return all;
}

// Roda `fn` sobre os itens com no máximo `limit` chamadas simultâneas.
// Usado para buscar detalhes (relations/journals) de várias issues sem
// estourar o Redmine com N requests paralelos.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Trava de segurança: 20 páginas. Não varre bases enormes sem querer.
const MAX_ISSUES = 2000;

// Busca TODAS as páginas de issues para um conjunto de filtros (remove o teto de 100)
// e diz quanto ficou de fora. `truncated` é o que interessa: antes o corte no
// MAX_ISSUES era mudo — a tela recebia um pedaço achando que era o todo.
async function fetchAllIssuesMeta(redmine, params, max = MAX_ISSUES) {
  const limit = 100;
  let offset = 0,
    all = [],
    total = Infinity;
  while (offset < total && all.length < max) {
    const { data } = await redmine.get('/issues.json', { params: { ...params, limit, offset } });
    if (data.total_count != null) total = data.total_count;
    all = all.concat(data.issues || []);
    if ((data.issues || []).length === 0) break;
    offset += limit;
  }
  const totalCount = Number.isFinite(total) ? total : all.length;
  return { issues: all, totalCount, truncated: totalCount > all.length };
}

async function fetchAllIssues(redmine, params) {
  const { issues } = await fetchAllIssuesMeta(redmine, params);
  return issues;
}

module.exports = { fetchAllPages, mapLimit, fetchAllIssues, fetchAllIssuesMeta, MAX_ISSUES };
