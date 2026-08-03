// Logger estruturado leve (sem dependência externa, para não pesar no bundle pkg).
//
// Emite uma linha JSON por evento em stdout e, opcionalmente, num arquivo em
// disco (LOG_FILE) — este último alimenta o export de diagnóstico, permitindo
// investigar um problema na máquina do usuário sem acesso remoto a ela.
//
// Nível mínimo via LOG_LEVEL (debug|info|warn|error, padrão info).
// SEGREDOS NUNCA são logados: campos sensíveis são redigidos por nome.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./secureStore');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

// Arquivo de log (opcional). Por padrão gravamos um bluemine.log ao lado dos
// dados, com rotação simples por tamanho, para o export de diagnóstico.
const LOG_FILE = process.env.LOG_FILE || path.join(DATA_DIR, 'bluemine.log');
const LOG_TO_FILE = process.env.LOG_TO_FILE !== '0';
const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2 MB → rotaciona para .1

// Chaves cujo valor é sempre redigido, em qualquer profundidade.
const SECRET_KEYS =
  /^(pass|password|senha|token|apikey|api_key|key|secret|authorization|cookie|apppassword|privatekey)$/i;

function redact(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ── Gravação em arquivo: bufferizada e assíncrona ──────────────────────────
//
// Antes era um fs.appendFileSync POR LINHA de log, no caminho de toda requisição
// — cada log parava a event loop esperando o disco. Agora as linhas se acumulam
// num buffer e vão para o disco em lote, fora do caminho crítico.
//
// O que continua garantido: nada se perde quando o processo termina. O flush é
// refeito de forma SÍNCRONA no evento 'exit' (único lugar onde só APIs síncronas
// funcionam), e um log de nível `error` força flush imediato — se um crash vem
// logo depois, a causa já está no arquivo.
const FLUSH_MS = 1000;
const MAX_PENDING = 2000; // teto de segurança se o disco travar: descarta o excesso

let pending = [];
let flushTimer = null;
let writing = false;
let dropped = 0;

function rotateIfNeededSync() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    /* arquivo ainda não existe */
  }
}

function takePending() {
  if (dropped > 0) {
    pending.push(
      JSON.stringify({
        t: new Date().toISOString(),
        level: 'warn',
        msg: 'log_lines_dropped',
        count: dropped,
      }),
    );
    dropped = 0;
  }
  const chunk = pending.join('\n') + '\n';
  pending = [];
  return chunk;
}

function flushAsync() {
  flushTimer = null;
  // `writing` evita dois appends concorrentes intercalando linhas no arquivo.
  if (writing || pending.length === 0) return;
  writing = true;
  const chunk = takePending();
  rotateIfNeededSync(); // stat+rename só no flush (1x/s), não por linha
  fs.appendFile(LOG_FILE, chunk, () => {
    writing = false;
    // Chegou coisa nova enquanto gravávamos: agenda o próximo lote.
    if (pending.length > 0) scheduleFlush();
  });
}

function scheduleFlush() {
  if (flushTimer || writing) return;
  // unref: um log pendente não segura o processo vivo.
  flushTimer = setTimeout(flushAsync, FLUSH_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

// Gravação síncrona do buffer. Usada em dois pontos onde a linha NÃO pode ficar
// em voo: o encerramento do processo ('exit', onde só APIs síncronas rodam) e o
// nível `error`.
//
// Se houver um append assíncrono em andamento, este write ainda é seguro — os
// dois abrem em modo append, então cada um pousa inteiro no fim do arquivo; no
// pior caso um lote de `info` aparece depois de um `error` quase simultâneo.
// Trocar ordem por não perder o log de um crash é o negócio certo aqui.
function flushSync() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.length === 0) return;
  try {
    rotateIfNeededSync();
    fs.appendFileSync(LOG_FILE, takePending());
  } catch {
    /* disco cheio / sem permissão: não derruba o processo */
  }
}

if (LOG_TO_FILE) {
  process.on('exit', flushSync);
}

function write(level, msg, fields) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const entry = { t: new Date().toISOString(), level, msg, ...redact(fields || {}) };
  const line = JSON.stringify(entry);
  // stdout continua legível no terminal do dev.
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  if (!LOG_TO_FILE) return;

  if (pending.length >= MAX_PENDING) {
    dropped++; // disco travado: perder linha é melhor que estourar a memória
    return;
  }
  pending.push(line);

  // Erro pode ser o último suspiro antes de um crash — precisa estar NO DISCO
  // quando `write` retorna, não apenas entregue ao fs. Um flush assíncrono aqui
  // deixaria a linha em voo e ela se perderia justamente no caso que importa.
  // Erros são raros, então pagar o I/O síncrono neles é barato.
  if (level === 'error') flushSync();
  else scheduleFlush();
}

module.exports = {
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
  LOG_FILE,
  // Exportado para os testes e para quem precise garantir a gravação num ponto
  // específico (ex.: antes de um process.exit() explícito).
  flushSync,
};
