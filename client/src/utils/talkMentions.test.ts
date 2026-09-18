import { describe, it, expect } from 'vitest';
import { applyMentions, mentionSegments, mentionsFromParams } from './talkMentions';

const UUID = '73C8B113-240A-48BC-86DB-BF13851494E7';

describe('applyMentions', () => {
  it('troca o nome exibido pelo id na hora de enviar', () => {
    expect(applyMentions('bom dia @João Victor', { 'João Victor': UUID })).toBe(`bom dia @${UUID}`);
  });

  it('troca todas as ocorrências da mesma pessoa', () => {
    expect(applyMentions('@Ana e de novo @Ana', { Ana: 'ana' })).toBe('@ana e de novo @ana');
  });

  it('casa o nome mais longo primeiro', () => {
    const out = applyMentions('@Ana Maria e @Ana', { Ana: 'ana', 'Ana Maria': 'anamaria' });
    expect(out).toBe('@anamaria e @ana');
  });

  it('cita o id quando ele não é simples', () => {
    expect(applyMentions('oi @Fulano', { Fulano: 'conta de teste' })).toBe('oi @"conta de teste"');
  });

  it('@Todos vira @all', () => {
    expect(applyMentions('@Todos olhem isso', { Todos: 'all' })).toBe('@all olhem isso');
  });

  it('não mexe em texto sem menção conhecida', () => {
    expect(applyMentions('falei com @Sicrano ontem', { Fulano: UUID })).toBe(
      'falei com @Sicrano ontem',
    );
  });

  it('sem menções, devolve o texto igual', () => {
    expect(applyMentions('mensagem simples', {})).toBe('mensagem simples');
  });
});

describe('mentionSegments', () => {
  const seg = (text: string, map: Record<string, string>) =>
    mentionSegments(text, map)
      .filter((s) => s.t)
      .map((s) => (s.isMention ? `[${s.t}]` : s.t));

  it('separa a menção do texto ao redor', () => {
    expect(seg('vou fazer pra ajudar @Germano Reis hoje', { 'Germano Reis': 'x' })).toEqual([
      'vou fazer pra ajudar ',
      '[@Germano Reis]',
      ' hoje',
    ]);
  });

  it('realça o nome mais longo, não o prefixo', () => {
    expect(seg('@Ana Maria', { Ana: 'a', 'Ana Maria': 'am' })).toEqual(['[@Ana Maria]']);
  });

  it('não realça nome sem @ nem menção desconhecida', () => {
    expect(seg('Ana e @Bruno', { Ana: 'a' })).toEqual(['Ana e @Bruno']);
  });

  it('sem menções, devolve o texto inteiro', () => {
    expect(seg('só texto', {})).toEqual(['só texto']);
  });

  it('nome vazio no mapa não vira coringa', () => {
    expect(seg('abc', { '': 'x' })).toEqual(['abc']);
  });
});

describe('mentionsFromParams', () => {
  it('lê as menções de uma mensagem já enviada', () => {
    expect(
      mentionsFromParams({
        'mention-user1': { type: 'user', id: UUID, name: 'João Victor' },
      }),
    ).toEqual({ 'João Victor': UUID });
  });

  it('prefere mention-id quando o servidor manda os dois', () => {
    expect(
      mentionsFromParams({
        'mention-user1': { type: 'user', id: 'interno', 'mention-id': 'publico', name: 'Ana' },
      }),
    ).toEqual({ Ana: 'publico' });
  });

  it('menção a todos volta como all, não como o token da sala', () => {
    expect(
      mentionsFromParams({ 'mention-call1': { type: 'call', id: 'abc123', name: 'Equipe' } }),
    ).toEqual({ Equipe: 'all' });
  });

  it('ignora arquivo e parâmetros sem nome', () => {
    expect(
      mentionsFromParams({
        file: { type: 'file', id: '9', name: 'foto.png' },
        x: { type: 'user', id: 'sem-nome' },
      }),
    ).toEqual({});
  });
});
