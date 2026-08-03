import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useProjects,
  useProjectMembers,
  useAllMembers,
  useUserIssues,
  useStatuses,
} from '../hooks/useRedmine';
import { IssueListView } from './IssueListView';
import { IssueCard } from './IssueCard';
import { PersonAvatar } from './PersonAvatar';
import type { Issue } from '../types/redmine';
import {
  ChevronDown,
  Search,
  Check,
  User,
  Users,
  AlertTriangle,
  Play,
  Loader2,
  List,
  Columns,
} from 'lucide-react';

// Status "Em andamento" no Redmine desta instalação (mesma convenção do TeamView).
const IN_PROGRESS_STATUS_ID = 8;

const TEAM_ORDER = [
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

interface Props {
  onIssueClick: (id: number) => void;
  onOpenTalk?: (ncUid: string) => void;
  openingTalkFor?: string | null;
}

export function PeopleView({ onIssueClick, onOpenTalk, openingTalkFor }: Props) {
  const { data: projects } = useProjects();

  // 'all' = todas as pessoas de todos os projetos (padrão)
  const [project, setProject] = useState<number | 'all'>('all');
  const isAll = project === 'all';
  const [personId, setPersonId] = useState<number | undefined>(undefined);

  const { data: projectMembers, isLoading: loadingProjectMembers } = useProjectMembers(
    isAll ? undefined : project,
  );
  const { data: allMembers, isLoading: loadingAllMembers } = useAllMembers(isAll);
  const members = isAll ? allMembers : projectMembers;
  const membersLoading = isAll ? loadingAllMembers : loadingProjectMembers;

  const userIssues = useUserIssues(personId);
  const { data: statuses } = useStatuses();

  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');

  const person = members?.find((m) => m.id === personId);

  // Link direto (ex.: vindo do pop-up de perfil do Talk): /people?person=123
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const p = searchParams.get('person');
    if (!p) return;
    setPersonId(Number(p));
    setSearchParams(
      (prev) => {
        prev.delete('person');
        return prev;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const issues = userIssues.data ?? [];
    const now = Date.now();
    return {
      total: issues.length,
      overdue: issues.filter((i) => i.due_date && new Date(i.due_date).getTime() < now).length,
      inProgress: issues.filter((i) => i.status.id === IN_PROGRESS_STATUS_ID).length,
    };
  }, [userIssues.data]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Pessoas</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Veja as tarefas abertas de qualquer pessoa da equipe.
        </p>
      </div>

      {/* Seletores */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Projeto */}
        <ProjectPicker
          projects={projects ?? []}
          value={project}
          onChange={(p) => {
            setProject(p);
            setPersonId(undefined);
          }}
        />
        {/* Pessoa */}
        <PersonPicker
          members={members ?? []}
          value={personId}
          onChange={setPersonId}
          disabled={false}
          loading={membersLoading}
        />
      </div>

      {!personId ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Users size={32} className="mb-3 opacity-30" />
          <p className="text-sm">Selecione uma pessoa para ver as tarefas abertas dela.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 mb-5 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
            <PersonAvatar
              redmineUserId={personId}
              name={person?.name ?? ''}
              size={52}
              onOpenTalk={onOpenTalk}
              openingTalkFor={openingTalkFor}
            />
            <div className="min-w-0">
              <span className="font-semibold text-base text-slate-800 dark:text-slate-100 truncate block">
                {person?.name}
              </span>
              {person?.team && (
                <p className="text-xs text-slate-400 dark:text-slate-500">{person.team}</p>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <StatChip icon={<Users size={12} />} value={stats.total} label="abertas" />
              <StatChip
                icon={<Play size={12} />}
                value={stats.inProgress}
                label="em andamento"
                tone={stats.inProgress > 0 ? 'blue' : 'neutral'}
              />
              <StatChip
                icon={<AlertTriangle size={12} />}
                value={stats.overdue}
                label="atrasada(s)"
                tone={stats.overdue > 0 ? 'red' : 'neutral'}
              />
              <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('list')}
                  title="Ver em lista"
                  className={`p-1.5 rounded-md transition-colors ${
                    viewMode === 'list'
                      ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-100 shadow-sm'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  <List size={14} />
                </button>
                <button
                  onClick={() => setViewMode('board')}
                  title="Ver em quadro"
                  className={`p-1.5 rounded-md transition-colors ${
                    viewMode === 'board'
                      ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-100 shadow-sm'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  <Columns size={14} />
                </button>
              </div>
            </div>
          </div>
          {viewMode === 'list' ? (
            <IssueListView
              issues={userIssues.data}
              isLoading={userIssues.isLoading}
              isFetching={userIssues.isFetching}
              onRefetch={userIssues.refetch}
              onIssueClick={onIssueClick}
              emptyMessage="Esta pessoa não tem tarefas abertas."
            />
          ) : (
            <PersonBoard
              issues={userIssues.data}
              statuses={statuses}
              isLoading={userIssues.isLoading}
              onIssueClick={onIssueClick}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── Quadro somente-leitura por status (mesma organização do "Minhas tarefas") ── */
function PersonBoard({
  issues,
  statuses,
  isLoading,
  onIssueClick,
}: {
  issues?: Issue[];
  statuses?: { id: number; name: string }[];
  isLoading: boolean;
  onIssueClick: (id: number) => void;
}) {
  const columns = useMemo(() => {
    const byStatus = new Map<number, Issue[]>();
    (issues ?? []).forEach((issue) => {
      const arr = byStatus.get(issue.status.id) ?? [];
      arr.push(issue);
      byStatus.set(issue.status.id, arr);
    });

    const order = statuses ?? [];
    const cols = order
      .filter((s) => byStatus.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, issues: byStatus.get(s.id)! }));

    // Status usado pelas issues mas ausente da lista geral (raro) — ainda assim mostra.
    byStatus.forEach((list, id) => {
      if (!cols.find((c) => c.id === id)) {
        cols.push({ id, name: list[0].status.name, issues: list });
      }
    });

    return cols;
  }, [issues, statuses]);

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-slate-400">Carregando…</div>;
  }

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Columns size={32} className="mb-3 opacity-30" />
        <p className="text-sm">Esta pessoa não tem tarefas abertas.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <div
          key={col.id}
          className="flex flex-col w-72 flex-shrink-0 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
        >
          <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
              {col.name}
            </h3>
            <span className="text-xs font-medium text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-full px-2 py-0.5 flex-shrink-0">
              {col.issues.length}
            </span>
          </div>
          <div className="flex-1 p-2 space-y-2 bg-slate-50/50 dark:bg-slate-950/30 rounded-b-xl min-h-[80px]">
            {col.issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                onClick={() => onIssueClick(issue.id)}
                navigable={false}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Chip de estatística do cabeçalho de perfil ── */
function StatChip({
  icon,
  value,
  label,
  tone = 'neutral',
}: {
  icon: ReactNode;
  value: number;
  label: string;
  tone?: 'neutral' | 'blue' | 'red';
}) {
  const toneClass = {
    neutral: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
    blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    red: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  }[tone];
  return (
    <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${toneClass}`}>
      {icon}
      <span className="font-semibold">{value}</span>
      <span className="opacity-80">{label}</span>
    </div>
  );
}

/* ── Seletor de projeto ── */
function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: { id: number; name: string }[];
  value: number | 'all';
  onChange: (value: number | 'all') => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = value === 'all' ? undefined : projects.find((p) => p.id === value);
  const label = value === 'all' ? 'Todos os projetos' : (current?.name ?? 'Selecionar projeto...');
  const filtered = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <span className="block text-xs text-slate-400 mb-1">Projeto</span>
      <button
        onClick={() => {
          setSearch('');
          setOpen((v) => !v);
        }}
        className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 rounded-lg px-3 py-2 min-w-56 max-w-72"
      >
        <span className="truncate flex-1 text-left">{label}</span>
        <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-30 w-72 flex flex-col"
          style={{ maxHeight: 320 }}
        >
          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar projeto..."
                className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded pl-7 pr-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="overflow-y-auto scrollbar-thin py-1">
            <button
              onClick={() => {
                onChange('all');
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-slate-800 ${value === 'all' ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'}`}
            >
              <span className="truncate">Todos os projetos</span>
              {value === 'all' && <Check size={12} className="flex-shrink-0" />}
            </button>
            <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-slate-800 ${p.id === value ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'}`}
              >
                <span className="truncate">{p.name}</span>
                {p.id === value && <Check size={12} className="flex-shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400">Nenhum projeto</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Seletor de pessoa (agrupado por equipe) ── */
function PersonPicker({
  members,
  value,
  onChange,
  disabled,
  loading,
}: {
  members: { id: number; name: string; team?: string }[];
  value?: number;
  onChange: (id: number) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = members.find((m) => m.id === value);
  const filtered = members.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));

  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, m) => {
    const t = m.team || 'Outros';
    (acc[t] ??= []).push(m);
    return acc;
  }, {});
  const teams = Object.keys(grouped).sort((a, b) => {
    const ia = TEAM_ORDER.indexOf(a),
      ib = TEAM_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <span className="block text-xs text-slate-400 mb-1">Pessoa</span>
      <button
        disabled={disabled}
        onClick={() => {
          setSearch('');
          setOpen((v) => !v);
        }}
        className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 rounded-lg px-3 py-2 min-w-56 max-w-72 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Loader2 size={14} className="text-slate-400 flex-shrink-0 animate-spin" />
        ) : (
          <User size={14} className="text-slate-400 flex-shrink-0" />
        )}
        <span className="truncate flex-1 text-left">
          {loading ? 'Carregando pessoas…' : (current?.name ?? 'Selecionar pessoa...')}
        </span>
        <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-30 w-72 flex flex-col"
          style={{ maxHeight: 340 }}
        >
          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pessoa..."
                className="w-full text-xs border border-slate-200 dark:border-slate-700 rounded pl-7 pr-2 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="overflow-y-auto scrollbar-thin py-1">
            {teams.map((team) => (
              <div key={team}>
                <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-50/70 dark:bg-slate-800/50">
                  {team}{' '}
                  <span className="text-slate-300 dark:text-slate-600">
                    ({grouped[team].length})
                  </span>
                </p>
                {grouped[team].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-slate-800 ${m.id === value ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'}`}
                  >
                    <span className="truncate">{m.name}</span>
                    {m.id === value && <Check size={12} className="flex-shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400 flex items-center gap-1.5">
                {loading && <Loader2 size={12} className="animate-spin" />}
                {loading ? 'Carregando…' : 'Nenhuma pessoa'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
