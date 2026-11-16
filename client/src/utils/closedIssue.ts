import type { Issue, IssueStatus } from '../types/redmine';

// A listagem de tarefas do Redmine (4.2) devolve `status` só com { id, name }:
// o `is_closed` NÃO vem (o mesmo aviso está em components/sprints/format.ts).
// Quem confere `issue.status.is_closed` acha que toda tarefa está aberta e
// conta Fechado/Cancelado junto. A fonte confiável é a lista de /issue_statuses
// (useStatuses); enquanto ela não carregou, cai no nome do status.
export function makeIsClosedIssue(statuses?: IssueStatus[]): (issue: Issue) => boolean {
  const closedIds = new Set((statuses ?? []).filter((s) => s.is_closed).map((s) => s.id));
  const haveList = !!statuses && statuses.length > 0;
  return (issue) => {
    if (issue.status?.is_closed) return true;
    if (haveList) return closedIds.has(issue.status?.id);
    return /fechad|cancelad/i.test(issue.status?.name ?? '');
  };
}
