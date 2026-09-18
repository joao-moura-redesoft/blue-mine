import { describe, it, expect } from 'vitest';
import { parseBlockers } from './blockers';

describe('parseBlockers', () => {
  it('lê os dois lados do vínculo feito por comentário', () => {
    const { blockedBy, blocks } = parseBlockers([
      { notes: '⛔ Impedida pela tarefa #93099' },
      { notes: '⛔ Impede a tarefa #92500' },
    ]);
    expect(blockedBy).toEqual([93099]);
    expect(blocks).toEqual([92500]);
  });

  it('aceita o texto escrito na mão, sem ⛔ e sem "tarefa"', () => {
    expect(parseBlockers([{ notes: 'Impedida pela #93099' }]).blockedBy).toEqual([93099]);
    expect(parseBlockers([{ notes: 'impedida pela tarefa #93099' }]).blockedBy).toEqual([93099]);
  });

  it('não repete o mesmo impedimento citado em vários comentários', () => {
    const { blockedBy } = parseBlockers([
      { notes: '⛔ Impedida pela tarefa #93099' },
      { notes: 'ainda impedida pela tarefa #93099' },
    ]);
    expect(blockedBy).toEqual([93099]);
  });

  it('ignora comentário sem vínculo e journal sem nota', () => {
    expect(parseBlockers([{ notes: 'segue o baile #93099' }, {}])).toEqual({
      blockedBy: [],
      blocks: [],
    });
  });

  it('sem journals não quebra', () => {
    expect(parseBlockers(undefined)).toEqual({ blockedBy: [], blocks: [] });
  });
});
