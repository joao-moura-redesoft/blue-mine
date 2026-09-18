// CA extra para instalações atrás de um certificado emitido por uma CA interna/
// autoassinada — nesta empresa, Redmine, Nextcloud (Talk) e Zimbra usam a MESMA CA
// corporativa, então uma única raiz cobre os três. Três fontes, somadas: a loja de
// certificados do sistema (onde a CA corporativa já chega via GPO), a CA embutida no
// .exe pelo build (scripts/embed-config.cjs — cobre máquina fora do domínio) e o
// arquivo opcional `redmine-ca.pem` na pasta de dados (nome mantido por
// compatibilidade com quem já gerou o arquivo, e o jeito de trocar a CA sem gerar
// build novo). NUNCA desliga a validação de TLS: só ADICIONA essas
// raízes à lista de raízes públicas já confiadas pelo Node (tls.rootCertificates —
// NÃO https.rootCertificates, que não existe), então instalações sem CA interna
// continuam com o comportamento padrão (só CAs públicas).
//
// Exporta `loadCaList()` (lista crua, pra quem precisa COMBINAR com outra opção do
// agente — ex.: ssrfGuard.js, que já usa um `lookup` customizado e não pode simplesmente
// sobrescrever o agente inteiro) e `getInternalCaAgent()` (agente pronto, pra quem não
// precisa de mais nada — Redmine, Zimbra).
const path = require('path');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const { dataFile } = require('./secureStore');
const { APP_DIR } = require('./runtime');
const { embeddedCa } = require('./embeddedConfig');

const CA_FILE = 'redmine-ca.pem';

// Onde procurar o .pem, em ordem. DATA_DIR e APP_DIR são a mesma pasta no caso
// comum, mas divergem quando o .exe está numa pasta protegida (dados vão para o
// LOCALAPPDATA) e em dev (dados em server/, arquivo versionado em server/). Sem o
// último caminho, um exe gerado na raiz do repositório não enxerga o .pem que já
// existe em server/ e todo HTTPS interno falha com "self-signed certificate in
// certificate chain".
function certPaths() {
  return [
    ...new Set([
      dataFile(CA_FILE),
      path.join(APP_DIR, CA_FILE),
      path.join(APP_DIR, 'server', CA_FILE),
    ]),
  ];
}

function readCertFile() {
  for (const p of certPaths()) {
    try {
      return { pem: fs.readFileSync(p, 'utf8'), path: p };
    } catch (e) {
      // ENOENT é o caso normal pra quem não tem CA interna — silencioso.
      // Qualquer outro erro (permissão, CA malformada) precisa aparecer no log.
      if (e.code !== 'ENOENT') console.error('[tls] falha ao ler CA interna de', p, '-', e.message);
    }
  }
  return null;
}

// Raízes instaladas na máquina (loja de certificados do Windows). A CA corporativa
// que intercepta o TLS já é distribuída por lá via GPO, então isto cobre o caso
// mesmo sem o .pem ao lado do exe. Node >= 22.15; em runtime mais antigo devolve
// vazio e sobra o arquivo.
function systemCertificates() {
  if (typeof tls.getCACertificates !== 'function') return [];
  try {
    return tls.getCACertificates('system') || [];
  } catch (e) {
    console.error('[tls] falha ao ler as CAs do sistema -', e.message);
    return [];
  }
}

let caList; // undefined = ainda não checou; null = nada a adicionar às raízes públicas
function loadCaList() {
  if (caList !== undefined) return caList;
  const file = readCertFile();
  const builtIn = embeddedCa(); // embutida no .exe pelo build
  const system = systemCertificates();
  const extras = [...system, ...(builtIn ? [builtIn] : []), ...(file ? [file.pem] : [])];
  if (extras.length === 0) {
    caList = null;
    return caList;
  }
  // Duplicar a mesma CA (embutida + arquivo + loja do sistema) é inofensivo: o
  // OpenSSL só precisa achar UMA raiz que valide a cadeia.
  caList = [...tls.rootCertificates, ...extras];
  console.log(
    '[tls] CAs extras carregadas:',
    `${system.length} do sistema`,
    builtIn ? '+ embutida no exe' : '',
    file ? `+ arquivo ${file.path}` : '',
  );
  return caList;
}

// keepAlive: sem isso cada request a Redmine/Talk/Zimbra paga um handshake TLS
// completo. Aqui a rede corporativa intercepta o TLS, então o handshake é ainda
// mais caro que o normal — reusar a conexão é o maior ganho por linha do server.
// maxSockets segura o paralelismo do mapLimit/Promise.all sem virar enxurrada.
const KEEP_ALIVE_OPTS = { keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 32 };

let agent; // undefined = ainda não construiu
function getInternalCaAgent() {
  if (agent !== undefined) return agent;
  const list = loadCaList();
  agent = list ? new https.Agent({ ...KEEP_ALIVE_OPTS, ca: list }) : null;
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
