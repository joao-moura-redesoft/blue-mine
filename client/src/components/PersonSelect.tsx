import { useState, useMemo } from 'react';
import { ChevronDown, Check, Search, UserRound, Loader2 } from 'lucide-react';
import { PersonAvatar } from './PersonAvatar';

// Ordem de exibição das equipes no dropdown (mesma de IssueModal/TeamView/PeopleView).
export const TEAM_ORDER = [
  'Desenvolvimento',
  'Suporte',
  'Redes & Infra',
  'Implantação',
  'Projetos',
  'Comercial',
  'Customer Success',
  'Contratos',
  'Outros',
];

export interface PersonOption {
  id: number;
  name: string;
  team?: string;
}

interface Props {
  value: number | '';
  onChange: (id: number | '') => void;
  people?: PersonOption[];
  disabled?: boolean;
  /** Texto do botão quando nada está selecionado */
  placeholder?: string;
  /** Rótulo da opção que limpa a seleção */
  emptyLabel?: string;
}

/**
 * Seletor de pessoa com foto — substitui o <select> nativo (que não aceita imagem
 * dentro de <option>). Foto vem do PersonAvatar (Nextcloud Talk, com fallback pras
 * iniciais); as pessoas são agrupadas por equipe e há busca por nome.
 */
export function PersonSelect({
  value,
  onChange,
  people,
  disabled,
  placeholder = 'Ninguém',
  emptyLabel = '— Ninguém',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = people?.find((p) => p.id === value);
  // Modelo aplicado já traz o responsável antes de a lista de membros do projeto
  // chegar — sem isso o botão diria "Ninguém" com alguém selecionado.
  const resolving = value !== '' && !selected;

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
    const byTeam = filtered.reduce<Record<string, PersonOption[]>>((acc, p) => {
      (acc[p.team || 'Outros'] ??= []).push(p);
      return acc;
    }, {});
    return Object.keys(byTeam)
      .sort((a, b) => {
        const ia = TEAM_ORDER.indexOf(a),
          ib = TEAM_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map((team) => ({ team, people: byTeam[team] }));
  }, [people, search]);

  const close = () => {
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setSearch('');
          setOpen((v) => !v);
        }}
        className="w-full flex items-center gap-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg pl-2 pr-2.5 py-1.5 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {selected ? (
          <PersonAvatar redmineUserId={selected.id} name={selected.name} size={24} />
        ) : (
          <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
            {resolving ? (
              <Loader2 size={12} className="text-slate-400 animate-spin" />
            ) : (
              <UserRound size={13} className="text-slate-400" />
            )}
          </span>
        )}
        <span
          className={`flex-1 text-left truncate ${
            selected ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          {selected?.name ?? (resolving ? 'Carregando…' : placeholder)}
        </span>
        <ChevronDown size={13} className="text-slate-400 flex-shrink-0" />
      </button>

      {open && (
        <>
          {/* captura o clique fora pra fechar */}
          <div className="fixed inset-0 z-20" onClick={close} />
          <div
            className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-30 flex flex-col overflow-hidden"
            style={{ maxHeight: 280 }}
          >
            <div className="p-2 border-b border-slate-100 dark:border-slate-700 flex-shrink-0 relative">
              <Search
                size={12}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  // dentro de um <form>: Enter aqui não pode submeter a tarefa
                  if (e.key === 'Enter') e.preventDefault();
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                  }
                }}
                placeholder="Buscar pessoa..."
                className="w-full text-xs border border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded-md pl-6 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>

            <div className="overflow-y-auto scrollbar-thin py-1">
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  close();
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50"
              >
                {emptyLabel}
              </button>

              {groups.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">Nenhum resultado</p>
              )}

              {groups.map(({ team, people: list }) => (
                <div key={team}>
                  <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-50/70 dark:bg-slate-900/40 sticky top-0">
                    {team}{' '}
                    <span className="text-slate-300 dark:text-slate-600">({list.length})</span>
                  </p>
                  {list.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onChange(p.id);
                        close();
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                        p.id === value
                          ? 'font-semibold text-blue-600 dark:text-blue-400'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <PersonAvatar redmineUserId={p.id} name={p.name} size={22} />
                      <span className="flex-1 text-left truncate">{p.name}</span>
                      {p.id === value && <Check size={12} className="flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
