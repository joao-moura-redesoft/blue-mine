// Agendador de mensagens e lembretes do Talk.
//
// Guarda itens agendados por usuário (uid do Redmine) num jsonStore cifrado — cada
// item dispara num horário futuro (fireAt):
//   - type 'talk-message': envia uma mensagem na sala usando o token do Talk do
//     usuário (do cofre), MESMO com a aba fechada (o .exe/servidor fica de pé).
//   - type 'reminder': entrega uma notificação Web Push aos dispositivos do usuário.
//
// O tick é chamado pelo mesmo loop de polling do push (ver push.startPushPolling),
// recebendo (subscriptions, sendPush) — evita dependência circular com push.js.
const axios = require('axios');
const crypto = require('crypto');
const { createJsonStore } = require('../lib/jsonStore');
const { getTalkAuth } = require('./talkStore');
const { safeAgents } = require('../lib/ssrfGuard');

// requireEncryption: os itens guardam texto de mensagens privadas do Talk.
const store = createJsonStore('scheduled.json', { fallback: [], encrypted: true });

function persist() {
  try {
    store.save();
  } catch (e) {
    console.error('[scheduler] falha ao persistir:', e.message);
  }
}

// Cliente Talk montado a partir do cofre (sem req) — para disparo em background.
function talkClientForUid(uid) {
  const auth = getTalkAuth(uid);
  if (!auth?.url || !auth?.user || !auth?.token) return null;
  return axios.create({
    baseURL: auth.url,
    auth: { username: auth.user, password: auth.token },
    headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
    ...safeAgents(),
  });
}

// ── API pública (usada pelas rotas) ─────────────────────────────────────────

function list(uid) {
  return store.data
    .filter((it) => it.uid === uid && it.status === 'pending')
    .sort((a, b) => a.fireAt - b.fireAt);
}

function create({ uid, type, roomToken, roomName, text, fireAt }) {
  if (!uid) throw Object.assign(new Error('não autenticado'), { statusCode: 401 });
  if (!['talk-message', 'reminder'].includes(type))
    throw Object.assign(new Error('type inválido'), { statusCode: 400 });
  if (!roomToken || !text || !fireAt)
    throw Object.assign(new Error('roomToken, text e fireAt são obrigatórios'), { statusCode: 400 });
  const when = Number(fireAt);
  if (!Number.isFinite(when) || when < Date.now() - 60_000)
    throw Object.assign(new Error('fireAt deve ser um horário futuro'), { statusCode: 400 });

  const item = {
    id: crypto.randomUUID(),
    uid,
    type,
    roomToken,
    roomName: roomName || '',
    text: String(text).slice(0, 4000),
    fireAt: when,
    status: 'pending',
    createdAt: Date.now(),
  };
  store.data.push(item);
  persist();
  return item;
}

function cancel(uid, id) {
  const item = store.data.find((it) => it.id === id && it.uid === uid);
  if (!item) return false;
  store.data = store.data.filter((it) => it.id !== id);
  persist();
  return true;
}

// ── Disparo ──────────────────────────────────────────────────────────────────

async function fire(item, subscriptions, sendPush) {
  if (item.type === 'talk-message') {
    const client = talkClientForUid(item.uid);
    if (!client) throw new Error('conta do Talk não vinculada');
    await client.post(
      `/ocs/v2.php/apps/spreed/api/v1/chat/${item.roomToken}?format=json`,
      { message: item.text },
    );
    return;
  }
  // reminder → Web Push para todos os dispositivos do usuário
  const recs = (subscriptions || []).filter((s) => s.uid === item.uid);
  const payload = {
    title: '⏰ Lembrete',
    body: item.roomName ? `${item.text}\n— ${item.roomName}` : item.text,
    tag: `talk-reminder-${item.id}`,
    url: `/?talkRoom=${item.roomToken}`,
    talkToken: item.roomToken,
  };
  if (recs.length === 0) {
    // Sem dispositivo inscrito: nada a entregar agora. Não relança para não repetir.
    console.warn('[scheduler] lembrete sem inscrição de push para uid', item.uid);
    return;
  }
  for (const rec of recs) await sendPush(rec, payload);
}

let running = false;
async function tick(subscriptions, sendPush) {
  if (running) return;
  const now = Date.now();
  const due = store.data.filter((it) => it.status === 'pending' && it.fireAt <= now);
  if (due.length === 0) return;
  running = true;
  try {
    let changed = false;
    for (const item of due) {
      try {
        await fire(item, subscriptions, sendPush);
        changed = true;
        // Sucesso: remove da lista (histórico não é necessário aqui).
        store.data = store.data.filter((it) => it.id !== item.id);
      } catch (e) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastError = e.message;
        changed = true;
        // Desiste após 5 tentativas para não repetir para sempre.
        if (item.attempts >= 5) {
          item.status = 'failed';
          console.error('[scheduler] item falhou definitivamente:', item.id, e.message);
        } else {
          // Reagenda para +2min (nova chance no próximo tick após a espera).
          item.fireAt = now + 2 * 60_000;
        }
      }
    }
    if (changed) persist();
  } finally {
    running = false;
  }
}

module.exports = { list, create, cancel, tick };
