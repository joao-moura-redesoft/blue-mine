import { useState } from 'react';
import { Bookmark, BookmarkPlus, X } from 'lucide-react';
import {
  loadSavedFilters,
  persistFilter,
  removeFilter,
  type SavedFilter,
} from '../utils/savedFilters';
import { useProjects } from '../hooks/useRedmine';
import { ConfirmDialog } from './workflow/ConfirmDialog';

const ALERT_LABELS: Record<string, string> = {
  overdue: 'Vencidas',
  reviewToday: 'Rev. hoje',
  reviewOverdue: 'Rev. atrasada',
  missing: 'Campos faltando',
};

const GROUP_LABELS: Record<string, string> = {
  project: 'Por projeto',
  priority: 'Por prioridade',
};

interface CurrentFilter {
  projectId?: number;
  sortBy: 'priority' | 'due_date' | 'updated';
  priorityFilter: string;
  alertFilter: string | null;
  groupBy: 'none' | 'project' | 'priority';
}

interface Props {
  currentFilter: CurrentFilter;
  onApply: (filter: SavedFilter) => void;
}

export function SavedFiltersBar({ currentFilter, onApply }: Props) {
  const [filters, setFilters] = useState<SavedFilter[]>(loadSavedFilters);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<SavedFilter | null>(null);
  const { data: projects } = useProjects();

  const refresh = () => setFilters(loadSavedFilters());

  const handleSave = () => {
    if (!name.trim()) return;
    persistFilter({ id: Date.now().toString(), name: name.trim(), ...currentFilter });
    refresh();
    setName('');
    setSaving(false);
  };

  const requestDelete = (f: SavedFilter, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(f);
  };

  const handleDelete = (id: string) => {
    removeFilter(id);
    refresh();
  };

  const projectLabel = (id?: number) =>
    id ? (projects?.find((p) => p.id === id)?.name ?? `Projeto ${id}`) : 'Todos';

  const filterSummary = (f: SavedFilter) => {
    const parts: string[] = [];
    if (f.projectId) parts.push(projectLabel(f.projectId));
    if (f.priorityFilter) parts.push(f.priorityFilter);
    if (f.alertFilter) parts.push(ALERT_LABELS[f.alertFilter] ?? f.alertFilter);
    const sortLabels: Record<string, string> = {
      priority: 'Prioridade',
      due_date: 'Prazo',
      updated: 'Atualizado',
    };
    if (f.sortBy !== 'priority') parts.push(sortLabels[f.sortBy]);
    if (f.groupBy && f.groupBy !== 'none') parts.push(GROUP_LABELS[f.groupBy] ?? f.groupBy);
    return parts.join(' · ') || 'Geral';
  };

  // Qual atalho corresponde exatamente ao que está na tela agora.
  const isActive = (f: SavedFilter) =>
    (f.projectId ?? undefined) === currentFilter.projectId &&
    f.sortBy === currentFilter.sortBy &&
    f.priorityFilter === currentFilter.priorityFilter &&
    (f.alertFilter ?? null) === currentFilter.alertFilter &&
    (f.groupBy ?? 'none') === currentFilter.groupBy;

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <Bookmark size={13} className="text-slate-400 flex-shrink-0" />

      {filters.map((f) => (
        <button
          key={f.id}
          onClick={() => onApply(f)}
          title={filterSummary(f)}
          aria-pressed={isActive(f)}
          className={`group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium
            border transition-colors ${
              isActive(f)
                ? 'bg-blue-50 text-blue-700 border-blue-300'
                : 'bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border-slate-200 hover:border-blue-300'
            }`}
        >
          <span className="max-w-[10rem] truncate">{f.name}</span>
          <span
            className={`text-[10px] max-w-[6rem] truncate hidden sm:inline ${
              isActive(f) ? 'text-blue-400' : 'text-slate-400 group-hover:text-blue-400'
            }`}
          >
            {filterSummary(f)}
          </span>
          <span
            role="button"
            onClick={(e) => requestDelete(f, e)}
            className="ml-0.5 p-0.5 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
          >
            <X size={10} />
          </span>
        </button>
      ))}

      {confirmDelete && (
        <ConfirmDialog
          title={`Apagar filtro "${confirmDelete.name}"?`}
          message="Só remove o atalho salvo — os filtros ativos na tela não mudam."
          confirmLabel="Apagar"
          danger
          onConfirm={() => handleDelete(confirmDelete.id)}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {saving ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') {
                setSaving(false);
                setName('');
              }
            }}
            placeholder="Nome do filtro…"
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
          />
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="text-xs px-2.5 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/40 disabled:opacity-40 text-white rounded-lg transition-all duration-200"
          >
            Salvar
          </button>
          <button
            onClick={() => {
              setSaving(false);
              setName('');
            }}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors"
          title="Salvar os filtros ativos como favorito"
        >
          <BookmarkPlus size={13} />
          Salvar filtro atual
        </button>
      )}
    </div>
  );
}
