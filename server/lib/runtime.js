// Detecção do modo de execução e resolução de caminhos, unificando os três
// formatos em que o Bluemine pode rodar:
//
//   • dev            → `node server/index.js` (a partir do código-fonte)
//   • pkg            → bluemine.exe empacotado com `pkg` (node18-win-x64) [legado]
//   • sea            → bluemine.exe empacotado com Node SEA (Node 20+/22) [novo]
//
// A migração pkg→SEA existe para sair do Node 18 (EOL): o SEA usa o binário de um
// Node LTS suportado. Enquanto os dois coexistem, este módulo é o único ponto que
// sabe distinguir os modos — o resto do código só pergunta DATA_DIR / isPackaged.
const path = require('path');
const fs = require('fs');
const os = require('os');

let isSea = false;
try {
  // Disponível a partir do Node 20.6; em Node antigo/pkg o require falha e cai no catch.
  isSea = require('node:sea').isSea();
} catch {
  isSea = false;
}

const isPkg = !!process.pkg;
const isPackaged = isSea || isPkg;

// Pasta do aplicativo: onde o .exe mora (empacotado) ou a raiz do repositório
// (dev, this file: server/lib). É onde procuramos arquivos que ACOMPANHAM o app e
// só são lidos — .env, redmine-ca.pem —, nunca onde gravamos.
const APP_DIR = isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..', '..');

function isWritable(dir) {
  const probe = path.join(dir, `.bluemine-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

// Pasta gravável para dados de runtime (cofre, sessões, logs, push...).
// Empacotado: ao lado do executável — mas SÓ se der para gravar ali. Instalado em
// Program Files (ou qualquer pasta protegida por ACL), gravar ao lado do .exe
// falha e o app fica sem cofre, sem sessão e sem log; nesse caso cai para
// %LOCALAPPDATA%\Bluemine, que é sempre gravável pelo usuário. Dev: a pasta server/.
//
// BLUEMINE_DATA_DIR tem prioridade e existe para testes de integração: sem ele,
// uma segunda instância do servidor grava sessões e inscrições de push por cima
// das do app real — e uma inscrição de teste faria o app de verdade pollar um
// Redmine que não existe. Mesma motivação de BLUEMINE_VAULT_KEY em secureStore.js.
// Não use em produção: apontar para outra pasta órfã os dados já cifrados.
function resolveDataDir() {
  if (process.env.BLUEMINE_DATA_DIR) return process.env.BLUEMINE_DATA_DIR;
  if (!isPackaged) return path.join(__dirname, '..');
  if (isWritable(APP_DIR)) return APP_DIR;
  const fallback = path.join(process.env.LOCALAPPDATA || os.homedir(), 'Bluemine');
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch {
    // Nem o LOCALAPPDATA dá: devolve a pasta do .exe mesmo e deixa cada gravação
    // falhar com o próprio erro, em vez de esconder o problema aqui.
    return APP_DIR;
  }
  return fallback;
}

const DATA_DIR = resolveDataDir();

module.exports = { isSea, isPkg, isPackaged, APP_DIR, DATA_DIR };
