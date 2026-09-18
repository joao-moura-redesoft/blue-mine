import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { redmineApi } from '../api/redmine';
import type { IssueRefInfo } from '../utils/issueStatus';

/**
 * Dados das tarefas citadas por #id em um texto.
 *
 * Uma query por id, na mesma chave usada pelo chip do Talk — a mesma tarefa
 * citada em várias notas (ou nos dois módulos) custa uma requisição só.
 *
 * O mapa distingue três situações: id ausente = ainda carregando;
 * `null` = a tarefa não existe (ou não é visível pra você); objeto = achou.
 */
// Teto de tarefas resolvidas por bloco de texto. Descrição de sprint
// consolidada cita dezenas de tarefas, e uma requisição por citação derruba a
// abertura do modal. As que passarem do teto continuam clicáveis — só ficam sem
// o ponto de status e sem o resumo no tooltip.
const MAX_REFS = 12;

export function useIssueRefs(rawIds: number[]): {
  byId: Map<number, IssueRefInfo | null>;
  sig: string;
} {
  const ids = rawIds.length > MAX_REFS ? rawIds.slice(0, MAX_REFS) : rawIds;
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['issue-chip', id],
      queryFn: async (): Promise<IssueRefInfo | null> =>
        (await redmineApi.getIssuesByIds([id]))[0] ?? null,
      staleTime: 10 * 60 * 1000,
    })),
  });

  // O array de resultados muda de identidade a cada render; esta assinatura é
  // o que de fato muda, e serve de dependência estável para memos de render.
  const sig = ids
    .map((id, i) => {
      const r = results[i];
      if (!r?.isSuccess) return `${id}:?`;
      return r.data ? `${id}:${r.data.status?.id ?? ''}` : `${id}:none`;
    })
    .join('|');

  const byId = useMemo(() => {
    const map = new Map<number, IssueRefInfo | null>();
    ids.forEach((id, i) => {
      const r = results[i];
      if (r?.isSuccess) map.set(id, r.data ?? null);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return { byId, sig };
}
