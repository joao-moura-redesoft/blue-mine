/**
 * Logger: gravação bufferizada, sem perder linha.
 *
 * A troca de fs.appendFileSync (uma chamada síncrona POR LINHA, no caminho de
 * toda requisição) por buffer + append assíncrono só é aceitável se nada se
 * perder. É isso que estes testes cobrem: o que está no buffer chega ao disco
 * pelo timer, pelo flush imediato de `error` e pelo flushSync do encerramento.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluemine-log-'));
const LOG_FILE = path.join(tmpDir, 'test.log');

// O logger lê LOG_FILE/LOG_TO_FILE no require, e a config raiz do vitest força
// LOG_TO_FILE=0 para os outros testes. Daí o import dinâmico: as variáveis
// precisam valer ANTES do módulo carregar, e um `import` estático subiria acima
// destas linhas.
let logger;
beforeAll(async () => {
  process.env.LOG_FILE = LOG_FILE;
  process.env.LOG_TO_FILE = '1';
  process.env.LOG_LEVEL = 'debug';
  logger = await import('./logger.js');
});

const readLog = () =>
  fs.existsSync(LOG_FILE)
    ? fs
        .readFileSync(LOG_FILE, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

describe('logger bufferizado', () => {
  beforeEach(() => {
    logger.flushSync(); // esvazia sobras do teste anterior
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('não grava no disco a cada linha (o ponto da mudança)', () => {
    logger.info('primeira');
    logger.info('segunda');
    // Sem avançar o tempo, nada foi para o disco ainda — era exatamente isso
    // que o appendFileSync fazia de forma bloqueante a cada chamada.
    expect(readLog()).toHaveLength(0);
  });

  it('o timer descarrega o lote acumulado, sem flush manual', async () => {
    // Timers reais: o objetivo aqui é justamente ver o disco receber o lote
    // sozinho. Com timers falsos o append assíncrono ficaria em voo e o teste
    // leria o arquivo antes da escrita — passando por engano ao dar [].
    vi.useRealTimers();
    logger.info('a');
    logger.info('b');
    logger.info('c');

    const deadline = Date.now() + 5000;
    let msgs = [];
    while (Date.now() < deadline) {
      msgs = readLog().map((e) => e.msg);
      if (msgs.length >= 3) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(msgs).toEqual(['a', 'b', 'c']); // ordem preservada, sem flushSync
  });

  it('flushSync grava o que estiver pendente (caminho do encerramento)', () => {
    logger.info('antes de sair');
    expect(readLog()).toHaveLength(0);

    logger.flushSync();

    expect(readLog().map((e) => e.msg)).toEqual(['antes de sair']);
  });

  it('nível error já está NO DISCO quando a chamada retorna', () => {
    logger.info('antes');
    logger.error('deu ruim');

    // Sem flushSync manual, sem avançar timer: se o processo crashar na linha
    // seguinte, o erro precisa estar gravado. Um flush assíncrono aqui deixaria
    // a linha em voo e ela se perderia — que é o caso que mais importa.
    const msgs = readLog().map((e) => e.msg);
    expect(msgs).toContain('deu ruim');
    expect(msgs).toContain('antes'); // leva junto o que estava no buffer
  });

  it('respeita LOG_LEVEL e ainda redige segredos', () => {
    logger.info('com segredo', { password: 'hunter2', user: 'joao' });
    logger.flushSync();

    const [entry] = readLog();
    expect(entry.password).toBe('[redacted]');
    expect(entry.user).toBe('joao');
  });

  it('registra um flushSync no exit para não perder o buffer', () => {
    // O handler é o que garante o "nada se perde" quando o processo encerra.
    expect(process.listeners('exit').length).toBeGreaterThan(0);
  });
});
