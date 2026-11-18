/* VibeRoom Service Worker — ensures fresh updates, background Web Push & notification deep links */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Always pass requests straight to the network so website updates load immediately
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }
  if (payload.silentPush || payload.type === 'call_ended') {
    event.waitUntil((async () => {
      const existing = await self.registration.getNotifications({ tag: payload.tag });
      for (const n of existing) n.close();
    })());
    return;
  }

  const data = payload.data || {};
  const isCall = payload.type === 'call' || data.type === 'call';
  const title = payload.title || 'VibeRoom';
  const options = {
    body: payload.body || 'New message',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || 'viberoom_msg',
    renotify: true,
    requireInteraction: isCall,
    data
  };
  if (isCall) {
    options.actions = [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' }
    ];
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action || '';

  if (action === 'decline' && data.callId) {
    event.waitUntil(
      fetch(`/api/calls/${encodeURIComponent(data.callId)}/decline`, {
        method: 'POST',
        credentials: 'include'
      }).catch(() => {})
    );
    return;
  }

  const params = new URLSearchParams();
  if (data.chatId) params.set('chatId', data.chatId);
  if (data.callId) params.set('callId', data.callId);
  if (action === 'answer') params.set('callAction', 'answer');
  else if (data.type === 'call') params.set('callAction', 'open');
  const qs = params.toString();
  const targetUrl = qs ? `/?${qs}` : '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        if (data.type === 'call' || data.callId) {
          client.postMessage({
            type: 'call_action',
            callId: data.callId || '',
            chatId: data.chatId || '',
            mode: data.mode || 'audio',
            action: action === 'answer' ? 'answer' : 'open'
          });
        } else {
          client.postMessage({ type: 'open_chat', chatId: data.chatId, sender: data.sender });
        }
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
