/**
 * Diff de texto no estilo git para o histórico da tarefa.
 *
 * Mudança de descrição no Redmine chega como old_value/new_value inteiros — o
 * histórico virava uma parede de texto riscado seguida do texto novo completo.
 * Aqui o texto é quebrado em linhas, comparado por LCS e só o que mudou
 * aparece, com duas linhas de contexto em volta (o resto vira "⋯ N linhas").
 *
 * Linhas trocadas (uma sai, outra entra no mesmo bloco) ainda ganham realce
 * palavra a palavra, para não pintar a linha toda quando mudou uma palavra só.
 */

export type DiffOp = 'eq' | 'del' | 'ins';

export interface WordPart {
  op: DiffOp;
  text: string;
}

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** Realce palavra a palavra quando a linha foi editada, não só inserida/removida. */
  parts?: WordPart[];
}

/** Bloco de linhas iguais escondidas entre dois trechos alterados. */
export interface DiffGap {
  op: 'gap';
  count: number;
}

export type DiffRow = DiffLine | DiffGap;

export interface TextDiffResult {
  /** Diff com o contexto colapsado — o que a UI mostra por padrão. */
  rows: DiffRow[];
  /** Diff completo, linha a linha, para o modo "mostrar tudo". */
  lines: DiffLine[];
  added: number;
  removed: number;
}

/** Acima disso o LCS fica caro demais; cai no bloco "tudo fora / tudo dentro". */
const MAX_CELLS = 1_000_000;
/** Linhas gigantes (texto colado sem quebra) não valem diff por palavra. */
const MAX_WORD_TOKENS = 600;
/** Abaixo dessa semelhança as linhas são coisas diferentes, não uma edição. */
const MIN_WORD_SIMILARITY = 0.25;

function splitLines(text: string): string[] {
  if (text === '') return []; // campo vazio não é "uma linha em branco"
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // Quebra final não é uma linha vazia de verdade.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** LCS clássico com backtracking; serve tanto para linhas quanto para palavras. */
function lcsOps(a: string[], b: string[]): { op: DiffOp; text: string }[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) {
    return [
      ...a.map((text) => ({ op: 'del' as const, text })),
      ...b.map((text) => ({ op: 'ins' as const, text })),
    ];
  }

  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  const out: { op: DiffOp; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'eq', text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      out.push({ op: 'del', text: a[i] });
      i++;
    } else {
      out.push({ op: 'ins', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: 'del', text: a[i++] });
  while (j < m) out.push({ op: 'ins', text: b[j++] });
  return out;
}

/** Quebra em palavras mantendo os espaços como tokens (o texto remonta exato). */
function tokenize(line: string): string[] {
  return line.split(/(\s+)/).filter((t) => t !== '');
}

/**
 * Realce palavra a palavra de um par de linhas trocadas. Devolve null quando as
 * linhas têm pouco em comum — aí é troca de conteúdo, não edição.
 */
function diffWords(oldLine: string, newLine: string): { del: WordPart[]; ins: WordPart[] } | null {
  if (!oldLine.trim() || !newLine.trim()) return null;
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  if (a.length > MAX_WORD_TOKENS || b.length > MAX_WORD_TOKENS) return null;

  const ops = lcsOps(a, b);
  const same = ops.reduce((sum, o) => (o.op === 'eq' ? sum + o.text.length : sum), 0);
  if (same / Math.max(oldLine.length, newLine.length) < MIN_WORD_SIMILARITY) return null;

  const del: WordPart[] = [];
  const ins: WordPart[] = [];
  for (const o of ops) {
    if (o.op !== 'ins') push(del, o.op, o.text);
    if (o.op !== 'del') push(ins, o.op === 'ins' ? 'ins' : 'eq', o.text);
  }
  return { del, ins };
}

/** Junta tokens vizinhos do mesmo tipo — um realce contínuo em vez de vários. */
function push(parts: WordPart[], op: DiffOp, text: string) {
  const last = parts[parts.length - 1];
  if (last && last.op === op) last.text += text;
  else parts.push({ op, text });
}

/**
 * Dentro de cada bloco alterado, junta as saídas antes das entradas (como o git
 * mostra) e casa os pares na ordem para o realce por palavra.
 */
function refineBlocks(ops: { op: DiffOp; text: string }[]): DiffLine[] {
  const out: DiffLine[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].op === 'eq') {
      out.push({ op: 'eq', text: ops[i].text });
      i++;
      continue;
    }
    const block: { op: DiffOp; text: string }[] = [];
    while (i < ops.length && ops[i].op !== 'eq') block.push(ops[i++]);

    const dels = block.filter((o) => o.op === 'del').map((o) => o.text);
    const inss = block.filter((o) => o.op === 'ins').map((o) => o.text);
    const pairs = Math.min(dels.length, inss.length);
    const delLines: DiffLine[] = dels.map((text) => ({ op: 'del' as const, text }));
    const insLines: DiffLine[] = inss.map((text) => ({ op: 'ins' as const, text }));
    for (let k = 0; k < pairs; k++) {
      const words = diffWords(dels[k], inss[k]);
      if (words) {
        delLines[k].parts = words.del;
        insLines[k].parts = words.ins;
      }
    }
    out.push(...delLines, ...insLines);
  }
  return out;
}

/** Diff linha a linha entre dois textos. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText ?? '');
  const b = splitLines(newText ?? '');

  // Prefixo e sufixo iguais saem fora do LCS — descrição grande costuma mudar
  // só no meio, e isso corta o custo quase todo.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const middle = refineBlocks(lcsOps(a.slice(start, endA), b.slice(start, endB)));
  return [
    ...a.slice(0, start).map((text) => ({ op: 'eq' as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ op: 'eq' as const, text })),
  ];
}

/** Esconde os trechos iguais longe de qualquer alteração. */
export function collapseContext(lines: DiffLine[], context = 2): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  let changed = false;
  lines.forEach((l, i) => {
    if (l.op === 'eq') return;
    changed = true;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
      keep[k] = true;
    }
  });
  if (!changed) return lines.length ? [{ op: 'gap', count: lines.length }] : [];

  const rows: DiffRow[] = [];
  let hidden = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (hidden > 0) {
        rows.push({ op: 'gap', count: hidden });
        hidden = 0;
      }
      rows.push(l);
    } else {
      hidden++;
    }
  });
  if (hidden > 0) rows.push({ op: 'gap', count: hidden });
  return rows;
}

/** Diff pronto para a tela: linhas, versão colapsada e contagem +/−. */
export function buildTextDiff(oldText: string, newText: string, context = 2): TextDiffResult {
  const lines = diffLines(oldText, newText);
  return {
    lines,
    rows: collapseContext(lines, context),
    added: lines.filter((l) => l.op === 'ins').length,
    removed: lines.filter((l) => l.op === 'del').length,
  };
}
