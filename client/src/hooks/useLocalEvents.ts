import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { eventsApi, type CreateLocalEventPayload } from '../api/events';

/** Eventos/reuniões locais numa janela [start, end] (epoch ms). */
export function useLocalEvents(start: number, end: number) {
  return useQuery({
    queryKey: ['local-events', start, end],
    queryFn: () => eventsApi.list(start, end),
    enabled: Number.isFinite(start) && Number.isFinite(end),
    staleTime: 60 * 1000,
  });
}

/** Cria um evento local e revalida a agenda. */
export function useCreateLocalEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateLocalEventPayload) => eventsApi.create(payload),
    // refetchType: 'all' — Mês e Semana são consultas com janelas [start,end]
    // diferentes; sem isso só a que está ativa na tela recarrega na hora (ver
    // mesmo comentário em useZimbraEvents.ts/useCreateEvent).
    onSuccess: () => qc.invalidateQueries({ queryKey: ['local-events'], refetchType: 'all' }),
  });
}

/** Remove um evento local e revalida a agenda. */
export function useDeleteLocalEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => eventsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['local-events'], refetchType: 'all' }),
  });
}
