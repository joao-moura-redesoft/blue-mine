import { useEffect, useRef, useState } from 'react';
import type { AppNotification } from './useActivityNotifications';
import type { WorkflowNotifyEvent } from '../api/workflows';

/**
 * Disparos da ação "Notificar (push)" das automações, refletidos no sino.
 * Não chama `notify()` do browser aqui: o push já foi tentado no servidor
 * (best-effort); isso só evita duplicar o toast quando o push funciona.
 */
export function useWorkflowNotifications(events: WorkflowNotifyEvent[] | undefined) {
  const seen = useRef<Set<string> | null>(null);
  // Corte por horário de montagem, não "é a primeira busca?" — um teste disparado
  // logo após abrir o app pode terminar ANTES da primeira busca desta query
  // resolver, e aí o evento novo já vem dentro dessa primeira resposta. Tratar
  // "primeira busca = tudo é baseline" engoliria justamente esse caso. Só o que
  // já existia ANTES de montar vira baseline; o resto sempre é notificação.
  const mountedAt = useRef(Date.now());
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!events) return;
    const ids = new Set(events.map((e) => e.id));
    if (seen.current === null) {
      seen.current = new Set(events.filter((e) => e.at <= mountedAt.current).map((e) => e.id));
    }

    const novos = events.filter((e) => !seen.current!.has(e.id));
    seen.current = ids;
    if (novos.length === 0) return;

    setNotifications((prev) => [
      ...novos.map((e) => ({
        id: `wf-${e.id}`,
        type: 'workflow' as const,
        issue: e.issueId ? { id: e.issueId, subject: e.title } : undefined,
        seenAt: new Date(e.at),
        snippet: e.body || undefined,
        author: e.workflowName,
      })),
      ...prev,
    ]);
  }, [events]);

  const dismiss = (id: string) => setNotifications((prev) => prev.filter((n) => n.id !== id));
  const dismissAll = () => setNotifications([]);

  return { notifications, dismiss, dismissAll };
}
