import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordLocalDecrement, guard, clear } from './mailUnreadGuard';

describe('mailUnreadGuard', () => {
  beforeEach(() => {
    clear();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sem leitura local, deixa o valor do servidor passar direto', () => {
    expect(guard(3)).toBe(3);
  });

  it('suprime o eco do Zimbra entre floor e ceiling após leitura local', () => {
    recordLocalDecrement(1, 0);
    expect(guard(1)).toBe(0);
  });

  it('mantém a guarda armada após suprimir (eco pode repetir no próximo poll)', () => {
    recordLocalDecrement(1, 0);
    expect(guard(1)).toBe(0);
    expect(guard(1)).toBe(0);
  });

  it('deixa passar valor genuinamente acima do teto pré-leitura e desarma', () => {
    recordLocalDecrement(1, 0);
    expect(guard(2)).toBe(2);
    // guarda desarmada: um eco de volta a 1 agora passa direto
    expect(guard(1)).toBe(1);
  });

  it('estende a janela (min floor / max ceiling) em leituras consecutivas', () => {
    recordLocalDecrement(3, 2);
    recordLocalDecrement(2, 1);
    // eco do valor mais antigo (3, anterior à primeira leitura) ainda suprimido
    expect(guard(3)).toBe(1);
    expect(guard(2)).toBe(1);
  });

  it('expira a supressão depois do período de graça', () => {
    recordLocalDecrement(1, 0);
    vi.setSystemTime(5 * 60_000 + 1);
    expect(guard(1)).toBe(1);
  });

  it('clear() desarma a guarda imediatamente', () => {
    recordLocalDecrement(1, 0);
    clear();
    expect(guard(1)).toBe(1);
  });

  it('ignora leitura local que não é decremento', () => {
    recordLocalDecrement(1, 1);
    expect(guard(1)).toBe(1);
  });
});
