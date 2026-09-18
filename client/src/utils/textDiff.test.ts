import { describe, it, expect } from 'vitest';
import { buildTextDiff, collapseContext, diffLines } from './textDiff';

const text = (l: { op: string; text: string }[], op: string) =>
  l.filter((x) => x.op === op).map((x) => x.text);

describe('diffLines', () => {
  it('mantém as linhas iguais e marca só o que mudou', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc');
    expect(text(lines, 'eq')).toEqual(['a', 'c']);
    expect(text(lines, 'del')).toEqual(['b']);
    expect(text(lines, 'ins')).toEqual(['B']);
  });

  it('linha só inserida não vira alteração de outra', () => {
    const lines = diffLines('a\nc', 'a\nb\nc');
    expect(text(lines, 'del')).toEqual([]);
    expect(text(lines, 'ins')).toEqual(['b']);
  });

  it('realça palavra a palavra quando a linha foi editada', () => {
    const lines = diffLines(
      'Consultar a API Placas para completar marca, modelo, ano',
      'Consultar a API Placas para completar marca, modelo, ano e cor',
    );
    const ins = lines.find((l) => l.op === 'ins');
    expect(ins?.parts?.filter((p) => p.op === 'ins').map((p) => p.text.trim())).toEqual(['e cor']);
    expect(ins?.parts?.map((p) => p.text).join('')).toBe(ins?.text);
  });

  it('não tenta realçar palavras de linhas sem nada em comum', () => {
    const lines = diffLines('cadastro de veículos', 'levantamento e consolidação');
    expect(lines.find((l) => l.op === 'ins')?.parts).toBeUndefined();
  });

  it('texto igual não gera alteração alguma', () => {
    const lines = diffLines('a\nb', 'a\nb');
    expect(lines.every((l) => l.op === 'eq')).toBe(true);
  });

  it('normaliza CRLF e ignora a quebra final', () => {
    expect(diffLines('a\r\nb\r\n', 'a\nb\n').every((l) => l.op === 'eq')).toBe(true);
  });

  it('descrição criada do zero é toda inserção', () => {
    const lines = diffLines('', 'linha nova');
    expect(text(lines, 'ins')).toEqual(['linha nova']);
    expect(text(lines, 'del')).toEqual([]);
  });
});

describe('collapseContext', () => {
  it('esconde as linhas iguais longe da alteração', () => {
    const lines = diffLines(
      Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n'),
      Array.from({ length: 20 }, (_, i) => (i === 10 ? 'MUDOU' : `l${i}`)).join('\n'),
    );
    const rows = collapseContext(lines, 2);
    expect(rows.filter((r) => r.op === 'gap')).toEqual([
      { op: 'gap', count: 8 },
      { op: 'gap', count: 7 },
    ]);
    expect(rows.filter((r) => r.op === 'eq')).toHaveLength(4);
  });

  it('sem alteração nenhuma, colapsa tudo num bloco só', () => {
    expect(collapseContext(diffLines('a\nb\nc', 'a\nb\nc'))).toEqual([{ op: 'gap', count: 3 }]);
  });
});

describe('buildTextDiff', () => {
  it('conta as linhas somadas e removidas', () => {
    const { added, removed } = buildTextDiff('a\nb\nc', 'a\nB\nc\nd');
    expect({ added, removed }).toEqual({ added: 2, removed: 1 });
  });

  it('aguenta texto grande sem estourar o LCS', () => {
    const big = Array.from({ length: 4000 }, (_, i) => `linha ${i}`).join('\n');
    const { added, removed } = buildTextDiff(big, `${big}\nfim`);
    expect({ added, removed }).toEqual({ added: 1, removed: 0 });
  });
});
