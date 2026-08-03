const crypto = require('crypto');
const AppError = require('./AppError');

// =========================================================================
// Guarda contra reuso de credencial já reprovada.
//
// Problema que isto resolve: a MESMA senha do AD é usada em Redmine, Zimbra e
// DokuWiki. Quando o usuário troca a senha no AD, a sessão/cofre continuam com
// a antiga e os pollings de fundo (e-mail a cada 2 min, inclusive com a aba em
// segundo plano) seguem tentando autenticar. O `authenticate()` do Zimbra não
// cacheia falha, então era uma tentativa de login no AD por requisição, para
// sempre — caminho direto para BLOQUEIO DA CONTA no domínio.
//
// A guarda memoriza que aquele segredo específico falhou e passa a recusar
// localmente, sem tocar na rede. Como a chave inclui a impressão digital do
// segredo, uma senha NOVA não casa com o registro e é liberada na hora — não
// existe reset manual nem janela de espera para o usuário que já se corrigiu.
//
// Só entra aqui falha de AUTENTICAÇÃO (401/AUTH_FAILED). Serviço fora do ar ou
// erro de rede não conta: bloquear por isso deixaria o usuário travado depois
// que o serviço voltasse.
// =========================================================================

// Sal por processo: o que fica em memória não permite derivar a senha, e ainda
// assim reconhece a repetição do mesmo segredo dentro da execução.
const SALT = crypto.randomBytes(32);

function fingerprint(secret) {
  return crypto
    .createHash('sha256')
    .update(SALT)
    .update(String(secret ?? ''))
    .digest('hex');
}

// scope:user -> { fp, at, count }
const rejected = new Map();

const keyFor = (scope, user) => `${scope}:${String(user ?? '').toLowerCase()}`;

/**
 * Lança 401 quando este par usuário+segredo já foi reprovado neste escopo.
 * Chame ANTES de bater na rede.
 */
function assertNotKnownBad(scope, user, secret) {
  const entry = rejected.get(keyFor(scope, user));
  if (!entry || entry.fp !== fingerprint(secret)) return;

  const err = new AppError(
    401,
    'Sua senha de rede parece ter sido alterada — as credenciais salvas não são mais aceitas. ' +
      'Saia e entre novamente com a senha nova.',
  );
  err.credentialsStale = true;
  throw err;
}

/** Registra reprovação de credencial (só para falha de autenticação de fato). */
function recordFailure(scope, user, secret) {
  const key = keyFor(scope, user);
  const fp = fingerprint(secret);
  const prev = rejected.get(key);
  rejected.set(key, {
    fp,
    at: Date.now(),
    count: prev && prev.fp === fp ? prev.count + 1 : 1,
  });
}

/** Autenticou: limpa qualquer reprovação anterior deste usuário no escopo. */
function recordSuccess(scope, user) {
  rejected.delete(keyFor(scope, user));
}

/** True se as credenciais atuais deste usuário estão marcadas como vencidas. */
function isKnownBad(scope, user, secret) {
  const entry = rejected.get(keyFor(scope, user));
  return !!entry && entry.fp === fingerprint(secret);
}

// Só para teste — evita vazar estado entre casos.
function _reset() {
  rejected.clear();
}

module.exports = {
  assertNotKnownBad,
  recordFailure,
  recordSuccess,
  isKnownBad,
  _reset,
};
