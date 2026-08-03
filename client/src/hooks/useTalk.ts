import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRooms,
  fetchMessages,
  sendMessage,
  fetchTalkMe,
  getTalkAuth,
  cacheTalkUid,
  editMessage,
  deleteMessage,
  deleteMessageAttachment,
  addReaction,
  removeReaction,
  createRoom,
  searchNCUsers,
  fetchUserStatuses,
  fetchRedmineTalkMatch,
  isTalkAuthBroken,
  subscribeTalkAuthBroken,
} from '../api/talk';
import type {
  TalkMessage,
  TalkRoom,
  UserStatus,
  RedmineTalkMatch,
  TalkParticipant,
} from '../api/talk';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { talkRead } from '../utils/talkRead';

function talkEnabled() {
  return !!getTalkAuth();
}

/**
 * Assina o disjuntor de autenticação do Talk (ver api/talk.ts).
 *
 * Enquanto a credencial estiver recusada, desligamos o POLLING — mas não as
 * queries. A diferença importa: o refetch de foco de janela do TanStack continua
 * valendo, então um 401 passageiro se cura sozinho quando o usuário volta para a
 * aba, sem precisar religar a conta.
 */
function useTalkAuthBroken() {
  return useSyncExternalStore(
    subscribeTalkAuthBroken,
    isTalkAuthBroken,
    () => false, // sem DOM (SSR/teste): nunca "quebrado"
  );
}

// Quem sou eu no Talk. Diferente das outras queries daqui, esta NÃO tinha
// refetchInterval e usava staleTime: Infinity — ou seja, uma única falha (o
// retry global é 1) deixava `me` indefinido pelo resto da sessão, e o `myId`
// caía num fallback que nunca casa com o actorId. Resultado: todas as minhas
// mensagens renderizavam como se fossem do outro lado. Daí o cache em disco e a
// revalidação.
export function useTalkCurrentUser() {
  const authBroken = useTalkAuthBroken();
  return useQuery({
    queryKey: ['talk-me'],
    queryFn: async () => {
      const me = await fetchTalkMe();
      if (me?.id) cacheTalkUid(me.id);
      return me;
    },
    enabled: talkEnabled(),
    staleTime: 30 * 60_000,
    // Com a credencial já recusada, `retry: 3` transforma cada tentativa em 4
    // requisições — foi o que gerou os 462 erros deste endpoint no log.
    retry: authBroken ? false : 3,
  });
}

export function useTalkRooms() {
  const authBroken = useTalkAuthBroken();
  return useQuery({
    queryKey: ['talk-rooms'],
    queryFn: fetchRooms,
    enabled: talkEnabled(),
    // Credencial recusada: para o intervalo em vez de repetir o mesmo 401 a cada
    // 15s para sempre. Rearma sozinho na primeira resposta boa.
    refetchInterval: authBroken ? false : 15_000,
    // Sem isso o TanStack pausa o interval quando a aba perde o foco — e como o SW
    // suprime o push enquanto existe qualquer janela (mesmo minimizada), ficaríamos
    // sem notificação de Talk até voltar o foco.
    refetchIntervalInBackground: true,
    staleTime: 10_000,
    // Suprime o "não lido" que o servidor ainda reporta mas o usuário JÁ leu neste
    // dispositivo (recálculo eventual do NC / POST /read não propagado). Só zera —
    // nunca aumenta — então mensagens NOVAS (id > readId) continuam aparecendo.
    // Roda a cada mudança do cache (inclui o poll de fundo), então um poll com contagem
    // antiga é neutralizado na hora, sem "piscar de volta".
    select: (rooms: TalkRoom[]) =>
      rooms.map((r) => {
        const lastId = r.lastMessage?.id ?? 0;
        return r.unreadMessages > 0 && lastId > 0 && talkRead.get(r.token) >= lastId
          ? { ...r, unreadMessages: 0, unreadMention: false }
          : r;
      }),
  });
}

export function useTalkMessages(token: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['talk-messages', token],
    queryFn: async () => {
      const fresh = await fetchMessages(token!);
      // Um refetch de fundo (intervalo de 30s, foco da aba, staleTime) NÃO pode simplesmente
      // substituir o cache pela lista do servidor: isso apagaria (a) mensagens em TRÂNSITO
      // e (b) mensagens já ENTREGUES que o Nextcloud ainda não indexou (read-after-write).
      // Merge abaixo protege as duas classes antes de aceitar `fresh`.
      const prev = qc.getQueryData<TalkMessage[]>(['talk-messages', token]) ?? [];

      // 1) Bolhas otimistas (enviando/falhou) ainda ausentes no servidor.
      //    A mensagem real já chegou? (mesmo autor + texto) → descarta a bolha otimista.
      //    Bônus: se o servidor recebeu mas a resposta falhou (timeout), a bolha "falhou"
      //    some sozinha no próximo refetch, pois a mensagem real aparece em `fresh`.
      //    Casamos por CONTAGEM (multiset), não por presença: enviar o mesmo texto 2x
      //    seguidas gera 2 bolhas com a MESMA chave; um único real correspondente deve
      //    descartar só UMA delas, não as duas (senão a 2ª some até o próximo refetch).
      const pending = prev.filter((m) => m._status === 'sending' || m._status === 'failed');
      const freshCounts = new Map<string, number>();
      for (const m of fresh) {
        const k = `${m.actorId} ${m.message}`;
        freshCounts.set(k, (freshCounts.get(k) ?? 0) + 1);
      }
      const keepPending = pending.filter((p) => {
        const k = `${p.actorId} ${p._clientText ?? p.message}`;
        const n = freshCounts.get(k) ?? 0;
        if (n > 0) {
          freshCounts.set(k, n - 1); // consome uma correspondência real
          return false; // o real chegou → descarta esta bolha otimista
        }
        return true; // ainda não veio → mantém
      });

      // 2) Read-after-write do Nextcloud: LOGO após enviar (POST já resolvido, bolha real
      //    no cache SEM _status), o GET às vezes volta SEM a mensagem recém-postada. Antes,
      //    como não havia mais nenhuma bolha "pending", o refetch devolvia `fresh` cru e a
      //    mensagem JÁ ENTREGUE "piscava e sumia" alguns segundos depois. Preservamos toda
      //    mensagem real do cache mais NOVA que a mais nova do servidor: só pode ser uma
      //    entrega ainda não indexada — nunca uma exclusão (exclusões são de ids antigos).
      //    Se `fresh` vier vazio (erro transitório), mantém a conversa inteira em vez de zerar.
      const maxFreshId = fresh.reduce((max, m) => (m.id > max ? m.id : max), 0);
      const freshIds = new Set(fresh.map((m) => m.id));
      const keepNewer = prev.filter((m) => !m._status && m.id > maxFreshId && !freshIds.has(m.id));

      if (keepPending.length === 0 && keepNewer.length === 0) return fresh;
      return [...keepPending, ...keepNewer, ...fresh];
    },
    enabled: !!token && talkEnabled(),
    refetchInterval: 30_000, // SSE handles real-time; this is just a sync fallback
    staleTime: 4_000,
  });
}

// Sequência para gerar ids temporários (client) que ordenam como "mais recentes":
// ids reais do Talk são pequenos e sequenciais; Date.now() (ms) é muito maior.
let tempSeq = 0;

type SendVars = {
  message: string;
  replyTo?: number;
  // Apenas para a bolha otimista — ignorados pelo servidor
  _parent?: NonNullable<TalkMessage['parent']>;
  _text?: string;
};

export function useSendMessage(token: string | null, myId = '', myName = '') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, replyTo }: SendVars) => sendMessage(token!, message, replyTo),
    // Insere imediatamente uma bolha "enviando" (otimista)
    onMutate: async (vars: SendVars) => {
      const clientId = Date.now() + tempSeq++;
      const temp: TalkMessage = {
        id: clientId,
        token: token ?? '',
        actorType: 'users',
        actorId: myId,
        actorDisplayName: myName,
        timestamp: Math.floor(Date.now() / 1000),
        message: vars.message,
        messageParameters: {},
        systemMessage: '',
        messageType: 'comment',
        isReplyable: false,
        parent: vars._parent,
        reactions: {},
        reactionsSelf: [],
        _status: 'sending',
        _clientText: vars._text ?? vars.message,
        _clientReplyTo: vars.replyTo,
      };
      await qc.cancelQueries({ queryKey: ['talk-messages', token] });
      qc.setQueryData(['talk-messages', token], (old: TalkMessage[] = []) => [temp, ...old]);
      return { clientId };
    },
    // Falhou: marca a bolha como erro (permanece para reenvio). MAS numa rede instável o
    // POST costuma ENTREGAR a mensagem e só perder a resposta — então dispara um refetch de
    // reconciliação: se a mensagem real aparecer no servidor, o merge do queryFn descarta
    // esta bolha "falhou" e mostra a mensagem de verdade (sem reenvio manual, que duplicaria).
    // Se realmente não foi entregue, o refetch não a traz e a bolha "falhou" permanece.
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      qc.setQueryData(['talk-messages', token], (old: TalkMessage[] = []) =>
        old.map((m) => (m.id === ctx.clientId ? { ...m, _status: 'failed' as const } : m)),
      );
      qc.invalidateQueries({ queryKey: ['talk-messages', token] });
      qc.invalidateQueries({ queryKey: ['talk-rooms'] });
    },
    // Sucesso: troca a bolha temporária pela mensagem real (sem flicker nem duplicata)
    onSuccess: (data, _v, ctx) => {
      // A resposta do POST traz o actorId com que o servidor gravou a mensagem —
      // é a prova definitiva de quem eu sou no Talk. Aproveita para corrigir o
      // cache caso /talk/me esteja indisponível ou tenha ficado defasado.
      if (data?.actorId) cacheTalkUid(data.actorId);
      if (ctx) {
        qc.setQueryData(['talk-messages', token], (old: TalkMessage[] = []) => {
          if (!data?.id) return old.filter((m) => m.id !== ctx.clientId);
          // Se o SSE já entregou a mensagem real (id real ≠ clientId temporário), a bolha
          // definitiva já está na lista; apenas removemos a temporária para não duplicar.
          if (old.some((m) => m.id === data.id)) return old.filter((m) => m.id !== ctx.clientId);
          return old.map((m) => (m.id === ctx.clientId ? data : m));
        });
      }
      // NÃO invalidar ['talk-messages'] aqui: o setQueryData acima já inseriu a mensagem
      // real (resposta do POST) e o SSE cobre o que vier depois. Um refetch imediato corre
      // contra o read-after-write do Nextcloud — o GET às vezes volta SEM a mensagem recém
      // enviada e, ao substituir o cache, ela "pisca e some". O refetchInterval (30s) e o
      // SSE reconciliam sem esse risco.
      qc.invalidateQueries({ queryKey: ['talk-rooms'] });
    },
  });
}

export function useEditMessage(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, message }: { messageId: number; message: string }) =>
      editMessage(token!, messageId, message),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['talk-messages', token] }),
  });
}

export function useDeleteMessage(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) => deleteMessage(token!, messageId),
    // Exclusão otimista: marca a mensagem como comment_deleted na hora. O filtro de
    // visibilidade (messageType === 'comment') esconde comment_deleted, então a bolha
    // some imediatamente — sem depender do refetch de reconciliação, que numa conexão
    // lenta pode demorar/falhar e deixava a mensagem "excluída" ainda visível na conversa.
    onMutate: async (messageId) => {
      await qc.cancelQueries({ queryKey: ['talk-messages', token] });
      const prev = qc.getQueryData<TalkMessage[]>(['talk-messages', token]);
      qc.setQueryData<TalkMessage[]>(['talk-messages', token], (old = []) =>
        old.map((m) =>
          m.id === messageId
            ? { ...m, messageType: 'comment_deleted', systemMessage: 'message_deleted' }
            : m,
        ),
      );
      return { prev };
    },
    // Reverte se o Talk recusar (ex.: fora da janela de tempo permitida para excluir).
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['talk-messages', token], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['talk-messages', token] }),
  });
}

export function useDeleteMessageAttachment(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, path }: { messageId: number; path: string }) =>
      deleteMessageAttachment(token!, messageId, path),
    // O Talk não reescreve o conteúdo da mensagem quando o arquivo por trás é apagado, então
    // marcamos localmente (_attachmentRemoved) para a bolha parar de mostrar a prévia na hora.
    onSuccess: (_data, { messageId }) => {
      qc.setQueryData<TalkMessage[]>(['talk-messages', token], (old = []) =>
        old.map((m) => (m.id === messageId ? { ...m, _attachmentRemoved: true } : m)),
      );
    },
  });
}

export function useReaction(token: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      reaction,
      remove,
    }: {
      messageId: number;
      reaction: string;
      remove?: boolean;
    }) =>
      remove
        ? removeReaction(token!, messageId, reaction)
        : addReaction(token!, messageId, reaction),
    onSettled: () => qc.invalidateQueries({ queryKey: ['talk-messages', token] }),
  });
}

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      roomType,
      invite,
      roomName,
    }: {
      roomType: number;
      invite: string;
      roomName?: string;
    }) => createRoom(roomType, invite, roomName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['talk-rooms'] }),
  });
}

// Mapa userId → status de presença. Quem não estiver no mapa é tratado como offline.
export function useUserStatuses() {
  return useQuery({
    queryKey: ['talk-user-statuses'],
    queryFn: async () => {
      const list = await fetchUserStatuses();
      return new Map<string, UserStatus>(list.map((s) => [s.userId, s]));
    },
    enabled: talkEnabled(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// Mapa redmineId → usuário do Talk correspondente (por nome). O servidor já cacheia
// por 24h (a fonte é pesada — catálogo de contatos do Nextcloud), então aqui basta
// não reconsultar a cada montagem de componente.
export function useTalkRedmineMatch() {
  return useQuery({
    queryKey: ['talk-redmine-match'],
    queryFn: () => fetchRedmineTalkMatch(),
    enabled: talkEnabled(),
    staleTime: 60 * 60 * 1000,
  });
}

// Força reconstruir o vínculo Redmine↔Talk agora (ignora o cache de 24h do servidor)
// e já atualiza o cache do React Query — sem isso, quem clicasse "atualizar" continuaria
// vendo os dados antigos por até 1h (staleTime), mesmo com o servidor já atualizado.
export function useRefreshTalkRedmineMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetchRedmineTalkMatch(true),
    onSuccess: (data) => qc.setQueryData(['talk-redmine-match'], data),
  });
}

export function useTalkMatchFor(redmineId?: number): RedmineTalkMatch | undefined {
  const { data } = useTalkRedmineMatch();
  if (!redmineId || !data) return undefined;
  // Defensivo: uma resposta em cache de uma versão anterior (ou de um erro transitório
  // do servidor) pode não ter esse campo — não deixa a UI inteira quebrar por isso.
  return data.byRedmineId?.[String(redmineId)];
}

// Caminho inverso: dado o usuário do Talk (ncUid), acha o id dele no Redmine —
// usado pelo pop-up de perfil do Talk pra linkar de volta pra pessoa no Redmine.
export function useRedmineIdForNcUid(ncUid?: string): number | undefined {
  const { data } = useTalkRedmineMatch();
  if (!ncUid || !data) return undefined;
  // Cache em disco de uma versão anterior (antes do byNcUid existir) pode não ter
  // o campo — o servidor detecta e reconstrói, mas defende contra a resposta velha
  // que ainda pode estar em memória/cache do react-query no meio da transição.
  return data.byNcUid?.[ncUid];
}

export function useSearchNCUsers(query: string) {
  return useQuery({
    queryKey: ['talk-search-users', query],
    queryFn: () => searchNCUsers(query),
    enabled: query.length >= 2 && talkEnabled(),
    staleTime: 30_000,
  });
}

// Debounced typing sender — chama sendTyping sem sobrecarregar a API.
export function useTypingSender(token: string | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);

  const onType = useCallback(() => {
    if (!token) return;
    if (!isTyping.current) {
      isTyping.current = true;
      fetch(`/api/talk/rooms/${encodeURIComponent(token)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typing: true }),
      }).catch(() => {});
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isTyping.current = false;
      fetch(`/api/talk/rooms/${encodeURIComponent(token)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typing: false }),
      }).catch(() => {});
    }, 3000);
  }, [token]);

  const stopTyping = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (isTyping.current && token) {
      isTyping.current = false;
      fetch(`/api/talk/rooms/${encodeURIComponent(token)}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typing: false }),
      }).catch(() => {});
    }
  }, [token]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { onType, stopTyping };
}

// SSE hook — atualiza o cache de mensagens em tempo real via long-poll do Talk.
// initialMessageId: ID da mensagem mais recente já carregada; 0 = SSE desativado.
// Usar Math.max(...messages.map(m=>m.id)) no caller para funcionar com qualquer ordem da API.
export function useTalkSSE(token: string | null, initialMessageId: number) {
  const qc = useQueryClient();
  const [typingUsers, setTypingUsers] = useState<
    Array<{ actorId: string; actorDisplayName: string }>
  >([]);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Estado real da conexão SSE, exposto para o indicador "Conectado/Sem conexão".
  // Começa true para não piscar "sem conexão" no primeiro render, antes do onopen.
  const [connected, setConnected] = useState(true);

  // Booleano como dep: SSE só (re)inicia quando passa de 0 para >0, evita restart a cada mensagem.
  const active = initialMessageId > 0;

  useEffect(() => {
    if (!token || !active || !talkEnabled()) return;
    const auth = getTalkAuth();
    if (!auth) return;

    const params = new URLSearchParams({
      lastKnownMessageId: String(initialMessageId),
    });

    const sse = new EventSource(`/api/talk/rooms/${encodeURIComponent(token)}/sse?${params}`, {
      withCredentials: true,
    });

    sse.onmessage = (e) => {
      let event: { type: string; data: unknown };
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }

      if (event.type === 'messages') {
        const msgs = event.data as TalkMessage[];
        let hadNew = false;
        qc.setQueryData(['talk-messages', token], (old: TalkMessage[] = []) => {
          const ids = new Set(old.map((m) => m.id));
          const toAdd = [...msgs].reverse().filter((m) => !ids.has(m.id));
          if (toAdd.length === 0) return old;
          hadNew = true;
          // Quando a mensagem real chega via SSE antes do onSuccess do envio, remove a
          // bolha otimista correspondente (mesmo autor/texto ainda "enviando") para não
          // exibir duas bolhas idênticas por alguns milissegundos.
          // Casamento por CONTAGEM (multiset): 2 bolhas "ok" iguais + 1 real "ok" no
          // lote do SSE descarta so UMA bolha, nao as duas. (Tambem remove um byte NULO
          // que havia no separador da chave — era um \0 em vez de espaco.)
          const addedCounts = new Map<string, number>();
          for (const m of toAdd) {
            const k = `${m.actorId} ${m.message}`;
            addedCounts.set(k, (addedCounts.get(k) ?? 0) + 1);
          }
          const base = old.filter((m) => {
            if (m._status !== 'sending') return true;
            const k = `${m.actorId} ${m.message}`;
            const n = addedCounts.get(k) ?? 0;
            if (n > 0) {
              addedCounts.set(k, n - 1);
              return false;
            }
            return true;
          });
          return [...toAdd, ...base];
        });
        // invalidateQueries fora do updater para evitar efeito colateral em função pura
        if (hadNew) {
          qc.invalidateQueries({ queryKey: ['talk-rooms'] });
          // Atualiza o lastReadMessage otimisticamente (quem enviou a msg com certeza já leu tudo até ali)
          qc.setQueryData(['talk-participants', token], (old: TalkParticipant[] | undefined) => {
            if (!old) return old;
            const maxIds = new Map<string, number>();
            for (const m of msgs) {
              const current = maxIds.get(m.actorId) ?? 0;
              if (m.id > current) maxIds.set(m.actorId, m.id);
            }
            return old.map((p) => {
              const maxId = maxIds.get(p.actorId);
              if (maxId && maxId > (p.lastReadMessage ?? 0)) {
                return { ...p, lastReadMessage: maxId };
              }
              return p;
            });
          });
          // Atrasa a invalidação para não correr contra o request POST /read do cliente da outra pessoa
          setTimeout(() => qc.invalidateQueries({ queryKey: ['talk-participants', token] }), 1500);
        }
      }

      if (event.type === 'typing') {
        const users = event.data as Array<{ actorId: string; actorDisplayName: string }>;

        // Se está digitando, com certeza viu a última mensagem enviada!
        const msgs = qc.getQueryData<TalkMessage[]>(['talk-messages', token]);
        const latestId = msgs && msgs.length > 0 ? msgs[0].id : 0;
        if (latestId > 0) {
          qc.setQueryData(['talk-participants', token], (old: TalkParticipant[] | undefined) => {
            if (!old) return old;
            return old.map((p) => {
              if (
                users.some((u) => u.actorId === p.actorId) &&
                latestId > (p.lastReadMessage ?? 0)
              ) {
                return { ...p, lastReadMessage: latestId };
              }
              return p;
            });
          });
        }
        setTimeout(() => qc.invalidateQueries({ queryKey: ['talk-participants', token] }), 1500);
        setTypingUsers((prev) => {
          const map = new Map(prev.map((u) => [u.actorId, u]));
          users.forEach((u) => map.set(u.actorId, u));
          return [...map.values()];
        });
        // Auto-remove typing indicator after 5s
        users.forEach((u) => {
          const prev = typingTimers.current.get(u.actorId);
          if (prev) clearTimeout(prev);
          typingTimers.current.set(
            u.actorId,
            setTimeout(() => {
              setTypingUsers((p) => p.filter((x) => x.actorId !== u.actorId));
              typingTimers.current.delete(u.actorId);
            }, 5000),
          );
        });
      }
    };

    sse.onopen = () => setConnected(true);

    sse.onerror = () => {
      // EventSource reconecta sozinho; só refletimos a queda na UI. Quando a
      // reconexão vinga, o onopen acima volta o indicador para "conectado".
      setConnected(false);
    };

    // Captura o Map agora: no cleanup, ler typingTimers.current de novo poderia
    // pegar outro objeto e deixar os timers deste efeito rodando soltos.
    const timers = typingTimers.current;
    return () => {
      sse.close();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      setTypingUsers([]);
    };
    // initialMessageId fica fora de propósito: só o booleano `active` entra como
    // dep, senão o SSE reiniciaria a cada mensagem nova. `qc` é estável.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, active]);

  return { typingUsers, connected };
}
