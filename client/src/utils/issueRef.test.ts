import { describe, it, expect } from 'vitest';
import { issueRefRegex, isIssueRef } from './issueRef';

const found = (text: string) => [...text.matchAll(issueRefRegex())].map((m) => m[1]);

describe('issueRefRegex', () => {
  it('reconhece IDs de tarefa (5 e 6 dígitos)', () => {
    expect(found('Impedida pela tarefa #93099')).toEqual(['93099']);
    expect(found('vide #92313 e #100200.')).toEqual(['92313', '100200']);
    expect(found('(#92313)')).toEqual(['92313']);
  });

  it('ignora numeração que não é tarefa', () => {
    expect(found('item #012 da lista')).toEqual([]);
    expect(found('versão #3, chamado #1234')).toEqual([]);
    expect(found('#0092313')).toEqual([]);
  });

  it('ignora "#" colado em palavra, entidade HTML e cabeçalho', () => {
    expect(found('abc#92313')).toEqual([]);
    expect(found('#92313abc')).toEqual([]);
    expect(found('emoji &#128512; aqui')).toEqual([]);
    expect(found('## 92313')).toEqual([]);
  });
});

describe('isIssueRef', () => {
  it('vale a mesma regra para IDs já extraídos', () => {
    expect(isIssueRef(92313)).toBe(true);
    expect(isIssueRef('100200')).toBe(true);
    expect(isIssueRef('012')).toBe(false);
    expect(isIssueRef(1234)).toBe(false);
  });
});
