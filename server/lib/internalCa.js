// CA extra para instalações atrás de um certificado emitido por uma CA interna/
// autoassinada — nesta empresa, Redmine, Nextcloud (Talk) e Zimbra usam a MESMA CA
// corporativa, então um único arquivo cobre os três. Arquivo opcional
// `redmine-ca.pem` na pasta de dados (nome mantido por compatibilidade com quem já
// gerou o arquivo). NUNCA desliga a validação de TLS: só ADICIONA essa CA à lista de
// raízes públicas já confiadas pelo Node (tls.rootCertificates — NÃO
// https.rootCertificates, que não existe), então instalações sem esse arquivo
// continuam com o comportamento padrão (só CAs públicas).
//
// Exporta `loadCaList()` (lista crua, pra quem precisa COMBINAR com outra opção do
// agente — ex.: ssrfGuard.js, que já usa um `lookup` customizado e não pode simplesmente
// sobrescrever o agente inteiro) e `getInternalCaAgent()` (agente pronto, pra quem não
// precisa de mais nada — Redmine, Zimbra).
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const { dataFile } = require('./secureStore');

let caList; // undefined = ainda não checou; null = arquivo não existe
function loadCaList() {
  if (caList !== undefined) return caList;
  const certPath = dataFile('redmine-ca.pem');
  try {
    const ca = fs.readFileSync(certPath, 'utf8');
    caList = [...tls.rootCertificates, ca];
    console.log('[tls] CA interna carregada de', certPath);
  } catch (e) {
    caList = null;
    // ENOENT (arquivo não existe) é o caso normal pra quem não tem CA interna — silencioso.
    // Qualquer outro erro (CA malformada, bug de código) precisa aparecer no log.
    if (e.code !== 'ENOENT') {
      console.error('[tls] falha ao carregar CA interna de', certPath, '-', e.message);
    }
  }
  return caList;
}

let agent; // undefined = ainda não construiu
function getInternalCaAgent() {
  if (agent !== undefined) return agent;
  const list = loadCaList();
  agent = list ? new https.Agent({ ca: list }) : null;
  return agent;
}

// Aplica a CA globalmente (tls.setDefaultCACertificates, Node 22+) — cobre TUDO,
// inclusive o que os `httpsAgent` explícitos acima não alcançam: o `fetch` nativo
// usado internamente pelos SDKs de IA (OpenAI/Anthropic), que não expõem um jeito
// de passar um https.Agent do Node. NODE_EXTRA_CA_CERTS faria a mesma coisa, mas só
// funciona se definido ANTES do processo Node iniciar (variável de ambiente real,
// não `process.env.X =` em código) — inviável de garantir no exe empacotado.
// Best-effort: em Node < 22 (ex.: runtime mais antigo do build empacotado) essa
// função não existe — nesse caso os `httpsAgent` explícitos continuam cobrindo o
// axios (Redmine/Zimbra/DokuWiki/Nextcloud), só os SDKs de IA ficam sem.
function applyGlobalCaTrust() {
  const list = loadCaList();
  if (!list || typeof tls.setDefaultCACertificates !== 'function') return false;
  try {
    tls.setDefaultCACertificates(list);
    console.log('[tls] CA interna aplicada globalmente (tls.setDefaultCACertificates)');
    return true;
  } catch (e) {
    console.error('[tls] falha ao aplicar CA interna globalmente:', e.message);
    return false;
  }
}

module.exports = { loadCaList, getInternalCaAgent, applyGlobalCaTrust };
