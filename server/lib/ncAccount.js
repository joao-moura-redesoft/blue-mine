// Sinais de que uma conta do Nextcloud não existe mais (desativada ou apagada).
//
// Contexto: o vínculo Redmine → Talk é por NOME, tirado do catálogo de contatos
// do sistema (ver services/talkMatch.js). Quando alguém troca de conta, a antiga
// continua no catálogo com o mesmo nome — e as automações seguem falando com um
// fantasma. Como a conta que roda as automações não é admin, nem sempre dá pra
// perguntar ao Nextcloud se a conta está habilitada; aí vale o sinal indireto
// abaixo.

/**
 * A conversa 1:1 que o próprio Nextcloud acabou de abrir tem nome de gente?
 *
 * Numa sala 1:1 o displayName é o nome da outra pessoa. Quando a conta não
 * existe mais, o Nextcloud não resolve nome nenhum e devolve o próprio id
 * (no nosso caso, o UUID do LDAP) — foi assim que a conta morta apareceu na
 * lista de conversas como "DC80B7E9-1F7F-…".
 */
function looksDeadRoom(ncUid, displayName) {
  const dn = String(displayName ?? '').trim();
  if (!dn) return true;
  return (
    dn.toLowerCase() ===
    String(ncUid ?? '')
      .trim()
      .toLowerCase()
  );
}

module.exports = { looksDeadRoom };
