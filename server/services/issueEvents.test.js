/**
 * Barramento "as issues mudaram" (servidor → janela aberta).
 *
 * O servidor já varre o Redmine a cada 60s para o Web Push; antes disto o
 * cliente varria de novo por conta própria a cada 60-90s. Este canal avisa a
 * janela para ela rebuscar sob demanda.
 *
 * O que mais importa aqui é o ISOLAMENTO por conta: um evento entregue à chave
 * errada faria a sessão de um usuário rebuscar por causa da atividade de outro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import issueEvents from './issueEvents.js';

const { subscribe, emit, hasListeners, makeKey, _listeners } = issueEvents;

const A = makeKey('https://redmine.local', 7);
const B = makeKey('https://redmine.local', 99);

describe('issueEvents', () => {
  beforeEach(() => _listeners.clear());

  it('entrega ao assinante da chave', () => {
    const fn = vi.fn();
    subscribe(A, fn);
    emit(A, { reason: 'poll' });
    expect(fn).toHaveBeenCalledWith({ reason: 'poll' });
  });

  it('NÃO entrega a outra conta', () => {
    const outro = vi.fn();
    subscribe(B, outro);
    emit(A, { reason: 'poll' });
    expect(outro).not.toHaveBeenCalled();
  });

  it('a chave separa usuários no mesmo Redmine', () => {
    expect(makeKey('https://r.local', 7)).not.toBe(makeKey('https://r.local', 8));
  });

  it('a chave separa Redmines diferentes para o mesmo id', () => {
    expect(makeKey('https://a.local', 7)).not.toBe(makeKey('https://b.local', 7));
  });

  it('emitir sem ninguém ouvindo é inofensivo', () => {
    expect(() => emit(A, { reason: 'poll' })).not.toThrow();
    expect(emit(A, {})).toBe(0);
  });

  it('vários assinantes da mesma conta recebem todos (duas janelas abertas)', () => {
    const f1 = vi.fn();
    const f2 = vi.fn();
    subscribe(A, f1);
    subscribe(A, f2);
    emit(A, { reason: 'poll' });
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);
  });

  it('cancelar a assinatura para de entregar e limpa a chave (sem vazamento)', () => {
    const fn = vi.fn();
    const off = subscribe(A, fn);
    off();
    emit(A, { reason: 'poll' });
    expect(fn).not.toHaveBeenCalled();
    expect(hasListeners(A)).toBe(false);
    expect(_listeners.has(A)).toBe(false); // não deixa Set órfão acumulando
  });

  it('cancelar um assinante não afeta o outro', () => {
    const f1 = vi.fn();
    const f2 = vi.fn();
    const off1 = subscribe(A, f1);
    subscribe(A, f2);
    off1();
    emit(A, { reason: 'poll' });
    expect(f1).not.toHaveBeenCalled();
    expect(f2).toHaveBeenCalledTimes(1);
  });

  it('um ouvinte que explode não derruba os outros nem o tick do polling', () => {
    // Cenário real: socket morrendo no meio do res.write. O laço do pollPush não
    // pode morrer junto, senão uma janela fechando pararia as notificações.
    const bom = vi.fn();
    subscribe(A, () => {
      throw new Error('socket morto');
    });
    subscribe(A, bom);
    expect(() => emit(A, { reason: 'poll' })).not.toThrow();
    expect(bom).toHaveBeenCalledTimes(1);
  });

  it('hasListeners reflete a existência de janela aberta', () => {
    expect(hasListeners(A)).toBe(false);
    const off = subscribe(A, () => {});
    expect(hasListeners(A)).toBe(true);
    off();
    expect(hasListeners(A)).toBe(false);
  });
});
