import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { redmineApi } from '../api/redmine';

// ─── Busca de tarefa para vincular ────────────────────────────────────────────
export function IssueLinker({
  onPick,
  onClose,
}: {
  onPick: (issue: { id: number; subject: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora do dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['note-issue-search', q],
    queryFn: () => redmineApi.searchIssues(q),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
  return (
    <div
      ref={ref}
      className="absolute z-30 top-full left-0 mt-1 w-72 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
        <Search size={13} className="text-slate-400 flex-shrink-0" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Buscar tarefa (#id ou texto)…"
          className="flex-1 text-xs bg-transparent focus:outline-none placeholder-slate-400"
        />
      </div>
      <div className="max-h-56 overflow-y-auto scrollbar-thin">
        {isFetching && <div className="px-3 py-3 text-xs text-slate-400">Buscando…</div>}
        {!isFetching && q.trim().length >= 2 && results.length === 0 && (
          <div className="px-3 py-3 text-xs text-slate-400">Nenhuma tarefa encontrada</div>
        )}
        {q.trim().length < 2 && (
          <div className="px-3 py-3 text-xs text-slate-400">Digite ao menos 2 caracteres</div>
        )}
        {results.slice(0, 8).map((issue) => (
          <button
            key={issue.id}
            onClick={() => onPick(issue)}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-left transition-colors"
          >
            <span className="font-mono text-[10px] font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">
              #{issue.id}
            </span>
            <span className="text-xs text-slate-700 dark:text-slate-200 truncate">
              {issue.subject}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
