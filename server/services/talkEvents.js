// Barramento "o Talk mudou", do polling do servidor para a janela aberta.
// Mesmo padrão do services/issueEvents.js, mas para mensagens do Talk: o
// pollTalkGroup (services/push.js) já varre as salas a cada 3-12s para
// notificar a telinha do K86 e o Web Push — sem isto, a aba aberta só
// descobria a mesma mensagem no PRÓPRIO poll (15s da lista de salas, ou 30s de
// fallback do chat aberto), chegando visivelmente depois do teclado.
//
// Empurramos INVALIDAÇÃO, não dados: o cliente rebusca pelas rotas dele, que
// continuam sendo a fonte da verdade.
//
// Chave por uid do Redmine (mesma identidade usada por talkStore.getTalkAuth),
// não por url+user do Talk: é o que o cliente tem disponível ao abrir o stream.

const listeners = new Map(); // uid -> Set<fn>

function subscribe(uid, fn) {
  let set = listeners.get(uid);
  if (!set) {
    set = new Set();
    listeners.set(uid, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(uid);
  };
}

function emit(uid, payload) {
  const set = listeners.get(uid);
  if (!set) return 0;
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch {
      /* ouvinte quebrado não derruba os outros nem o tick do polling */
    }
  }
  return set.size;
}

module.exports = { subscribe, emit, _listeners: listeners };
