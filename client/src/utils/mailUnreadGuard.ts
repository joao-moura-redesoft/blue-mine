// O contador de não-lidos do Zimbra (GetFolderRequest na Inbox) é eventualmente
// consistente: propaga com atraso (observado até 5min) em relação à flag de
// leitura da própria mensagem, que já é marcada na hora. Sem isso, um refetch
// que bate nessa janela de atraso sobrescreve o decremento otimista feito ao
// abrir a mensagem e faz o contador (e a notificação derivada dele) "voltarem"
// a mostrar e-mail não lido por alguns minutos.
const GRACE_MS = 5 * 60_000;

interface GuardState {
  floor: number;
  ceiling: number;
  until: number;
}

let state: GuardState | null = null;

// Chamado a cada decremento otimista local (mensagem aberta/lida). Estende a
// janela em vez de sobrescrever, para cobrir leituras seguidas de várias
// mensagens dentro do mesmo período de graça.
export function recordLocalDecrement(before: number, after: number): void {
  if (after >= before) return;
  const now = Date.now();
  state =
    state && now < state.until
      ? {
          floor: Math.min(state.floor, after),
          ceiling: Math.max(state.ceiling, before),
          until: now + GRACE_MS,
        }
      : { floor: after, ceiling: before, until: now + GRACE_MS };
}

// Filtra o valor vindo do servidor: se ele cair no intervalo que suspeitamos
// ser eco do Zimbra ainda não propagado, devolve o valor local confirmado. Um
// aumento além do teto observado antes da leitura é e-mail genuinamente novo
// e desarma a guarda.
export function guard(serverUnread: number): number {
  if (!state) return serverUnread;
  if (Date.now() > state.until) {
    state = null;
    return serverUnread;
  }
  if (serverUnread > state.floor && serverUnread <= state.ceiling) {
    return state.floor;
  }
  if (serverUnread <= state.floor) {
    return serverUnread;
  }
  state = null;
  return serverUnread;
}

// Descarta a supressão. Chamado em qualquer ação explícita do usuário sobre a
// mensagem (marcar não lida, lixeira, etc.) — o próximo valor do servidor deve
// ser confiado sem filtro.
export function clear(): void {
  state = null;
}
