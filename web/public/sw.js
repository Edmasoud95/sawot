/* Push and click handling only. Deliberately no fetch listener or app cache. */
const safeChat = id => typeof id === 'string' && /^[a-f0-9]{12}$/.test(id);
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data;
  try { data = event.data?.json(); } catch { return; }
  if (data?.type !== 'chat-complete' || !safeChat(data.conversationId)
      || typeof data.turnId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.turnId)) return;
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 80) : '';
  event.waitUntil(self.registration.showNotification(title || 'SAWOT', {
    body: 'Your response is ready.',
    tag: `sawot-chat-${data.turnId}`,
    data: { conversationId: data.conversationId },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.conversationId;
  if (!safeChat(id)) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        client.postMessage({ type: 'open-chat', conversationId: id });
        await client.focus();
        return;
      } catch { /* Try another window or open a new one. */ }
    }
    await self.clients.openWindow(`${self.location.origin}/?chat=${id}`);
  })());
});
