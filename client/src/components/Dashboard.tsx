import { useMemo, useState, useEffect } from 'react';
import { useIssues, useCompletedIssues, useTimeEntries } from '../hooks/useRedmine';
import { useNewToday } from '../hooks/useNewToday';
import { getReviewAlert, getMissingFields } from '../utils/alerts';
import { loadArchived } from '../utils/archive';
import {
  CheckCircle2,
  Check,
  Clock,
  AlertTriangle,
  ListTodo,
  TrendingUp,
  Bell,
  Archive,
  Flame,
  PlayCircle,
  Sparkles,
  ArrowRight,
  X,
  ClipboardList,
  Copy,
  Timer,
} from 'lucide-react';
import type { Issue } from '../types/redmine';
import { Link } from 'react-router-dom';
import { DashboardSkeleton } from './Skeletons';

function startOfWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Motivos de atenção
 *
 * O desenho anterior espalhava 8 cartões de mesmo peso — "Revisão atrasada: 0"
 * competia visualmente com "Prazo vencido: 8" — e a lista acionável ficava no
 * rodapé, à direita. Aqui a unidade é o MOTIVO pelo qual uma tarefa precisa de
 * você, com severidade explícita, e essa lista sobe para o topo da tela.
 * ═══════════════════════════════════════════════════════════════════════════ */

type Severity = 'critical' | 'warning' | 'info';

interface Reason {
  label: string;
  severity: Severity;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

// Uma paleta por SEVERIDADE, não por métrica. Antes eram 8 matizes diferentes
// (rosa, âmbar, violeta, ciano, ...) e, com tantas cores, a cor deixava de
// significar qualquer coisa — "rosa = parada" e "vermelho = vencida" não se
// distinguem de relance.
const SEVERITY_STYLE: Record<Severity, { chip: string; dot: string; card: string }> = {
  critical: {
    chip: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    dot: 'bg-red-500',
    card: 'border-red-200 dark:border-red-900/60',
  },
  warning: {
    chip: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    dot: 'bg-amber-500',
    card: 'border-amber-200 dark:border-amber-900/60',
  },
  info: {
    chip: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300',
    dot: 'bg-slate-400',
    card: 'border-slate-200 dark:border-slate-700',
  },
};

// Ordem de urgência das prioridades do Redmine. "Média" e "Normal" convivem
// nas instalações antigas e valem o mesmo.
const PRIORITY_RANK: Record<string, number> = {
  Imediata: 0,
  Urgente: 1,
  Alta: 2,
  Normal: 3,
  Média: 3,
  Baixa: 4,
};
const priorityRank = (name: string) => PRIORITY_RANK[name] ?? 3;

/** Prazo em linguagem de quem lê rápido: "hoje", "amanhã", "em 3 dias". */
function dueLabel(due: string): string {
  const days = Math.round(
    (new Date(due + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime()) /
      86400000,
  );
  if (days < 0) return `${-days}d atrás`;
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days <= 30) return `em ${days}d`;
  return due.split('-').reverse().slice(0, 2).join('/');
}

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Todos os motivos pelos quais uma tarefa aparece na lista. [] = está em dia. */
function reasonsFor(issue: Issue, today: string): Reason[] {
  const out: Reason[] = [];

  if (issue.due_date && issue.due_date < today) {
    out.push({
      label: `Venceu há ${plural(daysSince(issue.due_date), 'dia', 'dias')}`,
      severity: 'critical',
    });
  }

  const review = getReviewAlert(issue);
  if (review === 'overdue') out.push({ label: 'Revisão atrasada', severity: 'critical' });
  else if (review === 'today') out.push({ label: 'Revisar hoje', severity: 'warning' });

  if (issue.updated_on && daysSince(issue.updated_on) > 30) {
    out.push({
      label: `Parada há ${plural(daysSince(issue.updated_on), 'dia', 'dias')}`,
      severity: 'warning',
    });
  }

  const missing = getMissingFields(issue);
  if (missing.length) {
    out.push({ label: `Falta ${missing.join(', ').toLowerCase()}`, severity: 'info' });
  }

  return out;
}

/** Severidade da tarefa = a do seu motivo mais grave. */
function worstSeverity(reasons: Reason[]): Severity {
  return reasons.reduce<Severity>(
    (worst, r) => (SEVERITY_RANK[r.severity] < SEVERITY_RANK[worst] ? r.severity : worst),
    'info',
  );
}

/* ── Uma linha da lista "Precisa de você" ── */
function AttentionRow({
  issue,
  reasons,
  onIssueClick,
}: {
  issue: Issue;
  reasons: Reason[];
  onIssueClick: (id: number) => void;
}) {
  const style = SEVERITY_STYLE[worstSeverity(reasons)];
  return (
    <button
      onClick={() => onIssueClick(issue.id)}
      className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group"
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} aria-hidden />
      <span className="text-xs font-medium text-slate-400 dark:text-slate-500 flex-shrink-0 w-16">
        #{issue.id}
      </span>
      <span className="text-sm text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate flex-1 min-w-0">
        {issue.subject}
      </span>
      <span className="flex items-center gap-1 flex-shrink-0">
        {reasons.slice(0, 2).map((r) => (
          <span
            key={r.label}
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${SEVERITY_STYLE[r.severity].chip}`}
          >
            {r.label}
          </span>
        ))}
        {reasons.length > 2 && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            +{reasons.length - 2}
          </span>
        )}
      </span>
      <ArrowRight
        size={13}
        className="text-slate-300 dark:text-slate-600 group-hover:text-blue-500 flex-shrink-0"
      />
    </button>
  );
}

/* ── Sinal compacto: um número que vale olhar de relance ── */
function Signal({
  icon,
  label,
  issues,
  severity,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  issues: Issue[];
  severity: Severity;
  onSelect: (label: string, issues: Issue[]) => void;
}) {
  const clickable = issues.length > 0;
  const style = SEVERITY_STYLE[severity];
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => onSelect(label, issues)}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-white dark:bg-slate-800 text-left flex-1 min-w-[9.5rem] ${style.card} ${
        clickable
          ? 'hover:shadow-sm hover:border-blue-300 dark:hover:border-blue-700 cursor-pointer transition-all'
          : 'cursor-default'
      }`}
    >
      <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-lg font-bold text-slate-800 dark:text-slate-100 leading-none">
          {issues.length}
        </span>
        <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">
          {label}
        </span>
      </span>
    </button>
  );
}

/* ── Painel de tarefas referenciadas por um KPI ── */
function KpiModal({
  label,
  issues,
  onClose,
  onIssueClick,
}: {
  label: string;
  issues: Issue[];
  onClose: () => void;
  onIssueClick: (id: number) => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const today = new Date().toISOString().split('T')[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {label}{' '}
            <span className="text-slate-400 dark:text-slate-500 font-normal">
              · {issues.length}
            </span>
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto scrollbar-thin p-2">
          {issues.map((issue) => {
            const overdue = issue.due_date && issue.due_date < today;
            return (
              <button
                key={issue.id}
                onClick={() => {
                  onIssueClick(issue.id);
                  onClose();
                }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors group"
              >
                <span className="text-xs font-medium text-slate-400 dark:text-slate-500 flex-shrink-0">
                  #{issue.id}
                </span>
                <span className="text-sm text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate flex-1">
                  {issue.subject}
                </span>
                {issue.assigned_to && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0 max-w-28 truncate">
                    {issue.assigned_to.name}
                  </span>
                )}
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                    overdue
                      ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-300'
                  }`}
                >
                  {issue.status.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Resumo do dia (standup) ── */
function StandupModal({
  open,
  completed,
  onClose,
  onIssueClick,
}: {
  open: Issue[];
  completed: Issue[];
  onClose: () => void;
  onIssueClick: (id: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const done = completed.filter(
    (i) => (i.closed_on || i.updated_on || '').split('T')[0] >= yesterday,
  );
  const doing = open.filter((i) => i.status.name.toLowerCase().includes('andamento'));
  const blocked = open.filter((i) => i.status.name.toLowerCase().includes('impedi'));

  const sections: { emoji: string; title: string; list: Issue[] }[] = [
    { emoji: '✅', title: 'Concluí', list: done },
    { emoji: '🔧', title: 'Em andamento', list: doing },
    { emoji: '🚧', title: 'Impedido', list: blocked },
  ];

  const text = sections
    .map(
      (s) =>
        `${s.emoji} ${s.title}:\n${s.list.length ? s.list.map((i) => `- #${i.id} ${i.subject}`).join('\n') : '- (nenhuma)'}`,
    )
    .join('\n\n');

  const copy = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Resumo do dia
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 shadow-sm shadow-blue-500/20 hover:shadow-blue-500/40 transition-all duration-200"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto scrollbar-thin p-4 space-y-4">
          {sections.map((s) => (
            <div key={s.title}>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                {s.emoji} {s.title}{' '}
                <span className="text-slate-400 dark:text-slate-500 font-normal">
                  · {s.list.length}
                </span>
              </p>
              {s.list.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 pl-1">(nenhuma)</p>
              ) : (
                <div className="space-y-0.5">
                  {s.list.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => {
                        onIssueClick(i.id);
                        onClose();
                      }}
                      className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30 group"
                    >
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500 flex-shrink-0">
                        #{i.id}
                      </span>
                      <span className="text-xs text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate">
                        {i.subject}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Props {
  onIssueClick: (id: number) => void;
}

/**
 * Rótulo curto de projeto.
 *
 * Nomes de projeto no Redmine costumam compartilhar um prefixo longo
 * ("DESENVOLVIMENTO - Faturamento", "DESENVOLVIMENTO - Portal") e o corte no
 * FIM do texto apagava justamente o trecho que distingue um do outro — duas
 * barras apareciam como "DESENVOLVIMENTO - ...". Aqui o prefixo comum sai dos
 * rótulos e vira legenda única acima do gráfico.
 */
const NAME_SEPARATORS = [' - ', ' — ', ' / ', ' | ', ': '];

function splitCommonPrefix(names: string[]): { prefix: string; short: (n: string) => string } {
  const none = { prefix: '', short: (n: string) => n };
  if (names.length < 2) return none;

  let common = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < common.length && i < n.length && common[i] === n[i]) i++;
    common = common.slice(0, i);
    if (!common) return none;
  }

  // Só corta num separador: cortar no meio de uma palavra geraria rótulo quebrado.
  let at = -1;
  let sepLen = 0;
  for (const sep of NAME_SEPARATORS) {
    const idx = common.lastIndexOf(sep);
    if (idx > at) {
      at = idx;
      sepLen = sep.length;
    }
  }
  if (at < 3) return none;

  const cut = at + sepLen;
  return { prefix: names[0].slice(0, at), short: (n: string) => n.slice(cut) || n };
}

function fmtH(h: number): string {
  if (h === 0) return '0h';
  if (h < 1) return `${Math.round(h * 60)}min`;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

function TimeSummaryWidget() {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 8) + '01';
  const weekStart = (() => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().split('T')[0];
  })();

  const { data: entries, isLoading } = useTimeEntries({ from: monthStart, to: today });

  const stats = useMemo(() => {
    if (!entries) return null;
    const todayH = entries.filter((e) => e.spent_on === today).reduce((s, e) => s + e.hours, 0);
    const weekH = entries.filter((e) => e.spent_on >= weekStart).reduce((s, e) => s + e.hours, 0);
    const monthH = entries.reduce((s, e) => s + e.hours, 0);

    const byProject = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.project.name] = (acc[e.project.name] ?? 0) + e.hours;
      return acc;
    }, {});
    const topProjects = Object.entries(byProject)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    const maxH = topProjects[0]?.[1] ?? 1;
    const { prefix, short } = splitCommonPrefix(topProjects.map(([n]) => n));

    return { todayH, weekH, monthH, topProjects, maxH, projectPrefix: prefix, shortProject: short };
  }, [entries, today, weekStart]);

  if (isLoading)
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 flex items-center gap-2 text-slate-400 dark:text-slate-500 text-sm">
        <Timer size={15} className="animate-pulse" /> Carregando horas…
      </div>
    );
  if (!stats) return null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
        <Timer size={15} className="text-blue-500 dark:text-blue-400" /> Horas apontadas
      </h3>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          {
            label: 'Hoje',
            value: stats.todayH,
            color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30',
          },
          {
            label: 'Semana',
            value: stats.weekH,
            color: 'text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950/30',
          },
          {
            label: 'Mês',
            value: stats.monthH,
            color: 'text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-950/30',
          },
        ].map(({ label, value, color }) => {
          const bgCls = color
            .split(' ')
            .filter((c) => c.includes('bg-'))
            .join(' ');
          const textCls = color
            .split(' ')
            .filter((c) => c.includes('text-'))
            .join(' ');
          return (
            <div key={label} className={`rounded-lg px-3 py-2.5 ${bgCls}`}>
              <p className={`text-xl font-bold ${textCls}`}>{fmtH(value)}</p>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                {label}
              </p>
            </div>
          );
        })}
      </div>
      {stats.topProjects.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">
            Por projeto
            {stats.projectPrefix && (
              <span className="ml-1.5 font-medium normal-case tracking-normal text-slate-400 dark:text-slate-500">
                · {stats.projectPrefix}
              </span>
            )}
          </p>
          {stats.topProjects.map(([name, hours]) => (
            <div key={name} className="flex items-center gap-3">
              <span
                title={name}
                className="text-xs text-slate-600 dark:text-slate-300 w-40 truncate flex-shrink-0 text-right"
              >
                {stats.shortProject(name)}
              </span>
              <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-700/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full flex items-center justify-end px-1.5"
                  style={{ width: `${Math.max((hours / stats.maxH) * 100, 10)}%` }}
                >
                  <span className="text-[10px] font-bold text-white">{fmtH(hours)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {entries?.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-slate-500">
          Nenhuma hora apontada este mês.
        </p>
      )}
    </div>
  );
}

export function Dashboard({ onIssueClick }: Props) {
  const { data: openRaw, isLoading } = useIssues();
  const { data: completed } = useCompletedIssues();
  const [hideArchived, setHideArchived] = useState(true);
  const [selectedKpi, setSelectedKpi] = useState<{ label: string; issues: Issue[] } | null>(null);
  const [showStandup, setShowStandup] = useState(false);
  const newToday = useNewToday(openRaw);

  const showKpi = (label: string, issues: Issue[]) => setSelectedKpi({ label, issues });

  const open = useMemo(() => {
    if (!openRaw) return openRaw;
    if (!hideArchived) return openRaw;
    const archived = loadArchived();
    return openRaw.filter((i) => !archived.has(i.id));
  }, [openRaw, hideArchived]);

  const archivedCount = useMemo(() => {
    if (!openRaw) return 0;
    const archived = loadArchived();
    return openRaw.filter((i) => archived.has(i.id)).length;
  }, [openRaw]);

  const stats = useMemo(() => {
    const isClosed = (i: Issue) => {
      const n = i.status.name.toLowerCase();
      return n.includes('fechad') || n.includes('cancelad');
    };
    const openIssues = (open ?? []).filter((i) => !isClosed(i));
    const today = new Date().toISOString().split('T')[0];
    const weekStart = startOfWeek().toISOString().split('T')[0];

    // Uma passada só: cada tarefa carrega os motivos pelos quais pede atenção.
    // As contagens dos sinais saem daqui, então número e lista nunca divergem —
    // antes o cartão "Para eu revisar" e a barra "Pendente Revisão" mostravam
    // valores parecidos com significados diferentes, lado a lado.
    const withReasons = openIssues
      .map((issue) => ({ issue, reasons: reasonsFor(issue, today) }))
      .filter((r) => r.reasons.length > 0)
      .sort((a, b) => {
        const sev =
          SEVERITY_RANK[worstSeverity(a.reasons)] - SEVERITY_RANK[worstSeverity(b.reasons)];
        if (sev !== 0) return sev;
        // Empate de severidade: mais motivos primeiro — sinal de tarefa esquecida.
        return b.reasons.length - a.reasons.length;
      });

    const overdue = openIssues.filter((i) => i.due_date && i.due_date < today);
    const reviewOverdue = openIssues.filter((i) => getReviewAlert(i) === 'overdue');
    const missing = openIssues.filter((i) => getMissingFields(i).length > 0);
    const stale30 = openIssues.filter((i) => i.updated_on && daysSince(i.updated_on) > 30);
    const emAndamento = openIssues.filter((i) => i.status.name.toLowerCase().includes('andamento'));
    const completedThisWeek = (completed ?? []).filter((i) => {
      const date = i.closed_on || i.updated_on;
      return date && date.split('T')[0] >= weekStart;
    });

    // "O que eu começo agora?" — a pergunta que sobra quando nada está em
    // andamento. Exclui o que já apareceu acima (em andamento e "precisa de
    // você") para a tela não repetir a mesma tarefa em dois blocos.
    const shownAbove = new Set([
      ...emAndamento.map((i) => i.id),
      ...withReasons.map((r) => r.issue.id),
    ]);
    const upNext = openIssues
      .filter((i) => !shownAbove.has(i.id))
      .sort((a, b) => {
        const p = priorityRank(a.priority.name) - priorityRank(b.priority.name);
        if (p !== 0) return p;
        const da = a.due_date ?? '9999-12-31';
        const db = b.due_date ?? '9999-12-31';
        if (da !== db) return da < db ? -1 : 1;
        return a.id - b.id;
      });

    return {
      openIssues,
      withReasons,
      upNext,
      overdue,
      reviewOverdue,
      missing,
      stale30,
      emAndamento,
      completedThisWeek,
    };
  }, [open, completed]);

  if (isLoading && !openRaw) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Dashboard</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            O que precisa de você agora
          </p>
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  // Sinais na ordem em que importam: o que está estourado primeiro. Os zerados
  // saem da faixa e viram uma linha discreta de "em dia" — um zero não merece o
  // mesmo espaço visual que uma urgência.
  const signals: Array<{
    key: string;
    icon: React.ReactNode;
    label: string;
    issues: Issue[];
    severity: Severity;
  }> = [
    {
      key: 'overdue',
      icon: <AlertTriangle size={16} />,
      label: 'Prazo vencido',
      issues: stats.overdue,
      severity: 'critical',
    },
    {
      key: 'reviewOverdue',
      icon: <Bell size={16} />,
      label: 'Revisão atrasada',
      issues: stats.reviewOverdue,
      severity: 'critical',
    },
    {
      key: 'stale',
      icon: <Flame size={16} />,
      label: 'Paradas +30 dias',
      issues: stats.stale30,
      severity: 'warning',
    },
    {
      key: 'missing',
      icon: <Clock size={16} />,
      label: 'Campos faltando',
      issues: stats.missing,
      severity: 'warning',
    },
  ];
  const activeSignals = signals.filter((s) => s.issues.length > 0);
  const clearSignals = signals.filter((s) => s.issues.length === 0);

  const attention = stats.withReasons;
  const ATTENTION_LIMIT = 8;

  // Os sinais são um resumo dos MESMOS motivos que a lista abaixo detalha. Com
  // poucos itens o resumo vira repetição — "Campos faltando: 1" logo acima da
  // única linha da lista, que é justamente essa tarefa. Só aparecem quando há
  // volume suficiente para valer um panorama.
  const SIGNALS_MIN = 4;
  const showSignals = activeSignals.length > 0 && attention.length >= SIGNALS_MIN;

  // Sem nada em andamento, a pergunta útil deixa de ser "no que estou?" e passa
  // a ser "o que começo agora?".
  const working = stats.emAndamento.length > 0;
  const panelList = working ? stats.emAndamento : stats.upNext;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Dashboard</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            O que precisa de você agora
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowStandup(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            title="Gera um resumo pronto para a daily"
          >
            <ClipboardList size={13} />
            Resumo do dia
          </button>
          <button
            onClick={() => setHideArchived((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              hideArchived
                ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200 dark:bg-slate-700/50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'
                : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40'
            }`}
            title="Inclui ou não as tarefas arquivadas localmente"
          >
            <Archive size={13} />
            {hideArchived
              ? `Arquivadas ocultas (${archivedCount})`
              : `Mostrando arquivadas (${archivedCount})`}
          </button>
        </div>
      </div>

      {/* Sinais — faixa compacta, só o que não está zerado */}
      {showSignals && (
        <div className="flex flex-wrap gap-2.5">
          {activeSignals.map((s) => (
            <Signal
              key={s.key}
              icon={s.icon}
              label={s.label}
              issues={s.issues}
              severity={s.severity}
              onSelect={showKpi}
            />
          ))}
        </div>
      )}
      {/* Sem nada pendente, uma faixa fina basta. O cartão vazio de antes
          gastava 130px de altura para dizer que estava tudo certo — e "Em dia:"
          logo acima repetia a mesma informação com outras palavras. */}
      {attention.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 dark:border-green-900/60 bg-green-50/60 dark:bg-green-950/20 px-4 py-2.5">
          <CheckCircle2 size={15} className="text-green-600 dark:text-green-400 flex-shrink-0" />
          <span className="text-sm text-green-800 dark:text-green-300">Nada pendente de você</span>
          <span className="text-xs text-green-700/70 dark:text-green-400/60 truncate">
            — prazos, revisões, tarefas paradas e campos obrigatórios em dia
          </span>
        </div>
      ) : (
        <>
          {clearSignals.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
              <Check size={12} className="text-green-500 flex-shrink-0" />
              Em dia: {clearSignals.map((s) => s.label.toLowerCase()).join(' · ')}
            </p>
          )}

          {/* Precisa de você — a lista que responde "o que eu faço agora".
              Era o melhor painel da tela e ficava no rodapé, à direita. */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-500" />
                Precisa de você
                <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                  · {attention.length}
                </span>
              </h3>
              {attention.length > ATTENTION_LIMIT && (
                <button
                  onClick={() =>
                    showKpi(
                      'Precisa de você',
                      attention.map((a) => a.issue),
                    )
                  }
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
                >
                  ver todas ({attention.length})
                </button>
              )}
            </div>
            <div className="p-1.5">
              {attention.slice(0, ATTENTION_LIMIT).map(({ issue, reasons }) => (
                <AttentionRow
                  key={issue.id}
                  issue={issue}
                  reasons={reasons}
                  onIssueClick={onIssueClick}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Chegou hoje — só quando existe. Antes uma faixa de largura inteira
          anunciava que não havia nada. */}
      {newToday.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <Sparkles size={15} className="text-blue-500 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Chegou hoje
              <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">
                · {newToday.length}
              </span>
            </h3>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              — criadas ou recém-atribuídas a você
            </span>
          </div>
          <div className="p-1.5">
            {newToday.slice(0, 5).map((issue) => (
              <button
                key={issue.id}
                onClick={() => onIssueClick(issue.id)}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group"
              >
                <span className="text-xs font-medium text-slate-400 dark:text-slate-500 flex-shrink-0 w-16">
                  #{issue.id}
                </span>
                <span className="text-sm text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate flex-1">
                  {issue.subject}
                </span>
                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 dark:text-slate-300 dark:bg-slate-700/50 px-1.5 py-0.5 rounded flex-shrink-0">
                  {issue.status.name}
                </span>
              </button>
            ))}
            {newToday.length > 5 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 px-3 py-1.5">
                e mais {newToday.length - 5}…
              </p>
            )}
          </div>
        </div>
      )}

      {/* Contexto do dia: no que estou trabalhando (ou no que deveria começar)
          e quanto já apontei. O painel troca de conteúdo conforme o estado —
          anunciar "nenhuma tarefa em andamento" numa caixa vazia gastava meia
          tela para não dizer nada. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 min-w-0">
              {working ? (
                <>
                  <PlayCircle size={15} className="text-blue-500 flex-shrink-0" />
                  Em andamento
                  <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                    · {stats.emAndamento.length}
                  </span>
                </>
              ) : (
                <>
                  <ArrowRight size={15} className="text-blue-500 flex-shrink-0" />
                  Próximas
                  <span className="hidden md:inline text-xs font-normal text-slate-400 dark:text-slate-500">
                    · por prioridade e prazo
                  </span>
                </>
              )}
            </h3>
            <span className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
              <span className="flex items-center gap-1" title="Tarefas abertas atribuídas a você">
                <ListTodo size={12} /> {stats.openIssues.length} abertas
              </span>
              <span className="flex items-center gap-1" title="Concluídas nesta semana">
                <CheckCircle2 size={12} className="text-green-500" />
                {stats.completedThisWeek.length} na semana
              </span>
            </span>
          </div>
          {panelList.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500 text-center">
              {stats.openIssues.length === 0
                ? 'Nenhuma tarefa aberta atribuída a você.'
                : 'Tudo o que está aberto já aparece acima.'}
            </p>
          ) : (
            <div className="p-1.5">
              {panelList.slice(0, 6).map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => onIssueClick(issue.id)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group"
                >
                  <span className="text-xs font-medium text-slate-400 dark:text-slate-500 flex-shrink-0 w-16">
                    #{issue.id}
                  </span>
                  <span className="text-sm text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate flex-1 min-w-0">
                    {issue.subject}
                  </span>
                  {working ? (
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0">
                      {issue.done_ratio}%
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {priorityRank(issue.priority.name) <= 2 && (
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                            priorityRank(issue.priority.name) <= 1
                              ? SEVERITY_STYLE.critical.chip
                              : SEVERITY_STYLE.warning.chip
                          }`}
                        >
                          {issue.priority.name}
                        </span>
                      )}
                      {issue.due_date && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                          {dueLabel(issue.due_date)}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              ))}
              {panelList.length > 6 && (
                <button
                  onClick={() => showKpi(working ? 'Em andamento' : 'Próximas', panelList)}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline px-3 py-1.5"
                >
                  ver todas ({panelList.length})
                </button>
              )}
            </div>
          )}
        </div>

        <TimeSummaryWidget />
      </div>

      {/* Os gráficos de tendência saíram daqui: Tendências, Fluxo e Prazos & SLA
          já têm cada um deles, com mais recorte. O dashboard aponta para lá em
          vez de manter uma segunda versão pior da mesma informação. */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-400 dark:text-slate-500">Análises detalhadas:</span>
        {[
          { to: '/trends', label: 'Tendências', hint: 'Criadas vs concluídas, backlog no tempo' },
          { to: '/flow', label: 'Fluxo', hint: 'Gargalos por status, envelhecimento do WIP' },
          { to: '/sla', label: 'Prazos & SLA', hint: 'Cumprimento de prazo' },
          { to: '/me', label: 'Meu desempenho', hint: 'Throughput e cycle time' },
        ].map(({ to, label, hint }) => (
          <Link
            key={to}
            to={to}
            title={hint}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-blue-300 hover:text-blue-600 dark:hover:border-blue-700 dark:hover:text-blue-400 transition-colors"
          >
            <TrendingUp size={11} />
            {label}
          </Link>
        ))}
      </div>

      {selectedKpi && (
        <KpiModal
          label={selectedKpi.label}
          issues={selectedKpi.issues}
          onClose={() => setSelectedKpi(null)}
          onIssueClick={onIssueClick}
        />
      )}

      {showStandup && (
        <StandupModal
          open={stats.openIssues}
          completed={completed ?? []}
          onClose={() => setShowStandup(false)}
          onIssueClick={onIssueClick}
        />
      )}
    </div>
  );
}
