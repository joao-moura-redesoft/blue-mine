import { describe, it, expect } from 'vitest';
import { mergeTalkMessages } from './useTalk';
import type { TalkMessage } from '../api/talk';

let seq = 0;
function msg(overrides: Partial<TalkMessage> = {}): TalkMessage {
  seq++;
  return {
    id: seq,
    token: 'room1',
    actorType: 'users',
    actorId: 'ana',
    actorDisplayName: 'Ana',
    timestamp: 1000 + seq,
    message: 'oi',
    messageParameters: {},
    systemMessage: '',
    messageType: 'comment',
    isReplyable: true,
    reactions: {},
    reactionsSelf: [],
    ...overrides,
  };
}

describe('mergeTalkMessages', () => {
  it('sem bolhas pendentes nem mensagens mais novas, devolve fresh como veio', () => {
    const fresh = [msg({ id: 1 }), msg({ id: 2 })];
    expect(mergeTalkMessages([], fresh)).toEqual(fresh);
  });

  it('descarta a bolha otimista quando a mensagem real correspondente chega', () => {
    const optimistic = msg({
      id: 999,
      actorId: 'ana',
      message: 'oi pessoal',
      _status: 'sending',
      _clientText: 'oi pessoal',
    });
    const real = msg({ id: 5, actorId: 'ana', message: 'oi pessoal' });
    const out = mergeTalkMessages([optimistic], [real]);
    expect(out).toEqual([real]);
  });

  it('mantém a bolha "enviando" enquanto a mensagem real ainda não chegou', () => {
    const optimistic = msg({
      id: 999,
      actorId: 'ana',
      message: 'oi pessoal',
      _status: 'sending',
      _clientText: 'oi pessoal',
    });
    const outrasMsgs = [msg({ id: 5, actorId: 'bruno', message: 'outra coisa' })];
    const out = mergeTalkMessages([optimistic], outrasMsgs);
    expect(out).toContainEqual(optimistic);
    expect(out).toHaveLength(2);
  });

  it('casamento por CONTAGEM: 2 bolhas iguais + 1 real correspondente descarta só UMA', () => {
    const bolha1 = msg({ id: 901, actorId: 'ana', message: 'oi', _status: 'sending' });
    const bolha2 = msg({ id: 902, actorId: 'ana', message: 'oi', _status: 'sending' });
    const real = msg({ id: 5, actorId: 'ana', message: 'oi' });
    const out = mergeTalkMessages([bolha1, bolha2], [real]);
    const pendentes = out.filter((m) => m._status === 'sending');
    expect(pendentes).toHaveLength(1);
    expect(out).toContainEqual(real);
  });

  it('bolha "falhou" também é descartada se a mensagem real aparecer (entregou, só a resposta do POST falhou)', () => {
    const falhou = msg({
      id: 901,
      actorId: 'ana',
      message: 'oi',
      _status: 'failed',
      _clientText: 'oi',
    });
    const real = msg({ id: 5, actorId: 'ana', message: 'oi' });
    const out = mergeTalkMessages([falhou], [real]);
    expect(out).toEqual([real]);
  });

  it('read-after-write: preserva mensagem real mais nova que a mais nova do servidor', () => {
    const fresh = [msg({ id: 10 }), msg({ id: 9 })];
    const recemEnviada = msg({ id: 11, actorId: 'ana', message: 'cheguei antes do GET reindexar' });
    const out = mergeTalkMessages([...fresh, recemEnviada], fresh);
    expect(out).toContainEqual(recemEnviada);
  });

  it('NÃO preserva uma mensagem antiga que sumiu do servidor (exclusão real)', () => {
    const fresh = [msg({ id: 10 }), msg({ id: 9 })];
    const excluida = msg({ id: 3, actorId: 'ana', message: 'mensagem apagada' });
    const out = mergeTalkMessages([...fresh, excluida], fresh);
    expect(out).not.toContainEqual(excluida);
  });

  it('fresh vazio (falha transitória) mantém a conversa inteira em vez de zerar', () => {
    const prev = [msg({ id: 1 }), msg({ id: 2 }), msg({ id: 3 })];
    const out = mergeTalkMessages(prev, []);
    expect(out).toEqual(expect.arrayContaining(prev));
    expect(out).toHaveLength(prev.length);
  });
});
