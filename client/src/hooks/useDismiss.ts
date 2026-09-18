import { useEffect, type RefObject } from 'react';

/**
 * Fecha ao apertar Escape. Extraído porque ForwardDialog, AttachNoteDialog e
 * ReminderDialog (client/src/components/TalkChat.tsx) reimplementavam o mesmo
 * `useEffect` de listener em `window` cada um à sua maneira.
 */
export function useEscapeKey(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/**
 * Fecha ao clicar fora de `ref`. Extraído da mesma duplicação em
 * FullEmojiPicker, EmojiPicker e MyStatusMenu.
 */
export function useClickOutside(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, onClose]);
}
