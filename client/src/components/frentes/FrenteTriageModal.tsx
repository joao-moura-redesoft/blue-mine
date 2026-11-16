import { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle2, ExternalLink } from 'lucide-react';
import { useFrentes, useSetManualFrente } from '../../hooks/useFrentes';
import { useStatuses } from '../../hooks/useRedmine';
import { makeIsClosedIssue } from '../../utils/closedIssue';
import type { Issue } from '../../types/redmine';

const KEYCAP =
  'px-1 rounded border border-slate-300 dark:border-slate-600 text-[10px] font-mono text-slate-500 dark:text-slate-400';

/* Fila das tarefas abertas que nenhuma regra classificou. Cada escolha vira uma
   escolha manual (vence as regras). Teclado: ↑↓ escolhe a tarefa, 1–9 dá a
   frente, Enter abre a tarefa, Esc fecha. Quando a mesma escolha se repete, o
   caminho certo é criar uma regra em Configurações → Frentes. */
export function FrenteTriageModal({
  issues,
  onClose,
  onOpenIssue,
  onOpenRules,
}: {
  issues: Issue[];
  onClose: () => void;
  onOpenIssue: (id: number) => void;
  onOpenRules?: () => void;
}) {
  const { data: cfg } = useFrentes();
  const setManual = useSetManualFrente();
  const { data: statuses } = useStatuses();
  const [idx, setIdx] = useState(0);

  const queue = useMemo(() => {
    const isClosed = makeIsClosedIssue(statuses);
    return issues
      .filter((i) => !i.frente && !isClosed(i))
      .sort((a, b) => a.created_on.localeCompare(b.created_on));
  }, [issues, statuses]);
  const frentes = useMemo(() => (cfg?.frentes ?? []).filter((f) => !f.archived), [cfg]);
  const cur = Math.min(idx, Math.max(0, queue.length - 1));
  const curId = queue[cur]?.id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setIdx((i) => Math.min(queue.length - 1, i + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        // Enter num botão já o aciona; abrir a tarefa também fecharia a fila
        // por trás do clique.
        if (tag !== 'BUTTON' && curId != null) onOpenIssue(curId);
      } else if (/^[1-9]$/.test(e.key) && curId != null && frentes[Number(e.key) - 1]) {
        setManual.mutate({ issueId: curId, frenteId: frentes[Number(e.key) - 1].id });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setManual.mutate é estável; o objeto do useMutation não
  }, [queue.length, curId, frentes, onClose, onOpenIssue, setManual.mutate]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Classificar tarefas sem frente"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Classificar tarefas
              {queue.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {queue.length} sem frente
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <kbd className={KEYCAP}>↑</kbd> <kbd className={KEYCAP}>↓</kbd> escolhem a tarefa ·{' '}
              <kbd className={KEYCAP}>1</kbd>–
              <kbd className={KEYCAP}>{Math.max(1, Math.min(9, frentes.length))}</kbd> dão a frente
              · <kbd className={KEYCAP}>Enter</kbd> abre
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2 overflow-y-auto flex-1 scrollbar-thin">
          {frentes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-500 dark:text-slate-400">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Você ainda não tem nenhuma frente
              </p>
              <p className="text-xs">Crie as frentes em Configurações para poder classificar.</p>
              {onOpenRules && (
                <button
                  onClick={onOpenRules}
                  className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Abrir Configurações → Frentes
                </button>
              )}
            </div>
          ) : queue.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-500 dark:text-slate-400">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Tudo classificado
              </p>
              <p className="text-xs">Toda tarefa aberta tem uma frente.</p>
            </div>
          ) : (
            queue.map((issue, i) => (
              <div
                key={issue.id}
                onClick={() => setIdx(i)}
                className={`rounded-xl border p-3 space-y-2 transition-colors cursor-pointer ${
                  i === cur
                    ? 'border-blue-400 ring-2 ring-blue-100 dark:ring-blue-900/40 bg-white dark:bg-slate-800'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-start gap-2">
                  <p className="flex-1 min-w-0 text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug break-words">
                    <span className="text-slate-400 dark:text-slate-500">#{issue.id}</span>{' '}
                    {issue.subject}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenIssue(issue.id);
                    }}
                    title="Abrir tarefa"
                    aria-label={`Abrir tarefa ${issue.id}`}
                    className="p-1 text-slate-400 hover:text-blue-600 rounded flex-shrink-0"
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  {issue.project.name} · {issue.status.name}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {frentes.map((f, n) => (
                    <button
                      key={f.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setManual.mutate({ issueId: issue.id, frenteId: f.id });
                      }}
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      {n < 9 && i === cur && (
                        <kbd className="text-[10px] text-slate-400 font-mono">{n + 1}</kbd>
                      )}
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: f.color }}
                      />
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {queue.length > 0 && onOpenRules && (
          <div className="px-5 py-2.5 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex-shrink-0">
            Repetindo a mesma escolha?{' '}
            <button
              onClick={onOpenRules}
              className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              Crie uma regra
            </button>{' '}
            e as próximas já chegam classificadas.
          </div>
        )}
      </div>
    </div>
  );
}
