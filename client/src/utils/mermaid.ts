/**
 * Suporte a diagramas Mermaid.
 *
 * Duas frentes:
 *  - No Bluemine, blocos ```mermaid são renderizados como SVG (ver MermaidDiagram).
 *  - Ao enviar para o Redmine, cada bloco é rasterizado em PNG e anexado, porque
 *    o Redmine não conhece Mermaid: quem abre a tarefa fora do Bluemine tem que
 *    ver a imagem, não o código-fonte do diagrama.
 *
 * A lib é carregada por import() dinâmico — ~1 MB que só entra quando existe
 * diagrama na tela (a maioria das tarefas não tem nenhum).
 */

// Cerca ```mermaid ... ``` (o fence pode ter 3+ backticks e vir indentado).
const FENCE_RE = /^([ \t]*)(`{3,})[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n?\1\2[ \t]*$/gim;

export interface MermaidBlock {
  /** Trecho original completo, incluindo as cercas — para substituição literal */
  raw: string;
  /** Só o código do diagrama */
  code: string;
}

/** Extrai os blocos ```mermaid de um texto Markdown, na ordem em que aparecem. */
export function extractMermaidBlocks(md: string): MermaidBlock[] {
  if (!md || !md.includes('mermaid')) return [];
  const out: MermaidBlock[] = [];
  for (const m of md.matchAll(FENCE_RE)) {
    const code = m[3].trim();
    if (code) out.push({ raw: m[0], code });
  }
  return out;
}

export function hasMermaid(md: string): boolean {
  return extractMermaidBlocks(md).length > 0;
}

export type MermaidPart =
  | { type: 'markdown'; content: string }
  | { type: 'mermaid'; content: string };

/**
 * Fatia um Markdown nas cercas ```mermaid, alternando trechos de Markdown e
 * diagramas. Cada diagrama é um componente React (não HTML), então o texto ao
 * redor tem que ser parseado em pedaços independentes.
 *
 * Trechos de Markdown vazios são descartados; um texto sem diagrama nenhum
 * devolve uma única parte, preservando o comportamento anterior.
 */
export function splitMermaid(md: string): MermaidPart[] {
  if (!md) return [{ type: 'markdown', content: '' }];
  const blocks = extractMermaidBlocks(md);
  if (blocks.length === 0) return [{ type: 'markdown', content: md }];

  const parts: MermaidPart[] = [];
  let rest = md;
  for (const { raw, code } of blocks) {
    const at = rest.indexOf(raw);
    if (at === -1) continue; // não deveria acontecer; ignora em vez de quebrar
    const before = rest.slice(0, at);
    if (before.trim()) parts.push({ type: 'markdown', content: before });
    parts.push({ type: 'mermaid', content: code });
    rest = rest.slice(at + raw.length);
  }
  if (rest.trim()) parts.push({ type: 'markdown', content: rest });
  return parts;
}

type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
  parse: (code: string) => Promise<unknown>;
};

let apiPromise: Promise<MermaidApi> | null = null;
let initedTheme: string | null = null;

/**
 * Carrega e inicializa o mermaid uma única vez. `theme` só é reaplicado quando
 * muda (initialize é idempotente, mas re-chamar a cada render é desperdício).
 */
async function getMermaid(theme: 'default' | 'dark'): Promise<MermaidApi> {
  if (!apiPromise) {
    apiPromise = import('mermaid').then((mod) => (mod.default ?? mod) as unknown as MermaidApi);
  }
  const api = await apiPromise;
  if (initedTheme !== theme) {
    api.initialize({
      startOnLoad: false,
      theme,
      // securityLevel 'strict' já barra HTML dentro dos labels; htmlLabels off
      // mantém tudo como <text> SVG, o que é requisito para rasterizar em PNG
      // (um <foreignObject> não sobrevive ao canvas).
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: false },
      class: { htmlLabels: false, useMaxWidth: false },
      // useMaxWidth: false em TODOS os tipos de diagrama. Com o padrão (true) o
      // mermaid emite `width="100%"` e NENHUM height — o tamanho real fica só no
      // `style="max-width: Npx"`. Isso deixava o <img> da rasterização sem altura
      // e o PNG saía achatado/esticado. Com false vêm width e height em pixels.
      sequence: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      journey: { useMaxWidth: false },
      pie: { useMaxWidth: false },
      er: { useMaxWidth: false },
      state: { useMaxWidth: false },
      mindmap: { useMaxWidth: false },
      timeline: { useMaxWidth: false },
      gitGraph: { useMaxWidth: false },
      quadrantChart: { useMaxWidth: false },
      xyChart: { useMaxWidth: false },
      c4: { useMaxWidth: false },
      sankey: { useMaxWidth: false },
      block: { useMaxWidth: false },
      requirement: { useMaxWidth: false },
      architecture: { useMaxWidth: false },
      fontFamily: 'Inter, system-ui, sans-serif',
    });
    initedTheme = theme;
  }
  return api;
}

let seq = 0;
const nextId = () => `mmd-${Date.now().toString(36)}-${seq++}`;

/** Renderiza um diagrama para SVG. Lança se o código for inválido. */
export async function renderMermaidSvg(
  code: string,
  theme: 'default' | 'dark' = 'default',
): Promise<string> {
  const api = await getMermaid(theme);
  // parse valida antes de renderizar: erro de sintaxe vira exceção limpa em vez
  // de um SVG com a "bomba" de erro que o mermaid desenha por conta própria.
  await api.parse(code);
  const { svg } = await api.render(nextId(), code);
  return svg;
}

/** Dimensões declaradas no SVG (width/height, ou o viewBox como reserva). */
export function svgSize(svg: string): { w: number; h: number } {
  const num = (s?: string | null) => {
    const v = String(s ?? '').trim();
    // Relativo (`100%`, `50em`) não serve como pixel: o mermaid usa `width="100%"`
    // com frequência, e parseFloat devolveria 100 — um PNG de 100px, achatado.
    // Nesses casos devolvemos 0 para o viewBox assumir.
    if (!/^\d*\.?\d+(px)?$/i.test(v)) return 0;
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const tag = /<svg[^>]*>/.exec(svg)?.[0] ?? svg;
  let w = num(/\bwidth="([^"]+)"/.exec(tag)?.[1]);
  let h = num(/\bheight="([^"]+)"/.exec(tag)?.[1]);

  // Reserva 1: o `style="max-width: Npx"` que acompanha o width="100%" — é a
  // largura real que o mermaid calculou (ver useMaxWidth em getMermaid).
  if (!w) w = num(/max-width:\s*([\d.]+)px/i.exec(tag)?.[1]);

  // Reserva 2: o viewBox. Além de suprir o que falta, é ele que dá a PROPORÇÃO:
  // se só uma das dimensões é conhecida, a outra sai da razão do viewBox, senão
  // o diagrama estica (foi o caso do PNG achatado da #74397).
  const vb = /viewBox="([\d.\-\s]+)"/.exec(tag)?.[1];
  const p = vb ? vb.trim().split(/\s+/).map(Number) : [];
  if (p.length === 4 && p[2] > 0 && p[3] > 0) {
    const ratio = p[3] / p[2]; // altura / largura
    if (w && !h) h = w * ratio;
    else if (h && !w) w = h / ratio;
    else if (!w && !h) {
      w = p[2];
      h = p[3];
    }
  }
  return { w: w || 800, h: h || 600 };
}

/**
 * O mermaid emite `width="100%"` (ou omite as dimensões) em vários tipos de
 * diagrama. Sem width/height absolutos o <img> usado na rasterização carrega
 * com tamanho zero no Chromium, e o PNG sai vazio — daí fixarmos os dois a
 * partir do viewBox. Também força fundo branco: PNG transparente fica
 * ilegível no tema claro do Redmine.
 */
export function prepareForRaster(svg: string, w: number, h: number): string {
  let s = svg.replace(/<svg([^>]*)>/, (_tag, attrs: string) => {
    const cleaned = attrs
      .replace(/\s(width|height)="[^"]*"/gi, '')
      .replace(/\sstyle="[^"]*max-width[^"]*"/gi, '');
    return `<svg${cleaned} width="${w}" height="${h}">`;
  });
  if (!/xmlns=/.test(s)) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  // Retângulo de fundo como primeiro filho do <svg>
  s = s.replace(/(<svg[^>]*>)/, `$1<rect width="100%" height="100%" fill="#ffffff"/>`);
  return s;
}

/**
 * Rasteriza um SVG em PNG via <img> + canvas.
 *
 * Precisa ser data: URL, não blob:. Um blob: aponta para a origem do documento
 * e o canvas trata o resultado como "tainted", fazendo toBlob lançar
 * SecurityError. Data URL é considerada same-origin e o canvas fica limpo.
 */
async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const { w, h } = svgSize(svg);
  const prepared = prepareForRaster(svg, w, h);
  // encodeURIComponent em vez de btoa: o SVG tem acentos (labels em português) e
  // btoa lança em qualquer caractere fora do latin1.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(prepared)}`;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Falha ao carregar o SVG do diagrama'));
    img.src = url;
  });

  // Escala do raster, entre dois limites:
  //  - piso: um diagrama estreito (3 caixas ~300px) a 2x daria 600px e o Redmine
  //    mostra pequeno; sobe até MIN_W para o texto ficar legível.
  //  - teto: MAX_PX por lado, senão o canvas estoura em diagrama muito grande
  //    (Chromium recusa acima de ~16k px por lado / 268 MP).
  const MIN_W = 1400;
  const MAX_PX = 4000;
  const upscale = Math.max(scale, MIN_W / Math.max(w, 1));
  const k = Math.min(upscale, MAX_PX / Math.max(w, h, 1)) || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Não foi possível gerar o PNG do diagrama');
  return blob;
}

/** Renderiza um diagrama Mermaid direto em PNG (File pronto para upload). */
export async function mermaidToPng(code: string, filename: string): Promise<File> {
  // Sempre no tema claro: a imagem vai para o Redmine, que tem fundo branco.
  const svg = await renderMermaidSvg(code, 'default');
  const blob = await svgToPngBlob(svg);
  return new File([blob], filename, { type: 'image/png' });
}

/** Nome de arquivo estável e legível para o anexo do diagrama. */
export function diagramFilename(index: number): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `diagrama-${stamp}-${index + 1}.png`;
}

export interface MermaidPrepared {
  /** Markdown com os blocos mermaid trocados pela referência de imagem */
  text: string;
  /** PNGs a anexar, na ordem dos blocos */
  files: File[];
  /** Blocos que não renderizaram (sintaxe inválida): ficam como código no texto */
  failed: number;
}

/**
 * Prepara um texto para o Redmine: rasteriza cada diagrama Mermaid em PNG e
 * substitui a cerca pela referência ao anexo (mais o código dentro de um
 * bloco, para o diagrama continuar editável na próxima vez).
 *
 * Um diagrama que falha em renderizar não impede o envio: ele fica como bloco
 * de código, e o total de falhas é devolvido para quem chamou avisar.
 */
export async function prepareMermaidForRedmine(md: string): Promise<MermaidPrepared> {
  const blocks = extractMermaidBlocks(md);
  if (blocks.length === 0) return { text: md, files: [], failed: 0 };

  let text = md;
  const files: File[] = [];
  let failed = 0;

  for (let i = 0; i < blocks.length; i++) {
    const { raw, code } = blocks[i];
    try {
      const name = diagramFilename(files.length);
      files.push(await mermaidToPng(code, name));
      // A imagem primeiro; o fonte fica preservado abaixo para poder reeditar.
      text = text.replace(raw, `![${name}](${name})\n\n\`\`\`mermaid\n${code}\n\`\`\``);
    } catch (err) {
      failed++;
      console.warn('[mermaid] diagrama não renderizado, enviando como código', err);
    }
  }

  return { text, files, failed };
}
