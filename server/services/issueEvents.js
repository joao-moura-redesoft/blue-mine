// Barramento "as issues mudaram", do polling do servidor para a janela aberta.
//
// Motivação: o servidor JÁ varre o Redmine a cada 60s para o Web Push
// (services/push.js, collectPushState) e o cliente varria de novo, por conta
// própria, a cada 60-90s via React Query — o mesmo trabalho, duas vezes, com o
// mesmo algoritmo de diff.
//
// Aqui empurramos INVALIDAÇÃO, não dados. É de propósito: a varredura do push
// usa `status_id: 'open'`, enquanto o /api/issues do quadro usa `status_id: '*'`
// com `include: children` — mandar o snapshot do push apagaria as colunas
// fechadas do Kanban. Avisando "mudou", o cliente rebusca pelas rotas dele, que
// continuam sendo a fonte da verdade e mantêm os filtros corretos.
//
// Chave por (url do Redmine + id do usuário): num app local é sempre uma só,
// mas assim um servidor com mais de uma sessão não vaza evento entre contas.

const listeners = new Map(); // key -> Set<fn>

function subscribe(key, fn) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

function emit(key, payload) {
  const set = listeners.get(key);
  if (!set) return 0;
  for (const fn of [...set]) {
    // Um ouvinte quebrado (socket morrendo no meio do write) não pode derrubar
    // os outros nem o tick do polling.
    try {
      fn(payload);
    } catch {
      /* ignora */
    }
  }
  return set.size;
}

/** Há alguém com a janela aberta ouvindo esta conta? */
function hasListeners(key) {
  return (listeners.get(key)?.size ?? 0) > 0;
}

const makeKey = (url, userId) => `${url}|${userId}`;

module.exports = { subscribe, emit, hasListeners, makeKey, _listeners: listeners };
