import { describe, it, expect } from 'vitest';
import {
  extractMermaidBlocks,
  hasMermaid,
  splitMermaid,
  diagramFilename,
  svgSize,
  prepareForRaster,
} from './mermaid';

describe('extractMermaidBlocks', () => {
  it('extrai um bloco simples', () => {
    const md = 'Antes\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nDepois';
    const b = extractMermaidBlocks(md);
    expect(b).toHaveLength(1);
    expect(b[0].code).toBe('flowchart LR\n  A --> B');
    expect(md.includes(b[0].raw)).toBe(true);
  });

  it('extrai vários blocos na ordem', () => {
    const md =
      '```mermaid\ngraph TD\nA-->B\n```\ntexto\n```mermaid\nsequenceDiagram\nX->>Y: oi\n```';
    const b = extractMermaidBlocks(md);
    expect(b.map((x) => x.code.split('\n')[0])).toEqual(['graph TD', 'sequenceDiagram']);
  });

  it('ignora blocos de código de outras linguagens', () => {
    expect(extractMermaidBlocks('```js\nconst a = 1;\n```')).toEqual([]);
    expect(extractMermaidBlocks('```\nmermaid\n```')).toEqual([]);
  });

  it('ignora bloco mermaid vazio', () => {
    expect(extractMermaidBlocks('```mermaid\n\n```')).toEqual([]);
  });

  it('aceita cerca indentada e com mais de 3 backticks', () => {
    const b = extractMermaidBlocks('  ```` mermaid  \n  graph TD\n  A-->B\n  ````');
    expect(b).toHaveLength(1);
  });

  it('hasMermaid segue a extração', () => {
    expect(hasMermaid('```mermaid\ngraph TD\nA-->B\n```')).toBe(true);
    expect(hasMermaid('nada aqui')).toBe(false);
    expect(hasMermaid('')).toBe(false);
  });
});

describe('splitMermaid', () => {
  it('texto sem diagrama volta como uma parte só', () => {
    const parts = splitMermaid('só texto');
    expect(parts).toEqual([{ type: 'markdown', content: 'só texto' }]);
  });

  it('alterna markdown e diagramas', () => {
    const md = 'a\n\n```mermaid\ngraph TD\nA-->B\n```\n\nb';
    const parts = splitMermaid(md);
    expect(parts.map((p) => p.type)).toEqual(['markdown', 'mermaid', 'markdown']);
    expect(parts[1].content).toBe('graph TD\nA-->B');
    expect(parts[2].content.trim()).toBe('b');
  });

  it('diagrama sozinho não gera partes de markdown vazias', () => {
    const parts = splitMermaid('```mermaid\ngraph TD\nA-->B\n```');
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('mermaid');
  });

  it('dois diagramas seguidos', () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```\n```mermaid\ngraph LR\nC-->D\n```';
    const parts = splitMermaid(md);
    expect(parts.map((p) => p.type)).toEqual(['mermaid', 'mermaid']);
  });

  it('preserva o texto integralmente (nada se perde)', () => {
    const md =
      'início\n\n```mermaid\ngraph TD\nA-->B\n```\n\nmeio\n\n```mermaid\ngraph LR\nC-->D\n```\n\nfim';
    const rejoined = splitMermaid(md)
      .map((p) => p.content)
      .join('');
    for (const piece of ['início', 'meio', 'fim', 'A-->B', 'C-->D']) {
      expect(rejoined).toContain(piece);
    }
  });
});

describe('diagramFilename', () => {
  it('gera nome .png numerado a partir de 1', () => {
    expect(diagramFilename(0)).toMatch(/^diagrama-\d{8}-\d{6}-1\.png$/);
    expect(diagramFilename(2)).toMatch(/-3\.png$/);
  });
});

describe('svgSize', () => {
  it('lê width/height absolutos', () => {
    expect(svgSize('<svg width="320" height="240"></svg>')).toEqual({ w: 320, h: 240 });
  });

  it('aceita dimensões em px', () => {
    expect(svgSize('<svg width="320px" height="240px"></svg>')).toEqual({ w: 320, h: 240 });
  });

  it('cai no viewBox quando o mermaid emite width="100%"', () => {
    const svg = '<svg width="100%" viewBox="0 0 640 480"></svg>';
    expect(svgSize(svg)).toEqual({ w: 640, h: 480 });
  });

  it('cai no viewBox quando não há width/height nenhum', () => {
    expect(svgSize('<svg viewBox="0 0 500 300"></svg>')).toEqual({ w: 500, h: 300 });
  });

  it('usa um padrão razoável sem width/height nem viewBox', () => {
    expect(svgSize('<svg></svg>')).toEqual({ w: 800, h: 600 });
  });
});

describe('prepareForRaster', () => {
  const svg =
    '<svg id="d" width="100%" style="max-width: 620px; background: transparent" viewBox="0 0 620 400"><g><text>oi</text></g></svg>';

  it('fixa width/height absolutos (senão o PNG sai vazio)', () => {
    const out = prepareForRaster(svg, 620, 400);
    const svgTag = /<svg[^>]*>/.exec(out)![0];
    expect(svgTag).toContain('width="620"');
    expect(svgTag).toContain('height="400"');
    // o `100%` do <rect> de fundo é esperado; o do <svg> é que não pode sobrar
    expect(svgTag).not.toContain('100%');
  });

  it('remove o max-width inline que limitaria o raster', () => {
    expect(prepareForRaster(svg, 620, 400)).not.toContain('max-width');
  });

  it('insere fundo branco como primeiro filho', () => {
    const out = prepareForRaster(svg, 620, 400);
    expect(out).toMatch(/<svg[^>]*><rect width="100%" height="100%" fill="#ffffff"\/>/);
  });

  it('preserva o conteúdo do diagrama e o viewBox', () => {
    const out = prepareForRaster(svg, 620, 400);
    expect(out).toContain('<text>oi</text>');
    expect(out).toContain('viewBox="0 0 620 400"');
  });

  it('acrescenta o xmlns quando falta (data: URL exige)', () => {
    const out = prepareForRaster('<svg viewBox="0 0 10 10"></svg>', 10, 10);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('não duplica um xmlns já presente', () => {
    const withNs = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
    expect(prepareForRaster(withNs, 10, 10).match(/xmlns=/g)).toHaveLength(1);
  });

  it('o resultado sobrevive ao encodeURIComponent com acentos', () => {
    const out = prepareForRaster('<svg viewBox="0 0 10 10"><text>Início</text></svg>', 10, 10);
    expect(() => encodeURIComponent(out)).not.toThrow();
    expect(decodeURIComponent(encodeURIComponent(out))).toContain('Início');
  });
});

// Amostras no formato real que o mermaid emite. O caso `width="100%"` sem
// height é o que produzia o PNG achatado da #74397.
describe('geometria dos formatos que o mermaid emite', () => {
  const comMaxWidth =
    '<svg aria-roledescription="sequence" width="100%" style="max-width: 1114px; background-color: white;" viewBox="-50 -10 1114 736"><g></g></svg>';
  const semMaxWidth =
    '<svg aria-roledescription="sequence" width="1114" height="736" viewBox="-50 -10 1114 736"><g></g></svg>';

  it('useMaxWidth: false — pixels diretos', () => {
    expect(svgSize(semMaxWidth)).toEqual({ w: 1114, h: 736 });
  });

  it('useMaxWidth: true — usa o max-width e a proporção do viewBox', () => {
    const { w, h } = svgSize(comMaxWidth);
    expect(w).toBe(1114);
    // Antes caía no padrão 600 e o diagrama saía esticado na horizontal
    expect(Math.round(h)).toBe(736);
  });

  it('só uma dimensão conhecida: a outra vem da proporção, sem esticar', () => {
    const { w, h } = svgSize('<svg width="600" viewBox="0 0 1200 400"></svg>');
    expect(w).toBe(600);
    expect(Math.round(h)).toBe(200);
  });

  it('o raster recebe dimensões absolutas e proporcionais', () => {
    const { w, h } = svgSize(comMaxWidth);
    const tag = /<svg[^>]*>/.exec(prepareForRaster(comMaxWidth, w, h))![0];
    expect(tag).toContain('width="1114"');
    expect(tag).toMatch(/height="736(\.\d+)?"/);
    expect(tag).not.toContain('100%');
    expect(tag).not.toContain('max-width');
  });
});
