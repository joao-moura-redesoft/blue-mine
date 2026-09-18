// Assimila usuários do Redmine a usuários do Nextcloud Talk por nome.
//
// O autocomplete do Talk (usado pra busca manual de conversa) só enxerga quem está no
// mesmo grupo/já teve interação com quem busca, quando a conta não é admin — cobre uma
// fração pequena da organização. O catálogo de contatos do sistema (CardDAV,
// /remote.php/dav/addressbooks/.../z-server-generated--system) não tem essa restrição:
// lista todos os usuários da instância pra qualquer conta autenticada. É essa fonte que
// usamos aqui. A exportação é grande (~10-20MB, inclui fotos em base64), então o
// resultado do cruzamento fica em cache em disco com TTL.
//
// Deliberadamente não recebe `req`: o motor de automações (workflowEngine.js) roda em
// segundo plano, sem sessão HTTP viva, só com credenciais armazenadas por uid — por
// isso as funções aqui pedem (uid, redmine) explícitos, e tanto a rota HTTP quanto o
// motor de automações montam esses dois argumentos à sua maneira.
const { createJsonStore } = require('../lib/jsonStore');
const { getTalkAuth, talkClientFor } = require('./talkStore');
const { listAllUsers } = require('./teams');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const store = createJsonStore('talk-match-cache.json', {
  fallback: { updatedAt: 0, byRedmineId: {}, byNcUid: {} },
});

// Contas do Nextcloud que já se provaram mortas (desativadas/apagadas) na hora de
// enviar. Ficam de fora do cruzamento: quando alguém troca de conta, a antiga
// continua no catálogo com o mesmo nome, e sem esta lista o nome seria ambíguo
// (ou pior, casaria justamente com a morta) para sempre.
const deadStore = createJsonStore('talk-dead-accounts.json', {
  fallback: { uids: {}, suspects: {} },
});

/** Marca um ncUid como conta inativa e o tira do cruzamento na próxima montagem. */
function markDeadNcUid(ncUid, reason = '') {
  if (!ncUid) return;
  const uids = deadStore.data.uids || (deadStore.data.uids = {});
  if (uids[ncUid]) return;
  uids[ncUid] = { at: Date.now(), reason };
  if (deadStore.data.suspects) delete deadStore.data.suspects[ncUid];
  deadStore.save();
  // O cruzamento em cache ainda aponta pra ela: invalida para a próxima consulta
  // remontar já sem a conta morta.
  store.data.updatedAt = 0;
  store.save();
}

/**
 * Suspeita levantada por sinal INDIRETO (sala sem nome). Uma leitura ruim não
 * pode apagar uma pessoa do cruzamento para sempre, então só na segunda vez a
 * conta é dada como morta. O envio já é evitado desde a primeira.
 */
function suspectDeadNcUid(ncUid, reason = '') {
  if (!ncUid) return;
  const suspects = deadStore.data.suspects || (deadStore.data.suspects = {});
  const strikes = (suspects[ncUid]?.strikes || 0) + 1;
  if (strikes >= 2) {
    markDeadNcUid(ncUid, reason);
    return;
  }
  suspects[ncUid] = { strikes, at: Date.now(), reason };
  deadStore.save();
}

function isDeadNcUid(ncUid) {
  return !!deadStore.data.uids?.[ncUid];
}

function normName(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function tokenize(s) {
  return normName(s).split(' ').filter(Boolean);
}

// small é subsequência de big se todos os tokens de small aparecem em big, na mesma ordem
// (podendo pular tokens no meio) — cobre nome do meio omitido em qualquer um dos dois lados.
function isSubsequence(small, big) {
  let i = 0;
  for (const tok of big) {
    if (tok === small[i]) i++;
    if (i === small.length) return true;
  }
  return small.length === 0;
}

// Exige pelo menos 2 tokens em comum pra evitar falso-positivo com nomes muito curtos/comuns.
function fuzzyNameMatch(nameA, nameB) {
  const ta = tokenize(nameA);
  const tb = tokenize(nameB);
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shorter.length < 2) return false;
  return isSubsequence(shorter, longer);
}

function parseVcf(text) {
  const cards = text.split('BEGIN:VCARD').slice(1);
  const prop = (c, name) => new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'm').exec(c)?.[1]?.trim();
  return cards
    .map((c) => ({ fn: prop(c, 'FN'), uid: prop(c, 'UID') }))
    .filter((c) => c.fn && c.uid);
}

async function fetchAddressBookContacts(uid) {
  const talk = talkClientFor(uid);
  if (!talk) throw Object.assign(new Error('Conta do Talk não vinculada'), { statusCode: 401 });

  const auth = getTalkAuth(uid);
  let principalId = auth.user;
  try {
    const { data } = await talk.get('/ocs/v2.php/cloud/user?format=json');
    if (data?.ocs?.data?.id) principalId = data.ocs.data.id;
  } catch {
    /* segue com o login name mesmo */
  }

  const path = `/remote.php/dav/addressbooks/users/${encodeURIComponent(principalId)}/z-server-generated--system?export`;
  const { data } = await talk.get(path, {
    responseType: 'text',
    headers: { Accept: 'text/vcard' },
    transformResponse: (d) => d,
  });
  return parseVcf(String(data));
}

// uid: id do usuário Redmine dono da conta Talk usada pra buscar o catálogo (qualquer
// conta autenticada serve — o catálogo não é escopado por visibilidade).
// redmine: instância axios já autenticada (makeRedmine(req) no fluxo HTTP,
// redmineClient(rec) no motor de automações).
async function buildMatches(uid, redmine) {
  const [allContacts, redmineUsers] = await Promise.all([
    fetchAddressBookContacts(uid),
    listAllUsers(redmine),
  ]);
  // Fora as contas já provadas mortas (ver markDeadNcUid): tirando elas, o nome
  // de quem migrou volta a casar com uma única conta — a nova.
  const contacts = allContacts.filter((c) => !isDeadNcUid(c.uid));

  const byExactName = new Map();
  for (const c of contacts) {
    const key = normName(c.fn);
    if (!byExactName.has(key)) byExactName.set(key, []);
    byExactName.get(key).push(c);
  }

  const byRedmineId = {};
  for (const u of redmineUsers) {
    const exact = byExactName.get(normName(u.name)) || [];
    if (exact.length === 1) {
      byRedmineId[u.id] = { ncUid: exact[0].uid, ncName: exact[0].fn, matchType: 'exact' };
      continue;
    }
    if (exact.length > 1) {
      byRedmineId[u.id] = {
        matchType: 'ambiguous',
        candidates: exact.map((c) => ({ ncUid: c.uid, ncName: c.fn })),
      };
      continue;
    }
    const fuzzy = contacts.filter((c) => fuzzyNameMatch(u.name, c.fn));
    if (fuzzy.length === 1) {
      byRedmineId[u.id] = { ncUid: fuzzy[0].uid, ncName: fuzzy[0].fn, matchType: 'fuzzy' };
    } else if (fuzzy.length > 1) {
      byRedmineId[u.id] = {
        matchType: 'ambiguous',
        candidates: fuzzy.map((c) => ({ ncUid: c.uid, ncName: c.fn })),
      };
    }
    // sem entrada = sem candidato encontrado
  }

  // Índice reverso — usado pelo pop-up de perfil do Talk pra linkar de volta pro
  // Redmine (dado o ncUid, achar a pessoa). Só entra aqui quem tem match único
  // (exact/fuzzy); ambíguos não têm um ncUid definido pra indexar.
  const byNcUid = {};
  for (const [redmineId, m] of Object.entries(byRedmineId)) {
    if (m.ncUid) byNcUid[m.ncUid] = Number(redmineId);
  }

  store.data = { updatedAt: Date.now(), byRedmineId, byNcUid };
  store.save();
  return store.data;
}

async function getMatches(uid, redmine, { forceRefresh = false } = {}) {
  const stale = Date.now() - (store.data.updatedAt || 0) > CACHE_TTL_MS;
  // !byNcUid cobre cache em disco escrito por uma versão anterior deste arquivo
  // (antes do índice reverso existir) — sem isso, o cache velho fica servido até
  // expirar o TTL de 24h e quebra quem depende do byNcUid (pop-up de perfil do Talk).
  if (forceRefresh || stale || !store.data.byRedmineId || !store.data.byNcUid) {
    return buildMatches(uid, redmine);
  }
  return store.data;
}

module.exports = { getMatches, buildMatches, markDeadNcUid, suspectDeadNcUid, isDeadNcUid };
