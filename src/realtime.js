/**
 * Server-Sent Events (SSE) hub for real-time messaging, typing indicators,
 * read receipts, and online presence.
 */

function createRealtimeHub() {
  // Map<username, Set<ServerResponse>>
  const clients = new Map();

  function sendEvent(res, eventName, data) {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Connection closed
    }
  }

  function addClient(username, res) {
    let set = clients.get(username);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      clients.set(username, set);
    }
    set.add(res);

    // Keep-alive ping every 25s
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    return {
      wasOffline,
      remove() {
        clearInterval(heartbeat);
        const current = clients.get(username);
        if (!current) return false;
        current.delete(res);
        if (current.size === 0) {
          clients.delete(username);
          return true; // became offline
        }
        return false;
      }
    };
  }

  function isOnline(username) {
    const set = clients.get(username);
    return Boolean(set && set.size > 0);
  }

  function getOnlineUsernames() {
    return Array.from(clients.keys());
  }

  function emitToUser(username, eventName, data) {
    const set = clients.get(username);
    if (!set) return;
    for (const res of set) {
      sendEvent(res, eventName, data);
    }
  }

  function emitToUsers(usernames, eventName, data) {
    for (const u of usernames) {
      emitToUser(u, eventName, data);
    }
  }

  function broadcastAll(eventName, data) {
    for (const set of clients.values()) {
      for (const res of set) {
        sendEvent(res, eventName, data);
      }
    }
  }

  return {
    addClient,
    isOnline,
    getOnlineUsernames,
    emitToUser,
    emitToUsers,
    broadcastAll,
    sendEvent
  };
}

module.exports = { createRealtimeHub };
