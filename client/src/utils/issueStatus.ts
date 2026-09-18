/** Aparência de uma tarefa citada (#92313) — cor do status e resumo pro tooltip. */

export interface IssueRefInfo {
  id: number;
  subject: string;
  status?: { id: number; name: string };
  assigned_to?: { id: number; name: string };
  tracker?: { name: string };
  done_ratio?: number;
}

// Cor do ponto de status por palavra-chave do nome (o Redmine varia os nomes).
export function statusDotColor(name?: string): string {
  const n = (name || '').toLowerCase();
  if (/fechad|resolvid|conclu|encerrad/.test(n)) return 'bg-green-500';
  if (/revis|homolog|teste|valida/.test(n)) return 'bg-purple-500';
  if (/andamento|progress|desenvolv|execu/.test(n)) return 'bg-blue-500';
  if (/pendent|aguard|espera|impedid|bloque/.test(n)) return 'bg-amber-500';
  if (/nova|aberta|backlog|entrada/.test(n)) return 'bg-slate-400';
  return 'bg-slate-400';
}

/** Status terminal? Sem a lista de status do Redmine em mãos, vale o nome. */
export function looksClosed(name?: string): boolean {
  return /fechad|resolvid|conclu|encerrad|cancelad|rejeitad/i.test(name || '');
}

/** Resumo multilinha da tarefa, para o title= do chip. */
export function issueRefTooltip(info: IssueRefInfo | null, id: number): string {
  if (!info) return `Abrir #${id}`;
  return [
    `#${info.id} — ${info.subject}`,
    info.status && `Situação: ${info.status.name}`,
    info.assigned_to && `Responsável: ${info.assigned_to.name}`,
    info.tracker && `Tipo: ${info.tracker.name}`,
    typeof info.done_ratio === 'number' && `Conclusão: ${info.done_ratio}%`,
  ]
    .filter(Boolean)
    .join('\n');
}
