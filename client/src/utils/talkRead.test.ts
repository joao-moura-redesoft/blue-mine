import { describe, it, expect, beforeEach } from 'vitest';
import { talkRead } from './talkRead';

describe('talkRead', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('começa em 0 para uma sala nunca vista', () => {
    expect(talkRead.get('sala-1')).toBe(0);
  });

  it('avança o marcador e devolve true', () => {
    expect(talkRead.set('sala-1', 10)).toBe(true);
    expect(talkRead.get('sala-1')).toBe(10);
  });

  it('é monotônico — não retrocede mesmo com um id menor', () => {
    talkRead.set('sala-1', 10);
    expect(talkRead.set('sala-1', 5)).toBe(false);
    expect(talkRead.get('sala-1')).toBe(10);
  });

  it('reenviar o mesmo id não conta como avanço', () => {
    talkRead.set('sala-1', 10);
    expect(talkRead.set('sala-1', 10)).toBe(false);
  });

  it('token ou messageId vazio não faz nada', () => {
    expect(talkRead.set('', 10)).toBe(false);
    expect(talkRead.set('sala-1', 0)).toBe(false);
    expect(talkRead.get('sala-1')).toBe(0);
  });

  it('mantém o marcador de cada sala separado', () => {
    talkRead.set('sala-1', 10);
    talkRead.set('sala-2', 3);
    expect(talkRead.get('sala-1')).toBe(10);
    expect(talkRead.get('sala-2')).toBe(3);
  });

  it('sobrevive a um localStorage corrompido (JSON inválido)', () => {
    localStorage.setItem('talk:lastRead', '{not json');
    expect(talkRead.get('sala-1')).toBe(0);
    expect(talkRead.set('sala-1', 7)).toBe(true);
    expect(talkRead.get('sala-1')).toBe(7);
  });
});
