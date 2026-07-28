/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// Ativa o novo SW imediatamente sem esperar fechar todas as abas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Inject the Vite+Workbox precache manifest (replaced at build time).
// Em `vite dev` o __WB_MANIFEST NÃO é substituído e vem `undefined`;
// precacheAndRoute(undefined) LANÇA na avaliação do SW ("ServiceWorker script
// evaluation failed"), o SW novo não instala, e o SW antigo fica preso servindo
// cache velho (tela antiga no start + autoUpdate nunca recarrega). O `?? []` deixa
// o SW avaliar limpo no dev (sem precache) e não muda nada no build de produção.
const manifest = self.__WB_MANIFEST ?? [];
precacheAndRoute(manifest);

// SPA fallback: serve index.html for all navigations except /api/. Só faz
// sentido com um precache de verdade (produção/hospedagem estática) — em dev o
// próprio servidor do Vite já resolve qualquer rota para index.html sozinho, e
// `createHandlerBoundToURL` EXIGE a URL precacheada (lança "non-precached-url"
// e derruba a avaliação do SW inteiro se chamada com o manifesto vazio). Em dev,
// não registra a rota: deixa a navegação passar direto pro Vite, sem o SW no meio.
if (manifest.length > 0) {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }),
  );
}

// ── Push (servidor → notificação com a aba fechada) ───────────────────────
// O servidor empurra eventos de push enquanto o app está fechado. Se houver
// QUALQUER janela do app aberta (mesmo minimizada), o próprio app já notifica
// via seu polling em segundo plano — então aqui só exibimos quando não há
// nenhuma janela, evitando notificações duplicadas.
interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  issueId?: number;
  talkToken?: string;
  // Notificações que devem aparecer MESMO com o app aberto (ex.: lembretes
  // agendados — não têm polling em primeiro plano que as exiba de outra forma).
  alwaysShow?: boolean;
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload;
  try {
    payload = event.data?.json() as PushPayload;
  } catch {
    return;
  }
  if (!payload?.title) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // App aberto (aberto ou minimizado) → deixa o app cuidar; não duplica.
      // Exceção: alwaysShow (lembretes) — não há polling em 1º plano que os exiba.
      if (clientList.length > 0 && !payload.alwaysShow) return;
      return self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: payload.tag,
        data: { url: payload.url ?? '/', issueId: payload.issueId, talkToken: payload.talkToken },
      });
    }),
  );
});

// ── Notification click ────────────────────────────────────────────────────
// Fires when the user clicks a notification shown via
// ServiceWorkerRegistration.showNotification() (used by useBrowserNotifications).
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = event.notification.data as
    | { url?: string; issueId?: number; talkToken?: string }
    | undefined;
  const target = data?.url || '/';
  const issueId = data?.issueId;
  const talkToken = data?.talkToken;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const live = clientList.find((c) => 'focus' in c) as WindowClient | undefined;
      if (live) {
        if (issueId) live.postMessage({ type: 'open-issue', issueId });
        if (talkToken) live.postMessage({ type: 'open-talk', talkToken });
        return live.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
