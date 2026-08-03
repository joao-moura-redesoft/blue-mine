import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mailApi, type InviteVerb, type CreateEventPayload } from '../api/mail';
import { isMailAvailable } from '../utils/mailConfig';

/**
 * Compromissos do calendário Zimbra numa janela [start, end] (epoch ms).
 * Só ativa quando há credenciais de e-mail (reaproveita o login do Redmine).
 */
export function useZimbraEvents(start: number, end: number) {
  return useQuery({
    queryKey: ['zimbra-calendar', start, end],
    queryFn: () => mailApi.getCalendar(start, end),
    enabled: isMailAvailable() && Number.isFinite(start) && Number.isFinite(end),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Participantes de um compromisso e a resposta de cada um. Busca sob demanda
 * (só quando `enabled`, ex.: ao abrir o evento) — não pesa o load da agenda.
 */
export function useEventAttendees(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['zimbra-attendees', id],
    queryFn: () => mailApi.getEventAttendees(id!),
    enabled: enabled && isMailAvailable() && !!id,
    staleTime: 2 * 60 * 1000,
  });
}

/** Responde a um convite (aceitar/recusar/talvez) e revalida a agenda. */
export function useReplyToInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verb, compNum }: { id: string; verb: InviteVerb; compNum?: number }) =>
      mailApi.replyToInvite(id, verb, compNum),
    onSuccess: () => {
      // refetchType: 'all' — sem isso só a janela [start,end] ATIVA na tela recarrega;
      // Mês e Semana pedem janelas diferentes, então trocar de visão mostrava dado velho
      // até o staleTime vencer (ver mesmo comentário em useCreateEvent).
      qc.invalidateQueries({ queryKey: ['zimbra-calendar'], refetchType: 'all' });
      qc.invalidateQueries({ queryKey: ['zimbra-attendees'], refetchType: 'all' });
    },
  });
}

/** Cria um compromisso/reunião no calendário e revalida a agenda. */
export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateEventPayload) => mailApi.createEvent(payload),
    onSuccess: () => {
      // Mês e Semana são consultas DIFERENTES (janelas [start,end] distintas). Por
      // padrão invalidateQueries só refaz a que está ativa na tela agora; a outra
      // fica "stale" mas só busca de novo quando for montada de novo — se você criar
      // na visão de Semana e checar o Mês na sequência, ele ainda mostra o cache velho.
      // 'all' força as duas a se atualizarem já.
      qc.invalidateQueries({ queryKey: ['zimbra-calendar'], refetchType: 'all' });
    },
  });
}
