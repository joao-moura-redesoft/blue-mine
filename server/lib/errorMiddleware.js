const log = require('./logger');
const { destroySession } = require('./session');

const NETWORK_RE = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EHOSTUNREACH/;

function sanitizeRedmineBody(data) {
  if (!data) return null;
  if (Array.isArray(data.errors)) return { errors: data.errors };
  return null;
}

function safeNetworkMessage(err) {
  if (NETWORK_RE.test(err.message || '')) return 'Não foi possível conectar ao servidor Redmine.';
  return 'Requisição inválida.';
}

// Credencial vencida (senha trocada no AD): a sessão guarda a senha antiga e
// vale 30 dias, então sem isto o app fica "logado" tentando indefinidamente com
// uma senha que não existe mais. Derrubar a sessão força um login limpo.
// Só dispara com `credentialsStale`, marcado exclusivamente em falha de
// AUTENTICAÇÃO (401) — nunca em 403, que é rotina com a key não-admin.
function shouldDropStaleSession(err, req) {
  return !!(err && err.credentialsStale) && !!(req && req.cookies && req.cookies.session_id);
}

function dropStaleSession(err, req, res) {
  if (!shouldDropStaleSession(err, req)) return;
  try {
    destroySession(req.cookies.session_id);
    res.clearCookie('session_id');
  } catch {
    /* derrubar a sessão é best-effort: não pode mascarar o erro original */
  }
}

// eslint-disable-next-line no-unused-vars
module.exports = function errorMiddleware(err, req, res, next) {
  dropStaleSession(err, req, res);

  // AppError: mensagem intencional, segura para o cliente
  if (err.isSafe) return res.status(err.statusCode).json({ error: err.message });

  const status = err.response?.status || err.statusCode || err.status || 500;

  log.error('request_failed', {
    method: req.method,
    path: req.path,
    status,
    detail: err.response?.data ?? err.message,
    stack: status >= 500 ? err.stack : undefined,
  });

  if (status >= 500) return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });

  if (status === 401 || status === 403)
    return res.status(status).json({ error: 'Credenciais inválidas ou sem permissão.' });

  if (status === 404) return res.status(404).json({ error: 'Recurso não encontrado.' });

  // 4xx: repassa apenas o array de erros do Redmine, nunca o corpo bruto
  const safe = sanitizeRedmineBody(err.response?.data);
  if (safe) return res.status(status).json(safe);

  return res.status(status).json({ error: safeNetworkMessage(err) });
};

// Exposto para teste: a decisão é a parte com regra (401 marcado sim, 403 não),
// enquanto o efeito em si é só delegar para destroySession.
module.exports.shouldDropStaleSession = shouldDropStaleSession;
