// Mensagens fixadas por sala — LOCAL (o Nextcloud Talk não expõe API de pin).
// Guardamos uma mensagem fixada por sala, com um snapshot do texto/autor para o
// banner conseguir renderizar mesmo quando a mensagem não está na janela carregada.
// Segue o padrão das outras features locais do Talk (mute, watch). Só o próprio
// usuário vê seus pins — não são compartilhados com a conversa.

export interface PinnedMessage {
  id: number;
  text: string;
  author: string;
}

const KEY = 'talk-pinned-messages';
const EVENT = 'rk-talk-pins-changed';

function load(): Record<string, PinnedMessage> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, PinnedMessage>;
  } catch {
    return {};
  }
}

function save(map: Record<string, PinnedMessage>) {
  localStorage.setItem(KEY, JSON.stringify(map));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export const talkPins = {
  EVENT,
  get: (token: string): PinnedMessage | null => load()[token] ?? null,
  set: (token: string, pin: PinnedMessage) => {
    const map = load();
    map[token] = pin;
    save(map);
  },
  clear: (token: string) => {
    const map = load();
    if (map[token]) {
      delete map[token];
      save(map);
    }
  },
  isPinned: (token: string, id: number): boolean => load()[token]?.id === id,
};
