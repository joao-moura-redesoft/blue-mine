import { describe, it, expect } from 'vitest';
import { extractIssueRefs, linkIssueRefs } from './issueRefLinks';
import type { IssueRefInfo } from './issueStatus';

const info = (over: Partial<IssueRefInfo> = {}): IssueRefInfo => ({
  id: 93099,
  subject: 'Ajustar portal',
  status: { id: 3, name: 'Em Desenvolvimento' },
  ...over,
});

describe('extractIssueRefs', () => {
  it('coleta os IDs uma vez só, na ordem do texto', () => {
    expect(extractIssueRefs('vide #93099, #92313 e #93099 de novo')).toEqual([93099, 92313]);
  });

  it('ignora código, link markdown e URL', () => {
    expect(extractIssueRefs('use `#93099` no comando')).toEqual([]);
    expect(extractIssueRefs('```\n#93099\n```')).toEqual([]);
    expect(extractIssueRefs('[a tarefa](http://x/y#93099)')).toEqual([]);
    expect(extractIssueRefs('http://redmine/issues/#93099')).toEqual([]);
  });

  it('ignora o que não é ID de tarefa', () => {
    expect(extractIssueRefs('item #012 e versão #3')).toEqual([]);
  });
});

describe('linkIssueRefs', () => {
  it('vira chip com ponto de status e tooltip quando a tarefa existe', () => {
    const html = linkIssueRefs('Impedida pela tarefa #93099', new Map([[93099, info()]]));
    expect(html).toContain('href="#rk-issue-93099"');
    expect(html).toContain('bg-blue-500'); // "Em Desenvolvimento"
    expect(html).toContain('title="#93099 — Ajustar portal');
  });

  it('não linka referência que não existe', () => {
    const html = linkIssueRefs('vide #93099', new Map([[93099, null]]));
    expect(html).toBe('vide #93099');
  });

  it('linka sem tooltip enquanto os dados não chegaram', () => {
    const html = linkIssueRefs('vide #93099', new Map());
    expect(html).toContain('href="#rk-issue-93099"');
    expect(html).toContain('title="Abrir #93099"');
    expect(html).not.toContain('rk-issue-dot');
  });

  it('escapa o assunto no atributo title', () => {
    const html = linkIssueRefs(
      '#93099',
      new Map([[93099, info({ subject: 'Aspas " e <script>' })]]),
    );
    expect(html).toContain('&quot;');
    expect(html).not.toContain('<script>');
  });

  it('não mexe em código nem em link markdown', () => {
    const byId = new Map([[93099, info()]]);
    expect(linkIssueRefs('`#93099`', byId)).toBe('`#93099`');
    expect(linkIssueRefs('[x](http://a/b#93099)', byId)).toBe('[x](http://a/b#93099)');
  });
});
