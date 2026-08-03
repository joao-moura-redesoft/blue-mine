// Cliente Redmine por request + credenciais e cache de userId.
const axios = require('axios');
const { getInternalCaAgent } = require('./internalCa');
const { assertNotKnownBad, recordFailure, recordSuccess } = require('./credentialGuard');

const DEFAULT_URL = '';
const DEFAULT_KEY = '';

// Retorna os headers de autenticação corretos dependendo do modo (token vs usuário/senha).
function buildAuthHeaders(key, username, password) {
  if (username && password) {
    const token = Buffer.from(`${username}:${password}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }
  return { 'X-Redmine-API-Key': key };
}

// Cria instância do axios para cada request com as credenciais certas
function makeRedmine(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  const agent = getInternalCaAgent();

  // Modo usuário/senha = a senha do AD. Se ela já foi recusada, nem tenta: o app
  // faz polling constante e cada tentativa é um login falho no domínio, o que
  // acaba bloqueando a conta. Ver credentialGuard.js.
  const usingPassword = !!(username && password);
  if (usingPassword) assertNotKnownBad('redmine', username, password);

  const client = axios.create({
    baseURL: url,
    headers: { ...buildAuthHeaders(key, username, password), 'Content-Type': 'application/json' },
    // Sem isso, uma conexão que trava na rede (proxy corporativo engolindo pacotes
    // em vez de resetar) fica pendurada para sempre — e como o motor de automações
    // roda um tick de cada vez (`running` lock), UM request assim trava TODOS os
    // gatilhos de TODOS os usuários indefinidamente, sem log nenhum.
    timeout: 20000,
    ...(agent ? { httpsAgent: agent } : {}),
  });

  client.interceptors.response.use(
    (res) => {
      if (usingPassword) recordSuccess('redmine', username);
      return res;
    },
    (err) => {
      // 401 do Redmine com usuário/senha = credencial vencida (senha trocada no
      // AD). 403 é "sem permissão" — a key não-admin toma 403 o tempo todo em
      // rotas legítimas, e tratar isso como senha errada deslogaria à toa.
      if (usingPassword && err.response?.status === 401) {
        recordFailure('redmine', username, password);
        err.credentialsStale = true;
      }
      return Promise.reject(err);
    },
  );

  return client;
}

// Cache de userId por "url:key" ou "url:user:pass". Com TTL para não crescer
// indefinidamente (espelha o padrão de allowedCache em routes/issues.js).
const userIdCache = new Map(); // cacheKey -> { id, expiresAt }
const USER_ID_TTL_MS = 5 * 60 * 1000;

// Limpeza periódica de entradas expiradas.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of userIdCache) if (now > v.expiresAt) userIdCache.delete(k);
}, USER_ID_TTL_MS).unref();

async function getMyUserId(req) {
  const url = req.headers['x-redmine-url'] || DEFAULT_URL;
  const key = req.headers['x-redmine-key'] || DEFAULT_KEY;
  const username = req.headers['x-redmine-user'] || '';
  const password = req.headers['x-redmine-pass'] || '';
  const cacheKey = `${url}:${key || `${username}:${password}`}`;
  const cached = userIdCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.id;
  const { data } = await makeRedmine(req).get('/users/current.json');
  userIdCache.set(cacheKey, { id: data.user.id, expiresAt: Date.now() + USER_ID_TTL_MS });
  return data.user.id;
}

module.exports = {
  DEFAULT_URL,
  DEFAULT_KEY,
  buildAuthHeaders,
  makeRedmine,
  getMyUserId,
};
