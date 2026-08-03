/**
 * Override da pasta de dados (BLUEMINE_DATA_DIR).
 *
 * Existe para teste de integração: sem ele, uma segunda instância do servidor
 * grava sessões e inscrições de push POR CIMA das do app real — e uma inscrição
 * de teste faria o app de verdade pollar um Redmine que não existe, a cada 60s.
 * Não é risco teórico: é exatamente o que aconteceria ao subir um servidor de
 * teste nesta máquina.
 *
 * Mesma motivação de BLUEMINE_VAULT_KEY em secureStore.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL = process.env.BLUEMINE_DATA_DIR;

async function loadRuntime() {
  vi.resetModules(); // DATA_DIR é resolvido no require
  return import('./runtime.js');
}

describe('DATA_DIR', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.BLUEMINE_DATA_DIR;
    else process.env.BLUEMINE_DATA_DIR = ORIGINAL;
  });

  it('sem override, aponta para a pasta do servidor', async () => {
    delete process.env.BLUEMINE_DATA_DIR;
    const { DATA_DIR } = await loadRuntime();
    expect(DATA_DIR.replace(/\\/g, '/')).toMatch(/\/server$/);
  });

  it('BLUEMINE_DATA_DIR tem prioridade', async () => {
    process.env.BLUEMINE_DATA_DIR = '/tmp/bluemine-teste';
    const { DATA_DIR } = await loadRuntime();
    expect(DATA_DIR).toBe('/tmp/bluemine-teste');
  });

  it('com override, NÃO aponta mais para a pasta real do servidor', async () => {
    process.env.BLUEMINE_DATA_DIR = '/tmp/bluemine-teste';
    const { DATA_DIR } = await loadRuntime();
    // É esta garantia que impede o servidor de teste de sobrescrever
    // sessions.json / push-subscriptions.json / vault-key.json do app real.
    expect(DATA_DIR.replace(/\\/g, '/')).not.toMatch(/\/server$/);
  });

  it('valor vazio é ignorado (não vira pasta "")', async () => {
    process.env.BLUEMINE_DATA_DIR = '';
    const { DATA_DIR } = await loadRuntime();
    expect(DATA_DIR).toBeTruthy();
    expect(DATA_DIR.replace(/\\/g, '/')).toMatch(/\/server$/);
  });
});
