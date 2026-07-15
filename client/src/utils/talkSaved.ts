// Mensagens salvas (bookmarks) — LOCAL e GLOBAL entre todas as salas do Talk.
// Extensão da ideia de pin, mas em lista, sem limite de 1 por sala. Só o próprio
// usuário vê. Guarda um snapshot (texto/autor/sala) para listar sem recarregar o
// histórico. Segue o padrão de talkPins/talkMute.

export interface SavedMessage {
  roomToken: string;
  roomName: string;
  id: number;
  text: string;
  author: string;
  timestamp: number; // segundos (do Talk)
  savedAt: number; // ms (quando salvou)
}

const KEY = 'talk-saved-messages';
const EVENT = 'rk-talk-saved-changed';

function load(): SavedMessage[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(arr) ? (arr as SavedMessage[]) : [];
  } catch {
    return [];
  }
}

function save(list: SavedMessage[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export const talkSaved = {
  EVENT,
  all: (): SavedMessage[] => load().sort((a, b) => b.savedAt - a.savedAt),
  isSaved: (roomToken: string, id: number): boolean =>
    load().some((m) => m.roomToken === roomToken && m.id === id),
  // Alterna: adiciona se não existir, remove se já existir. Devolve o novo estado.
  toggle: (msg: SavedMessage): boolean => {
    const list = load();
    const idx = list.findIndex((m) => m.roomToken === msg.roomToken && m.id === msg.id);
    if (idx >= 0) {
      list.splice(idx, 1);
      save(list);
      return false;
    }
    list.push(msg);
    save(list);
    return true;
  },
  remove: (roomToken: string, id: number) => {
    save(load().filter((m) => !(m.roomToken === roomToken && m.id === id)));
  },
  // Ids salvos de uma sala específica (para marcar as bolhas).
  idsForRoom: (roomToken: string): Set<number> =>
    new Set(
      load()
        .filter((m) => m.roomToken === roomToken)
        .map((m) => m.id),
    ),
};
