/**
 * Barramento "o Talk mudou" (servidor → janela aberta). Mesmo padrão do
 * issueEvents.js, chaveado por uid do Redmine em vez de url+userId.
 *
 * O que mais importa aqui é o ISOLAMENTO por uid: um evento entregue ao uid
 * errado faria a sessão de um usuário rebuscar por causa da atividade de
 * outro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import talkEvents from './talkEvents.js';

const { subscribe, emit, _listeners } = talkEvents;

describe('talkEvents', () => {
  beforeEach(() => _listeners.clear());

  it('entrega ao assinante do uid', () => {
    const fn = vi.fn();
    subscribe(7, fn);
    emit(7, { reason: 'poll', token: 'abc' });
    expect(fn).toHaveBeenCalledWith({ reason: 'poll', token: 'abc' });
  });

  it('NÃO entrega a outro uid', () => {
    const outro = vi.fn();
    subscribe(99, outro);
    emit(7, { reason: 'poll' });
    expect(outro).not.toHaveBeenCalled();
  });

  it('emitir sem ninguém ouvindo é inofensivo', () => {
    expect(() => emit(7, { reason: 'poll' })).not.toThrow();
    expect(emit(7, {})).toBe(0);
  });

  it('vários assinantes do mesmo uid recebem todos (duas janelas abertas)', () => {
    const f1 = vi.fn();
    const f2 = vi.fn();
    subscribe(7, f1);
    subscribe(7, f2);
    emit(7, { reason: 'poll' });
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);
  });

  it('cancelar a assinatura para de entregar e limpa a chave (sem vazamento)', () => {
    const fn = vi.fn();
    const off = subscribe(7, fn);
    off();
    emit(7, { reason: 'poll' });
    expect(fn).not.toHaveBeenCalled();
    expect(_listeners.has(7)).toBe(false); // não deixa Set órfão acumulando
  });

  it('um ouvinte que explode não derruba os outros nem o tick do polling', () => {
    // Cenário real: socket morrendo no meio do res.write. O laço do
    // pollTalkGroup não pode morrer junto, senão uma janela fechando pararia
    // as notificações de Talk das demais.
    const bom = vi.fn();
    subscribe(7, () => {
      throw new Error('socket morto');
    });
    subscribe(7, bom);
    expect(() => emit(7, { reason: 'poll' })).not.toThrow();
    expect(bom).toHaveBeenCalledTimes(1);
  });
});
