// Gera server/config-embedded.cjs a partir do .env da raiz e do redmine-ca.pem.
//
// Motivo: o servidor lê VITE_ZIMBRA_HOST, VITE_DOKUWIKI_HOST e SSRF_WHITELIST em
// RUNTIME (não só o frontend no build). Sem isso, distribuir apenas o .exe deixava
// e-mail em 503, wiki sem host e o Talk/Drive bloqueado pelo guard anti-SSRF — o
// usuário final tinha que receber um .env junto e mantê-lo na pasta certa. Embutido,
// o .exe sai autossuficiente; um .env de verdade continua tendo prioridade
// (ver server/lib/embeddedConfig.js).
//
// O módulo gerado é consumido por server/lib/embeddedConfig.js e entra no bundle do
// esbuild, igual ao dist-embedded.cjs do frontend.
//
// Uso: node scripts/embed-config.cjs [envFile] [caFile] [outFile]
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const envFile = path.resolve(root, process.argv[2] || '.env');
const caFile = path.resolve(root, process.argv[3] || 'server/redmine-ca.pem');
const outFile = path.resolve(root, process.argv[4] || 'server/config-embedded.cjs');

// O conteúdo embutido fica LEGÍVEL dentro do .exe (é string no bundle) — vale
// exatamente a mesma regra das variáveis VITE_. Qualquer chave com cara de segredo
// fica de fora, mesmo que alguém a coloque no .env por engano.
const SECRET_RE = /(TOKEN|SECRET|PASSWORD|PASS|PRIVATE|CREDENTIAL|APIKEY|API_KEY|_KEY$)/i;

function readEnv() {
  if (!fs.existsSync(envFile)) {
    console.warn(`[embed-config] ${path.relative(root, envFile)} não encontrado — nada a embutir.`);
    return {};
  }
  const parsed = dotenv.parse(fs.readFileSync(envFile));
  const env = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (SECRET_RE.test(k)) {
      console.warn(`[embed-config] IGNORADA (parece segredo): ${k}`);
      continue;
    }
    env[k] = v;
  }
  return env;
}

function readCa() {
  try {
    return fs.readFileSync(caFile, 'utf8');
  } catch {
    console.warn(`[embed-config] ${path.relative(root, caFile)} não encontrado — CA não embutida.`);
    return null;
  }
}

const env = readEnv();
const ca = readCa();

const banner =
  '// GERADO por scripts/embed-config.cjs — NÃO EDITAR. Config + CA embutidas no build SEA.\n';
fs.writeFileSync(outFile, `${banner}module.exports = ${JSON.stringify({ env, ca }, null, 2)};\n`);

console.log(
  `[embed-config] ${Object.keys(env).length} variável(is)${ca ? ' + CA interna' : ''} → ${path.relative(root, outFile)}`,
);
