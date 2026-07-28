// Assimila usuários do Redmine a usuários do Nextcloud Talk por nome.
//
// O autocomplete do Talk (usado pra busca manual de conversa) só enxerga quem está no
// mesmo grupo/já teve interação com quem busca, quando a conta não é admin — cobre uma
// fração pequena da organização. O catálogo de contatos do sistema (CardDAV,
// /remote.php/dav/addressbooks/.../z-server-generated--system) não tem essa restrição:
// lista todos os usuários da instância pra qualquer conta autenticada. É essa fonte que
// usamos aqui. A exportação é grande (~10-20MB, inclui fotos em base64), então o
// resultado do cruzamento fica em cache em disco com TTL.
const axios = require('axios');
const { createJsonStore } = require('../lib/jsonStore');
const { makeTalk } = require('./talk');
const { getMyUserId } = require('../lib/redmine');
const { getTalkAuth } = require('./talkStore');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const store = createJsonStore('talk-match-cache.json', {
  fallback: { updatedAt: 0, byRedmineId: {} },
});

function normName(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(s) {
  return normName(s)
    .split(' ')
    .filter(Boolean);
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
  const prop = (c, name) =>
    new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'm').exec(c)?.[1]?.trim();
  return cards
    .map((c) => ({ fn: prop(c, 'FN'), uid: prop(c, 'UID') }))
    .filter((c) => c.fn && c.uid);
}

async function fetchAddressBookContacts(req) {
  const talk = await makeTalk(req);
  const uid = await getMyUserId(req);
  let principalId = (getTalkAuth(uid) || {}).user;
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

async function fetchRedmineMembers(req) {
  const base = `${req.protocol}://${req.get('host')}`;
  const { data } = await axios.get(`${base}/api/members`, {
    headers: { cookie: req.headers.cookie || '' },
  });
  return data.users || [];
}

async function buildMatches(req) {
  const [contacts, redmineUsers] = await Promise.all([
    fetchAddressBookContacts(req),
    fetchRedmineMembers(req),
  ]);

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

  store.data = { updatedAt: Date.now(), byRedmineId };
  store.save();
  return store.data;
}

async function getMatches(req, { forceRefresh = false } = {}) {
  const stale = Date.now() - (store.data.updatedAt || 0) > CACHE_TTL_MS;
  if (forceRefresh || stale || !store.data.byRedmineId) {
    return buildMatches(req);
  }
  return store.data;
}

module.exports = { getMatches, buildMatches };
