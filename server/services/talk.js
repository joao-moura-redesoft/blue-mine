const axios = require('axios');
const { getMyUserId } = require('../lib/redmine');
const { getTalkAuth } = require('./talkStore');
const { safeAgents } = require('../lib/ssrfGuard');
const AppError = require('../lib/AppError');

async function makeTalk(req) {
  const uid = await getMyUserId(req);
  // AppError (isSafe) preserva esta mensagem até o cliente — é o que permite
  // distinguir "sessão do Bluemine caiu" (reconectar o Talk não resolve) de
  // "token do Nextcloud revogado" (reconectar resolve). Um Error comum aqui
  // era mascarado pelo errorMiddleware com um texto genérico, e as duas causas
  // ficavam indistinguíveis no cliente (ver client/src/api/talk.ts).
  if (!uid) throw new AppError(401, 'Não autorizado (Redmine)');

  const auth = getTalkAuth(uid);
  if (!auth) throw new AppError(401, 'Conta do Talk não vinculada');

  return axios.create({
    baseURL: auth.url,
    auth: { username: auth.user, password: auth.token },
    headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
    // Anti-SSRF: a URL do Nextcloud vem da config do usuário. O Nextcloud corporativo
    // é público, então bloquear IPs internos/privados (inclusive em redirects, via o
    // lookup custom do agente) impede usar esse cliente para alcançar a rede interna.
    ...safeAgents(),
  });
}

module.exports = { makeTalk };
