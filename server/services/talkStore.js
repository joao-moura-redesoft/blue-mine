const axios = require('axios');
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');
const { safeAgents } = require('../lib/ssrfGuard');

const TALK_FILE = dataFile('talk.json');
let talkStore = readJsonSecure(TALK_FILE, {}); // { [userId]: { url, user, token } }
// requireEncryption: guarda credenciais/token do Nextcloud — nunca em texto puro.
const saveTalkStore = () => writeJsonSecure(TALK_FILE, talkStore, { requireEncryption: true });

function getTalkAuth(userId) {
  return talkStore[userId] || null;
}

function saveTalkAuth(userId, auth) {
  talkStore[userId] = auth;
  saveTalkStore();
}

function clearTalkAuth(userId) {
  delete talkStore[userId];
  saveTalkStore();
}

// Cliente axios pro Talk em nome de um usuário (headless, sem `req`) — reaproveitado
// por todas as funções abaixo e pelo motor de automações (workflowEngine.js).
function talkClientFor(userId) {
  const auth = getTalkAuth(userId);
  if (!(auth?.url && auth?.user && auth?.token)) return null;
  return axios.create({
    baseURL: auth.url,
    auth: { username: auth.user, password: auth.token },
    headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
    ...safeAgents(),
  });
}

// Envia uma mensagem numa sala do Talk em nome do usuário (headless, sem `req`).
// Reaproveita as credenciais do cofre (getTalkAuth) e o mesmo endpoint do chat do
// Nextcloud Talk (spreed). No-op silencioso se o usuário não tem Talk configurado.
async function sendTalkMessage(userId, roomToken, text) {
  const client = talkClientFor(userId);
  if (!client) {
    console.warn('[talk] sendTalkMessage: sem credenciais para uid', userId);
    return false;
  }
  if (!roomToken || !text) return false;
  await client.post(
    `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(roomToken)}?format=json`,
    { message: String(text) },
  );
  return true;
}

// Abre (ou reaproveita, se já existir) a conversa 1:1 com ncUid, em nome de userId.
// Usado pela ação talk.notify_person do motor de automações — a mesma restrição de
// grupo/visibilidade do Nextcloud que vale pro app também vale aqui (ver
// [[talk-redmine-name-match]]): pode devolver null mesmo com ncUid válido.
async function createDMAs(userId, ncUid) {
  const client = talkClientFor(userId);
  if (!client || !ncUid) return null;
  const { data } = await client.post('/ocs/v2.php/apps/spreed/api/v4/room?format=json', {
    roomType: 1,
    invite: ncUid,
  });
  return data?.ocs?.data?.token || null;
}

// Token da sala "Nota para si mesmo" (roomType 6, criada automaticamente pelo Nextcloud
// pra todo usuário do Talk). Usado quando talk.notify_person miraria o próprio dono do
// workflow — abrir uma DM consigo mesmo não faz sentido, então a mensagem vai pra lá.
async function selfNoteRoomToken(userId) {
  const client = talkClientFor(userId);
  if (!client) return null;
  const { data } = await client.get('/ocs/v2.php/apps/spreed/api/v4/room?format=json');
  const rooms = data?.ocs?.data || [];
  return rooms.find((r) => r.type === 6)?.token || null;
}

// Altera o status do usuário no Nextcloud (User Status API — a mesma exibida no
// Talk). Reaproveita as credenciais do cofre. `statusType`: online|away|dnd|
// invisible|offline. Opcionalmente define uma mensagem personalizada. No-op
// silencioso se o usuário não tem Talk/Nextcloud configurado.
async function setUserStatus(userId, { statusType = 'dnd', message = '', clearAt = null } = {}) {
  const client = talkClientFor(userId);
  if (!client) {
    console.warn('[talk] setUserStatus: sem credenciais para uid', userId);
    return false;
  }
  const base = '/ocs/v2.php/apps/user_status/api/v1/user_status';
  await client.put(`${base}/status?format=json`, { statusType });
  if (message) {
    await client.put(`${base}/message/custom?format=json`, { message: String(message), clearAt });
  }
  return true;
}

module.exports = {
  getTalkAuth,
  saveTalkAuth,
  clearTalkAuth,
  talkClientFor,
  sendTalkMessage,
  createDMAs,
  selfNoteRoomToken,
  setUserStatus,
};
