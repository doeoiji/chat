/* VibeRoom Service Worker — ensures fresh updates & handles notification clicks */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Always pass requests straight to the network so website updates load immediately
self.addEventListener('fetch', () => {});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'open_chat', chatId: data.chatId, sender: data.sender });
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow('/');
    }
  })());
});
