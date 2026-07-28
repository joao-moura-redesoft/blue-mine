import { useState, useCallback, useEffect } from 'react';

const PERM_ASKED_KEY = 'rk_notif_asked';

/** Options for a browser notification. */
interface NotifyOptions {
  body: string;
  tag?: string;
}

/**
 * Centralizes browser-notification permission and dispatch.
 *
 * - Requests permission once (persists the "already asked" flag in localStorage).
 * - `notify()` prefers showing via the SW registration so the SW's
 *   `notificationclick` handler can focus/open the PWA window; falls back to
 *   the direct Notification API (plain tab) with `window.focus()`.
 * - Exposes `permission` as reactive state so the UI can reflect current state.
 */
export function useBrowserNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    'Notification' in window ? Notification.permission : 'denied',
  );

  // Mantém o estado sincronizado com o valor real do browser (muda se o usuário
  // altera as permissões nas configurações do navegador enquanto o app está aberto).
  useEffect(() => {
    if (!('Notification' in window)) return;
    setPermission(Notification.permission);
  }, []);

  // Deve ser chamado SOMENTE a partir de um clique do usuário — navegadores modernos
  // bloqueiam Notification.requestPermission() sem gesto explícito.
  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') {
      setPermission(Notification.permission);
      return;
    }
    localStorage.setItem(PERM_ASKED_KEY, '1');
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  /**
   * Shows a native notification.
   * Uses `ServiceWorkerRegistration.showNotification` when a SW is active so
   * the SW's `notificationclick` handler runs (focus/reopen the PWA window).
   * Falls back to `new Notification()` + `window.focus()` in onclick.
   */
  const notify = useCallback((title: string, { body, tag }: NotifyOptions): void => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const options: NotificationOptions = {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag,
    };

    // Notificação direta (aba comum): sem notificationclick do SW, mas SEMPRE aparece.
    const direct = () => {
      try {
        const n = new Notification(title, options);
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // Notification() pode lançar em alguns contextos (ex.: exige SW). Ignora.
      }
    };

    // Preferimos o SW (habilita notificationclick p/ focar/reabrir a janela). PORÉM
    // navigator.serviceWorker.ready NUNCA rejeita — se nenhum SW ativa (ex.: o dev-sw
    // do Vite que falha ao avaliar, ou o SW ainda instalando), a promise fica PENDENTE
    // para sempre e a notificação jamais apareceria (o .catch tampouco dispara). Por isso
    // corremos contra um timeout curto e caímos na API direta se o SW não ficar pronto.
    if ('serviceWorker' in navigator) {
      let done = false;
      const settle = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => settle(direct), 800);
      navigator.serviceWorker.ready
        .then((reg) => settle(() => void reg.showNotification(title, options)))
        .catch(() => settle(direct));
      return;
    }

    direct();
  }, []);

  return { permission, requestPermission, notify };
}
