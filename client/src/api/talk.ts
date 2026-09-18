import axios from 'axios';

const TALK_AUTH_KEY = 'nextcloud_talk_auth';

export interface TalkAuth {
  url: string;
  user: string;
}

export function getTalkAuth(): TalkAuth | null {
  try {
    const raw = localStorage.getItem(TALK_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.url && parsed?.user) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveTalkAuth(auth: TalkAuth) {
  const previous = getTalkAuth();
  localStorage.setItem(TALK_AUTH_KEY, JSON.stringify(auth));
  // Trocou de conta? O actorId em cache é de outra pessoa e deixaria as bolhas
  // do lado errado até /talk/me responder. Ver getCachedTalkUid.
  if (previous && (previous.user !== auth.user || previous.url !== auth.url)) clearCachedTalkUid();
  resetTalkAuthBroken(); // credencial nova → rearma o disjuntor do polling
  window.dispatchEvent(new CustomEvent(TALK_AUTH_CHANGED_EVENT));
}

// ─── Identidade no Talk (actorId) ────────────────────────────────────────────
// O `actorId` das mensagens NÃO é o login: neste Nextcloud (contas via LDAP) ele
// é um UUID, ex. "81CBD76B-8020-…". É por ele que decidimos se a mensagem é
// minha (bolha à direita), então errar aqui joga TODAS as minhas mensagens para
// o lado de quem recebeu.
//
// Guardamos o id assim que ele é conhecido — por /talk/me ou pelo actorId de uma
// mensagem que acabamos de enviar (fonte irrefutável) — para que uma falha
// pontual de /talk/me não deixe a conversa inteira com o lado invertido.
const TALK_UID_KEY = 'nextcloud_talk_uid';

export function getCachedTalkUid(): string {
  try {
    return localStorage.getItem(TALK_UID_KEY) || '';
  } catch {
    return '';
  }
}

export function cacheTalkUid(id: string) {
  if (!id) return;
  try {
    if (localStorage.getItem(TALK_UID_KEY) !== id) localStorage.setItem(TALK_UID_KEY, id);
  } catch {
    /* storage indisponível — seguimos com o valor em memória da query */
  }
}

export function clearCachedTalkUid() {
  try {
    localStorage.removeItem(TALK_UID_KEY);
  } catch {
    /* nada a fazer */
  }
}

export async function clearTalkAuth() {
  localStorage.removeItem(TALK_AUTH_KEY);
  clearCachedTalkUid();
  resetTalkAuthBroken();
  window.dispatchEvent(new CustomEvent(TALK_AUTH_CHANGED_EVENT));
  try {
    await axios.delete('/api/talk/auth');
  } catch {
    /* ignorar erro */
  }
}

export interface TalkMessageParam {
  type: string;
  id?: string;
  name?: string;
  path?: string;
  mimetype?: string;
  'preview-available'?: string;
  'mention-id'?: string;
}

export interface TalkMessage {
  id: number;
  token: string;
  actorType: string;
  actorId: string;
  actorDisplayName: string;
  timestamp: number;
  message: string;
  messageParameters: Record<string, TalkMessageParam>;
  systemMessage: string;
  messageType: string;
  isReplyable: boolean;
  parent?: {
    id: number;
    actorDisplayName: string;
    message: string;
    messageParameters: Record<string, TalkMessageParam>;
    messageType: string;
  };
  reactions?: Record<string, number>;
  reactionsSelf?: string[];
  // Edição: o Talk expõe lastEditTimestamp (> 0 quando a mensagem foi editada) + autor.
  lastEditTimestamp?: number;
  lastEditActorDisplayName?: string;
  lastEditActorId?: string;
  // Campos client-only (envio otimista) — nunca vêm do servidor
  _status?: 'sending' | 'failed';
  _clientText?: string;
  _clientReplyTo?: number;
  _attachmentRemoved?: boolean;
}

export interface TalkParticipant {
  actorId: string;
  actorType: string;
  displayName: string;
  participantType: number;
  attendeeId?: number;
  lastReadMessage?: number;
}

export interface TalkRoom {
  id: number;
  token: string;
  type: number; // 1=DM 2=group 3=public 4=changelog 6=self
  name: string;
  displayName: string;
  unreadMessages: number;
  unreadMention: boolean;
  lastMessage?: TalkMessage;
  lastActivity: number;
  participantType: number;
}

export interface NCUser {
  id: string;
  label: string;
  source: string;
}

// Sem timeout, uma conexão travada (wifi/VPN instável) nunca rejeita — a query
// fica presa em "carregando" para sempre, sem erro, sem acionar o disjuntor
// nem o retry do React Query. Era um dos motivos da tela de conversas ficar em
// branco sem feedback depois de reconectar numa rede ruim.
const api = axios.create({ baseURL: '/api/talk', timeout: 20_000 });

// Disparado quando o servidor responde 401 a uma chamada do Talk. 403 é "sem
// permissão" (conta não-admin, esperado) e NÃO conta. Quem ouve isso (TalkChat)
// mostra o aviso de reconexão.
export const TALK_AUTH_EXPIRED_EVENT = 'rk-talk-auth-expired';

// Disparado quando a conta do Talk é (re)vinculada ou removida. Sem isto, o
// TalkChat continua com as queries desabilitadas e o aviso na tela mesmo depois
// de reconectar — só voltava recarregando a página.
export const TALK_AUTH_CHANGED_EVENT = 'rk-talk-auth-changed';

/**
 * Causa do último 401 do Talk, na palavra do servidor.
 *
 * O mesmo 401 sai em situações bem diferentes — token revogado, sessão do
 * Redmine expirada, conta nunca vinculada — e o servidor já as distingue em
 * `makeTalk`. Repassar o texto evita o diagnóstico genérico "o token foi
 * revogado", que costumava estar errado.
 */
export type TalkAuthFailure = { reason: string; redmineSession: boolean };

let lastAuthFailure: TalkAuthFailure = { reason: '', redmineSession: false };

export function getTalkAuthFailure(): TalkAuthFailure {
  return lastAuthFailure;
}

/**
 * Disjuntor do polling do Talk.
 *
 * `talkEnabled()` só verifica se EXISTE credencial salva, não se ela funciona.
 * Com senha de app revogada (ou troca de senha do AD), a lista de salas seguia
 * sendo pedida a cada 15s, em segundo plano, indefinidamente — o log da máquina
 * acumulou ~1300 respostas 401 nesse endpoint em 25 dias, todas com o mesmo
 * resultado.
 *
 * A recuperação é automática, e é por isso que isto é um disjuntor e não um
 * "desliga o Talk": qualquer resposta bem-sucedida rearma. Como o polling para
 * mas as queries continuam habilitadas, o refetch de foco de janela do TanStack
 * ainda tenta — então um 401 passageiro se cura sozinho ao voltar para a aba,
 * sem exigir religar a conta.
 */
let authBroken = false;
const authBrokenListeners = new Set<() => void>();

function setAuthBroken(v: boolean) {
  if (authBroken === v) return;
  authBroken = v;
  authBrokenListeners.forEach((l) => l());
}

export function isTalkAuthBroken() {
  return authBroken;
}

export function subscribeTalkAuthBroken(l: () => void) {
  authBrokenListeners.add(l);
  return () => {
    authBrokenListeners.delete(l);
  };
}

/** Rearma o disjuntor — chamado ao (re)vincular ou remover a conta. */
export function resetTalkAuthBroken() {
  setAuthBroken(false);
}

/**
 * Aciona o disjuntor a partir de uma fonte que NÃO passa pelo interceptor do
 * axios acima — o EventSource do SSE (`useTalkSSE`) e os `fetch()` avulsos do
 * indicador de digitação (`useTypingSender`). Sem isto, um 401 detectado só
 * por esses dois caminhos nunca disparava o aviso de reconexão nem pausava o
 * polling: só a lista de salas (que usa o client `api` acima) alimentava o
 * disjuntor.
 */
export function markTalkAuthBroken(reason = '') {
  lastAuthFailure = { reason, redmineSession: /redmine|não autenticado/i.test(reason) };
  setAuthBroken(true);
  window.dispatchEvent(new CustomEvent(TALK_AUTH_EXPIRED_EVENT));
}

api.interceptors.response.use(
  (r) => {
    setAuthBroken(false); // deu certo → rearma
    return r;
  },
  (err) => {
    if (err?.response?.status === 401 && getTalkAuth()) {
      const reason = String(err.response?.data?.error || '');
      lastAuthFailure = {
        reason,
        // A sessão do Redmine caiu: reconectar o Talk não resolve nada, o
        // usuário precisa entrar no app de novo.
        redmineSession: /redmine|não autenticado/i.test(reason),
      };
      setAuthBroken(true);
      window.dispatchEvent(new CustomEvent(TALK_AUTH_EXPIRED_EVENT));
    }
    return Promise.reject(err);
  },
);

export async function fetchRooms(): Promise<TalkRoom[]> {
  const { data } = await api.get<TalkRoom[]>('/rooms');
  // O OCS do Talk normalmente devolve um array, mas em alguns estados (erro OCS,
  // vazio, resposta transitória) vem objeto/null. Sem essa coerção, o `rooms.reduce`
  // no TalkChat quebra a app inteira (tela branca), pois o `= []` do useQuery só cobre
  // `undefined`.
  return Array.isArray(data) ? data : [];
}

export async function fetchMessages(
  token: string,
  params?: { lastKnownMessageId?: number },
): Promise<TalkMessage[]> {
  const { data } = await api.get<TalkMessage[]>(`/rooms/${token}/messages`, { params });
  return data;
}

export async function sendMessage(
  token: string,
  message: string,
  replyTo?: number,
): Promise<TalkMessage> {
  const body: Record<string, unknown> = { message };
  if (replyTo) body.replyTo = replyTo;
  const { data } = await api.post<TalkMessage>(`/rooms/${token}/messages`, body);
  return data;
}

export async function editMessage(
  token: string,
  messageId: number,
  message: string,
): Promise<TalkMessage> {
  const { data } = await api.put<TalkMessage>(`/rooms/${token}/messages/${messageId}`, { message });
  return data;
}

export async function deleteMessage(token: string, messageId: number): Promise<void> {
  await api.delete(`/rooms/${token}/messages/${messageId}`);
}

// Mensagens de arquivo/imagem chegam como systemMessage e não podem ser excluídas via
// deleteMessage (Talk responde 405) — isso remove o arquivo real no Nextcloud.
export async function deleteMessageAttachment(
  token: string,
  messageId: number,
  path: string,
): Promise<void> {
  await api.delete(`/rooms/${token}/messages/${messageId}/attachment`, { params: { path } });
}

export async function fetchParticipants(token: string): Promise<TalkParticipant[]> {
  const { data } = await api.get<TalkParticipant[]>(`/rooms/${token}/participants`);
  return data;
}

export async function fetchTalkMe(): Promise<{ id: string; displayName: string }> {
  const { data } = await api.get('/me');
  return data;
}

export interface TalkUserProfile {
  id: string;
  displayName: string;
  email: string;
  organisation: string;
  role: string;
  phone: string;
}

export async function fetchTalkUser(userId: string): Promise<TalkUserProfile> {
  const { data } = await api.get<TalkUserProfile>(`/users/${encodeURIComponent(userId)}`);
  return data;
}

export async function markMessagesRead(token: string, lastReadMessage: number): Promise<void> {
  await api.post(`/rooms/${token}/read`, { lastReadMessage });
}

export async function sendTyping(token: string, typing: boolean): Promise<void> {
  await api.post(`/rooms/${token}/typing`, { typing });
}

/** Quem reagiu com cada emoji: { "👍": [{ actorDisplayName, … }] } */
export async function fetchReactions(
  token: string,
  messageId: number,
): Promise<Record<string, { actorId: string; actorDisplayName: string }[]>> {
  const { data } = await api.get(`/rooms/${token}/messages/${messageId}/reactions`);
  return data ?? {};
}

export async function addReaction(
  token: string,
  messageId: number,
  reaction: string,
): Promise<void> {
  await api.post(`/rooms/${token}/messages/${messageId}/reactions`, { reaction });
}

export async function removeReaction(
  token: string,
  messageId: number,
  reaction: string,
): Promise<void> {
  await api.delete(`/rooms/${token}/messages/${messageId}/reactions`, { params: { reaction } });
}

export async function createRoom(
  roomType: number,
  invite: string,
  roomName?: string,
): Promise<TalkRoom> {
  const body: Record<string, unknown> = { roomType, invite };
  if (roomName) body.roomName = roomName;
  const { data } = await api.post<TalkRoom>('/rooms', body);
  return data;
}

// ─── Presença / User Status ─────────────────────────────────────────────────

export type UserStatusType = 'online' | 'away' | 'dnd' | 'invisible' | 'offline';
export interface UserStatus {
  userId: string;
  status: UserStatusType;
  icon?: string | null;
  message?: string | null;
  clearAt?: number | null;
}

export async function fetchUserStatuses(): Promise<UserStatus[]> {
  const { data } = await api.get<UserStatus[]>('/user-statuses');
  return data;
}

export async function fetchMyStatus(): Promise<UserStatus | null> {
  const { data } = await api.get<UserStatus | null>('/my-status');
  return data;
}

export async function setMyStatusType(statusType: UserStatusType): Promise<void> {
  await api.put('/my-status', { statusType });
}

export async function setMyStatusMessage(
  message: string,
  statusIcon?: string | null,
  clearAt?: number | null,
): Promise<void> {
  await api.put('/my-status/message', { message, statusIcon, clearAt });
}

export async function clearMyStatusMessage(): Promise<void> {
  await api.delete('/my-status/message');
}

// Compartilhamentos agrupados por tipo (cada item tem o mesmo formato de mensagem)
export type TalkShareOverview = Partial<
  Record<'media' | 'file' | 'voice' | 'audio' | 'location' | 'deckcard' | 'other', TalkMessage[]>
>;

export async function fetchRoomShares(token: string): Promise<TalkShareOverview> {
  const { data } = await api.get<TalkShareOverview>(`/rooms/${token}/shares`);
  return data;
}

export async function fetchRoomSharesByType(
  token: string,
  objectType: string,
): Promise<TalkMessage[]> {
  const { data } = await api.get<TalkMessage[]>(`/rooms/${token}/shares/${objectType}`);
  return data;
}

export interface TalkSearchResult {
  id: number;
  actorDisplayName: string;
  message: string;
  timestamp: number;
}

export async function searchMessages(token: string, term: string): Promise<TalkSearchResult[]> {
  const { data } = await api.get<TalkSearchResult[]>(`/rooms/${token}/search`, {
    params: { term },
  });
  return data;
}

// ─── Gestão de grupos ──────────────────────────────────────────────────────────

export async function renameRoom(token: string, roomName: string): Promise<void> {
  await api.put(`/rooms/${token}`, { roomName });
}

export async function setRoomDescription(token: string, description: string): Promise<void> {
  await api.put(`/rooms/${token}/description`, { description });
}

export async function addParticipant(
  token: string,
  userId: string,
  source = 'users',
): Promise<void> {
  await api.post(`/rooms/${token}/participants`, { newParticipant: userId, source });
}

export async function removeAttendee(token: string, attendeeId: number): Promise<void> {
  await api.delete(`/rooms/${token}/attendees`, { params: { attendeeId } });
}

export async function promoteModerator(token: string, attendeeId: number): Promise<void> {
  await api.post(`/rooms/${token}/moderators`, { attendeeId });
}

export async function demoteModerator(token: string, attendeeId: number): Promise<void> {
  await api.delete(`/rooms/${token}/moderators`, { params: { attendeeId } });
}

export async function leaveRoom(token: string): Promise<void> {
  await api.delete(`/rooms/${token}/participants/self`);
}

export async function uploadRoomAvatar(token: string, file: File): Promise<void> {
  await api.post(`/rooms/${token}/avatar`, file, {
    headers: {
      'x-filename': encodeURIComponent(file.name),
      'x-content-type': file.type || 'image/png',
      'Content-Type': file.type || 'image/png',
    },
  });
}

export async function initLoginFlow(
  ncUrl: string,
): Promise<{ loginUrl: string; pollEndpoint: string; pollToken: string }> {
  const { data } = await axios.post('/api/talk/login-flow/init', { url: ncUrl });
  return data;
}

export type LoginFlowResult = { done: false } | { done: true; server: string; user: string };

export async function pollLoginFlow(
  pollEndpoint: string,
  pollToken: string,
): Promise<LoginFlowResult> {
  const { data } = await axios.post('/api/talk/login-flow/poll', { pollEndpoint, pollToken });
  return data;
}

export async function searchNCUsers(search: string): Promise<NCUser[]> {
  const { data } = await api.get<NCUser[]>('/search/users', { params: { search } });
  return data;
}

// ─── Assimilação Redmine ↔ Talk por nome ────────────────────────────────────

export interface RedmineTalkMatch {
  ncUid?: string;
  ncName?: string;
  matchType: 'exact' | 'fuzzy' | 'ambiguous';
  candidates?: { ncUid: string; ncName: string }[];
}

export interface RedmineTalkMatchMap {
  updatedAt: number;
  byRedmineId: Record<string, RedmineTalkMatch>;
  /** Índice reverso: ncUid (usuário do Talk) → id do usuário no Redmine */
  byNcUid: Record<string, number>;
}

export async function fetchRedmineTalkMatch(forceRefresh = false): Promise<RedmineTalkMatchMap> {
  const { data } = await api.get<RedmineTalkMatchMap>('/redmine-match', {
    params: forceRefresh ? { refresh: '1' } : undefined,
  });
  return data;
}

// ─── Agendador (mensagens agendadas + lembretes) ─────────────────────────────

export interface ScheduledItem {
  id: string;
  type: 'talk-message' | 'reminder';
  roomToken: string;
  roomName: string;
  text: string;
  fireAt: number;
  status: string;
}

export async function listScheduled(): Promise<ScheduledItem[]> {
  const { data } = await axios.get('/api/scheduler/talk');
  return (data.items ?? []) as ScheduledItem[];
}

export async function createScheduled(body: {
  type: 'talk-message' | 'reminder';
  roomToken: string;
  roomName?: string;
  text: string;
  fireAt: number;
}): Promise<ScheduledItem> {
  const { data } = await axios.post('/api/scheduler/talk', body);
  return data as ScheduledItem;
}

export async function cancelScheduled(id: string): Promise<void> {
  await axios.delete(`/api/scheduler/talk/${encodeURIComponent(id)}`);
}

// ─── IA do Talk (traduzir + sugerir resposta) ────────────────────────────────

export async function translateMessage(
  text: string,
  target = 'Português (Brasil)',
): Promise<string> {
  const { data } = await axios.post('/api/ai/talk-translate', { text, target });
  return (data?.translation ?? '') as string;
}

export async function suggestReplies(
  context: string,
  tone?: string,
  draft?: string,
): Promise<string[]> {
  const { data } = await axios.post('/api/ai/talk-suggest-reply', { context, tone, draft });
  return (data?.suggestions ?? []) as string[];
}

export interface UploadResult {
  success: boolean;
  method?: string;
  error?: string;
  uploadedPath?: string;
}

// Mesmo limite do express.raw em server/routes/talk.js (POST /talk/rooms/:token/upload).
// Checar no cliente evita subir o arquivo inteiro (às vezes minutos numa rede lenta)
// só pra descobrir no fim que o servidor ia rejeitar com 413.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = '500MB';

export function uploadErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && err.response?.status === 413) {
    return `Arquivo muito grande (máx. ${MAX_UPLOAD_LABEL}).`;
  }
  return (err instanceof Error ? err.message : null) || 'Falha ao enviar arquivo.';
}

export async function uploadFileToTalk(
  token: string,
  file: File,
  caption?: string,
  onProgress?: (pct: number) => void,
  opts?: { voiceMessage?: boolean },
): Promise<UploadResult> {
  const { data } = await api.post<UploadResult>(`/rooms/${token}/upload`, file, {
    headers: {
      'x-filename': encodeURIComponent(file.name),
      'x-content-type': file.type || 'application/octet-stream',
      'Content-Type': file.type || 'application/octet-stream',
      ...(caption?.trim() ? { 'x-caption': encodeURIComponent(caption.trim()) } : {}),
      ...(opts?.voiceMessage ? { 'x-voice-message': '1' } : {}),
    },
    onUploadProgress: (e: { loaded: number; total?: number }) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data;
}

export function resolveMessageText(msg: TalkMessage): string {
  const fileParam =
    msg.messageParameters?.file ??
    Object.values(msg.messageParameters ?? {}).find((p) => p.type === 'file') ??
    null;
  if (msg.message === '{file}' || fileParam) {
    return fileParam?.name ? `📎 ${fileParam.name}` : '📎 Arquivo';
  }
  return msg.message.replace(/\{([\w-]+)\}/g, (_, key) => {
    const param = msg.messageParameters?.[key];
    return param?.name ? `@${param.name}` : key;
  });
}
