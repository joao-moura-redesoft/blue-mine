// Opções das listas do Redmine que as regras de frente usam (Área e Natureza).
//
// A API REST devolve só o ID da opção ("160"), e /custom_fields.json exige
// admin — a chave de API do usuário toma 403. O nome da opção está no
// formulário de edição de qualquer tarefa que tenha o campo, que é o mesmo
// HTML que o popup de campos obrigatórios já lê (editFormSchema.js).
const { REDMINE_CF } = require('../lib/config');
const { parseEditFormSchema } = require('../lib/editFormSchema');

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map(); // `${url}:${cred}` -> { value, expiresAt }

function optionsOf(fields, cfId) {
  const f = fields.find((x) => x.kind === 'custom' && x.cfId === cfId);
  return (f?.options || []).map((o) => ({ value: String(o.value), label: o.label }));
}

// Extraído para teste: recebe o HTML da página show de uma tarefa.
function parseOptionsFromHtml(html) {
  const fields = parseEditFormSchema(html);
  return {
    area: optionsOf(fields, REDMINE_CF.area),
    natureza: optionsOf(fields, REDMINE_CF.nature),
  };
}

const hasArea = (issue) =>
  (issue.custom_fields || []).some((c) => c.id === REDMINE_CF.area && c.value);

async function loadOptions(redmine) {
  // Qualquer tarefa minha com Área preenchida serve: a lista é a mesma.
  const { data } = await redmine.get('/issues.json', {
    params: { assigned_to_id: 'me', status_id: '*', limit: 100, sort: 'updated_on:desc' },
  });
  const sample = (data.issues || []).find(hasArea);
  if (!sample) return { area: [], natureza: [] };
  const { data: html } = await redmine.get(`/issues/${sample.id}`, {
    headers: { Accept: 'text/html' },
    responseType: 'text',
  });
  return parseOptionsFromHtml(html);
}

// cacheKey: identifica servidor+credencial (as opções podem variar por permissão).
async function getFieldOptions(redmine, cacheKey) {
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loadOptions(redmine);
  // Vazio não é cacheado: provavelmente é só "ainda não tenho tarefa com Área".
  if (value.area.length || value.natureza.length) {
    cache.set(cacheKey, { value, expiresAt: Date.now() + TTL_MS });
  }
  return value;
}

module.exports = { getFieldOptions, parseOptionsFromHtml };
