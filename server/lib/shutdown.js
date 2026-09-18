// Encerramento ordenado do processo. Existe porque o .exe roda como app GUI (sem
// console): não há Ctrl+C, então quem pede para sair é o ícone da bandeja
// (services/tray.js → POST /api/tray/quit) ou um sinal, em dev.
//
// Cada parte interessada registra um handler (fechar o listen, desligar workers);
// no fim gravamos o log bufferizado e saímos. O timeout final não é opcional:
// conexões SSE abertas (routes/events) impedem o `server.close()` de completar,
// então o processo NUNCA sairia sozinho esperando o fechamento limpo.
const log = require('./logger');

const handlers = [];
let shuttingDown = false;

// Registra uma função (sync ou async) a ser executada no encerramento.
function onShutdown(fn) {
  if (typeof fn === 'function') handlers.push(fn);
}

// Prazo máximo para os handlers antes do exit forçado.
const GRACE_MS = 800;

async function requestShutdown(reason = 'unknown', code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown_requested', { reason });

  const forced = setTimeout(() => {
    try {
      log.flushSync();
    } catch {
      /* saindo de qualquer jeito */
    }
    process.exit(code);
  }, GRACE_MS);

  for (const fn of handlers) {
    try {
      await fn();
    } catch {
      /* best-effort: um handler ruim não pode travar a saída */
    }
  }

  clearTimeout(forced);
  try {
    log.flushSync();
  } catch {
    /* idem */
  }
  process.exit(code);
}

module.exports = { onShutdown, requestShutdown };
