import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  fetchWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  fetchWorkflowRuns,
  triggerWorkflow,
  fetchWorkflowNotifications,
  type Workflow,
  type WorkflowPatch,
} from '../api/workflows';
import { getStoredAuth } from '../api/redmine';

const KEY = ['workflows'];
const NOTIF_KEY = ['workflows', 'notifications'];

// Depois de um disparo manual ("Testar" / botão de execução real), força o sino
// a refletir na hora em vez de esperar o próximo poll (20s). `invalidateQueries`
// sozinho não basta: se a busca inicial dessa query (disparada junto com o app)
// ainda estiver em voo, o React Query reaproveita essa MESMA requisição pendente
// — que partiu ANTES do disparo — em vez de abrir uma nova, e o evento novo
// nunca apareceria. Pior: buscar e escrever direto no cache sem esperar também
// não basta sozinho, porque aquela requisição antiga, ao resolver mais tarde,
// SOBRESCREVE nosso dado fresco com o snapshot antigo. Por isso espera qualquer
// fetch em andamento terminar antes de buscar e escrever.
export async function refreshWorkflowNotifications(qc: QueryClient) {
  if (qc.getQueryState(NOTIF_KEY)?.fetchStatus === 'fetching') {
    await new Promise<void>((resolve) => {
      const unsubscribe = qc.getQueryCache().subscribe((event) => {
        const k = event.query.queryKey;
        if (k.length === NOTIF_KEY.length && k.every((v: unknown, i: number) => v === NOTIF_KEY[i])) {
          if (event.query.state.fetchStatus !== 'fetching') {
            unsubscribe();
            resolve();
          }
        }
      });
    });
  }
  try {
    const fresh = await fetchWorkflowNotifications();
    qc.setQueryData(NOTIF_KEY, fresh);
  } catch {
    qc.invalidateQueries({ queryKey: NOTIF_KEY });
  }
}

// Histórico de execução de um workflow. Enquanto o painel está aberto, atualiza
// a cada 8s para refletir disparos recentes.
export function useWorkflowRuns(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['workflow-runs', id],
    queryFn: () => fetchWorkflowRuns(id),
    enabled: enabled && !!getStoredAuth(),
    refetchInterval: enabled ? 8_000 : false,
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchWorkflows,
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: WorkflowPatch & { id?: string } = {}) => createWorkflow(patch),
    // Criação otimista com id estável vindo do cliente (o editor abre na hora,
    // sem remontar quando o servidor responde).
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Workflow[]>(KEY);
      const now = Date.now();
      const optimistic: Workflow = {
        id: patch.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: patch.name ?? 'Nova automação',
        enabled: patch.enabled ?? false,
        nodes: patch.nodes ?? [],
        createdAt: now,
        updatedAt: now,
        runCount: 0,
      };
      qc.setQueryData<Workflow[]>(KEY, (old = []) => [optimistic, ...old]);
      return { prev, id: optimistic.id };
    },
    onSuccess: (wf, _patch, ctx) => {
      qc.setQueryData<Workflow[]>(KEY, (old = []) => old.map((w) => (w.id === ctx?.id ? wf : w)));
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WorkflowPatch }) => updateWorkflow(id, patch),
    // Atualização otimista (autosave sem flicker).
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Workflow[]>(KEY);
      qc.setQueryData<Workflow[]>(KEY, (old = []) =>
        old.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}

// Dispara manualmente um workflow com gatilho `workflow.manual` (execução REAL:
// respeita filtros e executa as ações). `issueId` opcional injeta a tarefa do
// card no contexto. Ao concluir, atualiza o histórico de execuções.
export function useTriggerWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, issueId }: { id: string; issueId?: number }) => triggerWorkflow(id, issueId),
    onSuccess: async (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['workflow-runs', id] });
      qc.invalidateQueries({ queryKey: KEY });
      await refreshWorkflowNotifications(qc);
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWorkflow(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Workflow[]>(KEY);
      qc.setQueryData<Workflow[]>(KEY, (old = []) => old.filter((w) => w.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
  });
}
