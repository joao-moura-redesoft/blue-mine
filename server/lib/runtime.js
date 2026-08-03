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

let isSea = false;
try {
  // Disponível a partir do Node 20.6; em Node antigo/pkg o require falha e cai no catch.
  isSea = require('node:sea').isSea();
} catch {
  isSea = false;
}

const isPkg = !!process.pkg;
const isPackaged = isSea || isPkg;

// Pasta gravável para dados de runtime (cofre, sessões, logs, push...).
// Empacotado: ao lado do executável. Dev: a pasta server/ (this file: server/lib).
//
// BLUEMINE_DATA_DIR tem prioridade e existe para testes de integração: sem ele,
// uma segunda instância do servidor grava sessões e inscrições de push por cima
// das do app real — e uma inscrição de teste faria o app de verdade pollar um
// Redmine que não existe. Mesma motivação de BLUEMINE_VAULT_KEY em secureStore.js.
// Não use em produção: apontar para outra pasta órfã os dados já cifrados.
const DATA_DIR =
  process.env.BLUEMINE_DATA_DIR ||
  (isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..'));

module.exports = { isSea, isPkg, isPackaged, DATA_DIR };
