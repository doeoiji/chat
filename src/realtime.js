/**
 * Server-Sent Events (SSE) hub for real-time messaging, typing indicators,
 * read receipts, and online presence.
 */

function createRealtimeHub() {
  // Map<username, Set<ServerResponse>>
  const clients = new Map();
  const clientOwners = new WeakMap();

  function sendEvent(res, eventName, data) {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Connection closed
    }
  }

  function addClient(username, res) {
    clientOwners.set(res, username);
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
        const owner = clientOwners.get(res) || username;
        const current = clients.get(owner);
        if (!current) return false;
        current.delete(res);
        if (current.size === 0) {
          clients.delete(owner);
          return true; // became offline
        }
        return false;
      }
    };
  }

  function renameUser(oldUsername, newUsername) {
    if (!oldUsername || !newUsername || oldUsername === newUsername) return;
    const oldSet = clients.get(oldUsername);
    if (!oldSet || oldSet.size === 0) {
      clients.delete(oldUsername);
      return;
    }
    let targetSet = clients.get(newUsername);
    if (!targetSet) {
      targetSet = new Set();
      clients.set(newUsername, targetSet);
    }
    for (const res of oldSet) {
      clientOwners.set(res, newUsername);
      targetSet.add(res);
    }
    clients.delete(oldUsername);
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
    renameUser,
    isOnline,
    getOnlineUsernames,
    emitToUser,
    emitToUsers,
    broadcastAll,
    sendEvent
  };
}

module.exports = { createRealtimeHub };
