const crypto = require('crypto');
const { dataFile, readJsonSecure, writeJsonSecure } = require('./secureStore');
const log = require('./logger');

const SESSIONS_FILE = dataFile('sessions.json');

// Map em memória para gerenciar sessões
// Chave: sessionId (string)
// Valor: { url, apiKey, username, password, createdAt }
let sessionsMap = new Map();

// Carrega as sessões salvas do disco na inicialização
function loadSessions() {
  const data = readJsonSecure(SESSIONS_FILE, []);
  sessionsMap = new Map(data);
}
loadSessions();

function saveSessions() {
  // As sessões guardam credenciais do Redmine (incl. senha em modo Basic): exige
  // criptografia em repouso, recusando o fallback de texto puro.
  writeJsonSecure(SESSIONS_FILE, Array.from(sessionsMap.entries()), { requireEncryption: true });
}

// Entrar de novo não apagava as sessões antigas do mesmo usuário: o logout só
// derruba a do cookie atual, então toda sessão cujo cookie se perdeu (outro
// navegador, cookie limpo, reinstalação) ficava órfã aqui guardando a senha
// ANTIGA — e o motor de automações percorre TODAS a cada tick. Depois de uma
// troca de senha no AD isso vira aviso permanente no log e, como a guarda de
// credencial vive em memória, mais uma tentativa real de login no domínio a
// cada reinício do processo. Ver credentialGuard.js.
//
// Descarta só o que é comprovadamente vencido: mesmo servidor e mesmo usuário,
// com senha DIFERENTE da que o Redmine acabou de aceitar. Sessões válidas em
// paralelo (o app e o navegador ao mesmo tempo) guardam a mesma senha e ficam
// de pé — este não é um "um login por vez".
function evictStaleTwins({ url, username, password }) {
  if (!url || !username || !password) return 0;
  const user = String(username).toLowerCase(); // AD é case-insensitive
  let dropped = 0;
  for (const [id, s] of sessionsMap.entries()) {
    if (s.url !== url) continue;
    if (String(s.username || '').toLowerCase() !== user) continue;
    if (!s.password || s.password === password) continue;
    sessionsMap.delete(id);
    dropped += 1;
  }
  return dropped;
}

function createSession(authData) {
  const sessionId = crypto.randomUUID();
  const dropped = evictStaleTwins(authData);
  sessionsMap.set(sessionId, {
    ...authData,
    createdAt: Date.now(),
  });
  saveSessions();
  if (dropped > 0) log.info('sessions_stale_evicted', { url: authData.url, count: dropped });
  return sessionId;
}

function getSession(sessionId) {
  return sessionsMap.get(sessionId);
}

function destroySession(sessionId) {
  sessionsMap.delete(sessionId);
  saveSessions();
}

// Limpeza simples de sessões muito antigas (opcional, p. ex. 30 dias para usuário/senha)
// Sessões baseadas em Token de API não devem ser limpadas, pois duram indefinidamente.
function cleanupSessions() {
  const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 dias
  const now = Date.now();
  let changed = false;

  for (const [id, session] of sessionsMap.entries()) {
    // Se for Token de API, não expira. Se for usuário/senha, expira em 30 dias.
    if (!session.apiKey && now - session.createdAt > MAX_AGE) {
      sessionsMap.delete(id);
      changed = true;
    }
  }

  if (changed) {
    // Roda em setInterval: não deixa um erro de criptografia derrubar o processo.
    try {
      saveSessions();
    } catch (e) {
      console.error('[session] falha ao persistir limpeza de sessões:', e.message);
    }
  }
}

setInterval(cleanupSessions, 12 * 60 * 60 * 1000); // Roda a cada 12h

// Todas as sessões ativas. Usado pelo motor de automações para rodar no
// background com as credenciais de quem está logado, mesmo sem Web Push.
// O `id` vai junto porque quem roda fora de uma requisição HTTP não tem cookie
// e, sem ele, não teria como derrubar uma sessão de credencial vencida.
function listSessions() {
  return Array.from(sessionsMap.entries()).map(([id, s]) => ({ id, ...s }));
}

module.exports = {
  createSession,
  getSession,
  destroySession,
  listSessions,
};
