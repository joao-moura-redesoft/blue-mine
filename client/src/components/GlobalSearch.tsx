import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, X } from 'lucide-react';
import { redmineApi } from '../api/redmine';

interface Props {
  onSelectIssue: (id: number) => void;
}

export function GlobalSearch({ onSelectIssue }: Props) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  // Índice do resultado destacado — a lista era só clicável, então quem chegava
  // nela pelo teclado precisava largar o teclado para abrir uma tarefa.
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /**
   * Atalho global "/" para focar a busca.
   *
   * Registrado em `window` (fase de bolha) de propósito: o listener do Kanban
   * fica em `document`, que dispara antes, e chama preventDefault() para ficar
   * com o "/" enquanto a board está na tela — lá o alvo natural é a busca da
   * própria board. Aqui só assumimos a tecla quando ninguém mais a quis.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
      // Com um diálogo aberto o teclado é dele: focar a barra atrás do overlay
      // mandaria a digitação para um campo que o usuário nem enxerga.
      if (document.querySelector('.modal-backdrop')) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const { data: results, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => redmineApi.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 30 * 1000,
  });

  const list = results ?? [];
  const showList = open && debounced.length >= 2;

  // A lista se refaz sob o cursor (debounce, refetch): volta ao topo em vez de
  // manter um índice que agora aponta para outra tarefa.
  useEffect(() => {
    setSel(0);
  }, [debounced, results]);

  // Mantém o item destacado visível ao navegar com as setas.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const select = (id: number) => {
    onSelectIssue(id);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (showList && list.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => (s + 1) % list.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => (s - 1 + list.length) % list.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        select(list[sel].id);
        return;
      }
      return;
    }

    // Sem lista (ainda buscando, ou a busca não achou): "#123"/"123" + Enter
    // continua abrindo direto — é como se chega numa tarefa fechada, que a
    // busca do Redmine não devolve.
    if (e.key === 'Enter') {
      const raw = query.trim().replace(/^#/, '');
      if (/^\d+$/.test(raw)) select(parseInt(raw));
    }
  };

  return (
    <div ref={ref} className="relative flex-1 max-w-md">
      <Search
        size={15}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
      />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar qualquer tarefa por #ID ou título… (/)"
        role="combobox"
        aria-expanded={showList}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        aria-activedescendant={
          showList && list.length > 0 ? `global-search-opt-${list[sel].id}` : undefined
        }
        className="w-full pl-9 pr-8 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50 dark:bg-slate-900/40 focus:bg-white dark:focus:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-colors"
        onKeyDown={handleKeyDown}
      />
      {query && (
        <button
          onClick={() => {
            setQuery('');
            setOpen(false);
            inputRef.current?.focus();
          }}
          aria-label="Limpar busca"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
        >
          <X size={14} />
        </button>
      )}

      {showList && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {isFetching ? (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400 dark:text-slate-500 text-sm">
              <Loader2 size={15} className="animate-spin" /> Buscando…
            </div>
          ) : list.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
              Nenhuma tarefa encontrada.
            </div>
          ) : (
            <div
              id="global-search-results"
              role="listbox"
              className="max-h-80 overflow-y-auto scrollbar-thin py-1"
            >
              {list.map((issue, i) => (
                <button
                  key={issue.id}
                  id={`global-search-opt-${issue.id}`}
                  ref={i === sel ? activeRef : undefined}
                  role="option"
                  aria-selected={i === sel}
                  onClick={() => select(issue.id)}
                  // O destaque do teclado não acompanha o mouse de propósito:
                  // o scrollIntoView das setas move a lista sob um cursor parado
                  // e o mouseenter resultante roubaria a seleção no meio da
                  // navegação. Hover fica só como estilo.
                  className={`w-full text-left px-4 py-2 transition-colors border-b border-slate-50 dark:border-slate-800 last:border-0 ${
                    i === sel
                      ? 'bg-blue-50 dark:bg-slate-800'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-400 dark:text-slate-500 flex-shrink-0">
                      #{issue.id}
                    </span>
                    <span className="text-sm text-slate-800 dark:text-slate-100 font-medium truncate flex-1">
                      {issue.subject}
                    </span>
                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded flex-shrink-0">
                      {issue.status.name}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                    {issue.project.name}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
