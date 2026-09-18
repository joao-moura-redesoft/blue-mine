import { useMemo, useState } from 'react';
import { buildTextDiff, type DiffLine, type DiffRow, type WordPart } from '../utils/textDiff';

/** Linhas mostradas antes de precisar clicar em "mostrar tudo". */
const PREVIEW_ROWS = 14;

function isGap(row: DiffRow): row is { op: 'gap'; count: number } {
  return row.op === 'gap';
}

const LINE_STYLE: Record<DiffLine['op'], string> = {
  del: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
  ins: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  eq: 'text-slate-400 dark:text-slate-500',
};

const SIGN: Record<DiffLine['op'], string> = { del: '−', ins: '+', eq: ' ' };

const PART_STYLE: Record<DiffLine['op'], string> = {
  del: 'bg-rose-200/70 dark:bg-rose-800/60 rounded-sm',
  ins: 'bg-emerald-200/70 dark:bg-emerald-800/60 rounded-sm',
  eq: '',
};

function LineParts({ line }: { line: DiffLine }) {
  if (!line.parts) return <>{line.text || ' '}</>;
  return (
    <>
      {line.parts.map((p: WordPart, i) => (
        <span key={i} className={p.op === 'eq' ? '' : PART_STYLE[p.op]}>
          {p.text}
        </span>
      ))}
    </>
  );
}

/**
 * Mudança de texto longo (descrição, campo de texto grande) no formato do git:
 * só os trechos alterados, com contexto em volta e realce por palavra.
 */
export function TextDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const { rows, lines, added, removed } = useMemo(
    () => buildTextDiff(oldText, newText),
    [oldText, newText],
  );
  const [full, setFull] = useState(false);

  const visible: DiffRow[] = full ? lines : rows.slice(0, PREVIEW_ROWS);
  const canExpand = !full && (rows.length > PREVIEW_ROWS || rows.some(isGap));

  return (
    <div className="mt-1 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
          +{added}
        </span>
        <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">
          −{removed}
        </span>
        <span className="text-[10px] text-slate-400">
          {added + removed === 1 ? 'linha alterada' : 'linhas alteradas'}
        </span>
        {(canExpand || full) && (
          <button
            type="button"
            onClick={() => setFull((v) => !v)}
            className="ml-auto text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {full ? 'mostrar menos' : 'mostrar tudo'}
          </button>
        )}
      </div>

      <div
        className={`font-mono text-[11px] leading-snug ${full ? 'max-h-96 overflow-y-auto' : ''}`}
      >
        {visible.map((row, i) =>
          isGap(row) ? (
            <button
              key={i}
              type="button"
              onClick={() => setFull(true)}
              className="w-full text-left px-2 py-0.5 text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              ⋯ {row.count} {row.count === 1 ? 'linha inalterada' : 'linhas inalteradas'}
            </button>
          ) : (
            <div key={i} className={`flex gap-1.5 px-2 ${LINE_STYLE[row.op]}`}>
              <span className="select-none opacity-50 flex-shrink-0">{SIGN[row.op]}</span>
              <span className="whitespace-pre-wrap break-words min-w-0">
                <LineParts line={row} />
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
