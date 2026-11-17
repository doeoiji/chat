const crypto = require('node:crypto');

function createStrangerService({ hub, storage }) {
  // username -> { username, interests: string[], language: string, joinedAt }
  const queue = new Map();
  // sessionId -> { id, users: [u1, u2], aliases: { [u]: 'Ghost #123' }, interests, language, messages: [], revealConsent: {}, revealed: false, createdAt }
  const sessions = new Map();
  // username -> sessionId
  const userSession = new Map();
  // "a|b" -> expiresAtMs (prevent rematching immediately after skip/report)
  const pairCooldowns = new Map();
  // Array<{ reporter, reported, reason, at }>
  const reports = [];

  function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function setCooldown(a, b, ms) {
    pairCooldowns.set(pairKey(a, b), Date.now() + ms);
  }

  function hasCooldown(a, b) {
    const key = pairKey(a, b);
    const exp = pairCooldowns.get(key);
    if (!exp) return false;
    if (Date.now() > exp) {
      pairCooldowns.delete(key);
      return false;
    }
    return true;
  }

  function normalizeInterests(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    for (const item of list) {
      const clean = String(item || '').trim().toLowerCase().replace(/[^a-z0-9_+ -]/g, '').slice(0, 24);
      if (clean) seen.add(clean);
      if (seen.size >= 8) break;
    }
    return Array.from(seen);
  }

  function normalizeLanguage(lang) {
    const clean = String(lang || 'any').trim().toLowerCase().slice(0, 16);
    return clean || 'any';
  }

  function generateAlias(excludeAlias = '') {
    let alias = '';
    for (let i = 0; i < 6; i++) {
      alias = `Ghost #${crypto.randomInt(100, 1000)}`;
      if (alias !== excludeAlias) break;
    }
    return alias;
  }

  function serializeSessionFor(session, viewer) {
    if (!session) return null;
    const partner = session.users.find((u) => u !== viewer);
    return {
      sessionId: session.id,
      myAlias: session.aliases[viewer],
      partnerAlias: session.aliases[partner],
      language: session.language,
      sharedInterests: session.sharedInterests || [],
      revealByMe: Boolean(session.revealConsent[viewer]),
      revealByPartner: Boolean(session.revealConsent[partner]),
      revealed: Boolean(session.revealed),
      messages: (session.messages || []).map((m) => ({
        id: m.id,
        senderAlias: m.senderAlias,
        text: m.text,
        createdAt: m.createdAt,
        isMine: m.senderUsername === viewer
      })),
      createdAt: session.createdAt
    };
  }

  function getStatus(username) {
    const sid = userSession.get(username);
    if (sid && sessions.has(sid)) {
      return {
        status: 'matched',
        session: serializeSessionFor(sessions.get(sid), username),
        queueSize: queue.size
      };
    }
    const qEntry = queue.get(username);
    if (qEntry) {
      return {
        status: 'searching',
        interests: qEntry.interests,
        language: qEntry.language,
        queueSize: queue.size
      };
    }
    return {
      status: 'idle',
      queueSize: queue.size
    };
  }

  function endSessionFor(username, reason = 'ended', cooldownMs = 20000) {
    const sid = userSession.get(username);
    if (!sid) return null;
    const session = sessions.get(sid);
    sessions.delete(sid);
    if (!session) {
      userSession.delete(username);
      return null;
    }
    const partner = session.users.find((u) => u !== username);
    for (const u of session.users) {
      if (userSession.get(u) === sid) userSession.delete(u);
    }
    if (partner) {
      setCooldown(username, partner, cooldownMs);
      hub.emitToUser(partner, 'stranger_ended', {
        sessionId: sid,
        reason,
        partnerAlias: session.aliases[username]
      });
    }
    return { session, partner };
  }

  function joinQueue(username, { interests = [], language = 'any' } = {}) {
    // Clean up any stale prior state first
    endSessionFor(username, 'restarted', 5000);
    queue.delete(username);

    const cleanInterests = normalizeInterests(interests);
    const cleanLang = normalizeLanguage(language);

    let bestPartner = null;
    let bestScore = -1;
    let bestShared = [];

    for (const [candidateName, entry] of queue.entries()) {
      if (candidateName === username) continue;
      if (hasCooldown(username, candidateName)) continue;

      const langCompatible = cleanLang === 'any' || entry.language === 'any' || cleanLang === entry.language;
      if (!langCompatible) continue;

      const shared = cleanInterests.filter((t) => entry.interests.includes(t));
      const sameSpecificLang = cleanLang !== 'any' && entry.language === cleanLang ? 2 : 0;
      const score = shared.length * 10 + sameSpecificLang;
      if (score > bestScore) {
        bestScore = score;
        bestPartner = entry;
        bestShared = shared;
      }
    }

    if (bestPartner) {
      queue.delete(bestPartner.username);
      const sessionId = `str_${crypto.randomBytes(6).toString('hex')}`;
      const alias1 = generateAlias();
      const alias2 = generateAlias(alias1);
      const session = {
        id: sessionId,
        users: [username, bestPartner.username],
        aliases: {
          [username]: alias1,
          [bestPartner.username]: alias2
        },
        sharedInterests: bestShared,
        language: cleanLang !== 'any' ? cleanLang : bestPartner.language,
        messages: [],
        revealConsent: {
          [username]: false,
          [bestPartner.username]: false
        },
        revealed: false,
        createdAt: new Date().toISOString()
      };
      sessions.set(sessionId, session);
      userSession.set(username, sessionId);
      userSession.set(bestPartner.username, sessionId);

      const viewMe = serializeSessionFor(session, username);
      const viewPartner = serializeSessionFor(session, bestPartner.username);

      hub.emitToUser(username, 'stranger_matched', { session: viewMe });
      hub.emitToUser(bestPartner.username, 'stranger_matched', { session: viewPartner });

      return { status: 'matched', session: viewMe };
    }

    queue.set(username, {
      username,
      interests: cleanInterests,
      language: cleanLang,
      joinedAt: Date.now()
    });
    return {
      status: 'searching',
      interests: cleanInterests,
      language: cleanLang,
      queueSize: queue.size
    };
  }

  function cancelSearch(username) {
    queue.delete(username);
    return { status: 'idle' };
  }

  function sendMessage(username, text) {
    const sid = userSession.get(username);
    const session = sid ? sessions.get(sid) : null;
    if (!session) {
      const err = new Error('No active Stranger Lounge chat.');
      err.statusCode = 404;
      throw err;
    }
    const cleanText = String(text || '').trim().slice(0, 2000);
    if (!cleanText) {
      const err = new Error('Message text is required.');
      err.statusCode = 400;
      throw err;
    }

    const msg = {
      id: `sm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      senderAlias: session.aliases[username],
      fromSelf: false,
      text: cleanText,
      createdAt: new Date().toISOString()
    };
    session.messages.push({ ...msg, senderUsername: username });
    if (session.messages.length > 200) {
      session.messages = session.messages.slice(-200);
    }

    for (const u of session.users) {
      hub.emitToUser(u, 'stranger_message', {
        sessionId: session.id,
        message: {
          ...msg,
          isMine: u === username
        }
      });
    }
    return {
      ...msg,
      isMine: true
    };
  }

  function sendTyping(username, isTyping) {
    const sid = userSession.get(username);
    const session = sid ? sessions.get(sid) : null;
    if (!session) return;
    const partner = session.users.find((u) => u !== username);
    if (partner) {
      hub.emitToUser(partner, 'stranger_typing', {
        sessionId: session.id,
        isTyping: Boolean(isTyping)
      });
    }
  }

  function skipChat(username, { autoRequeue = false, interests = [], language = 'any' } = {}) {
    queue.delete(username);
    endSessionFor(username, 'skipped', 30000);
    if (autoRequeue) {
      return joinQueue(username, { interests, language });
    }
    return { status: 'idle' };
  }

  async function requestReveal(username) {
    const sid = userSession.get(username);
    const session = sid ? sessions.get(sid) : null;
    if (!session) {
      const err = new Error('No active Stranger Lounge chat.');
      err.statusCode = 404;
      throw err;
    }

    session.revealConsent[username] = true;
    const [u1, u2] = session.users;
    const partner = u1 === username ? u2 : u1;

    if (!session.revealConsent[partner]) {
      hub.emitToUser(partner, 'stranger_reveal_requested', {
        sessionId: session.id,
        partnerAlias: session.aliases[username]
      });
      return {
        revealed: false,
        waitingForPartner: true
      };
    }

    // Mutual consent! Reveal profiles and create real DM friendship
    session.revealed = true;
    await storage.ensureChatFolder(u1, u2);
    const chatId = storage.getDmChatId(u1, u2);
    const [raw1, raw2] = await Promise.all([
      storage.getUserByUsername(u1),
      storage.getUserByUsername(u2)
    ]);
    const pub1 = storage.toPublicUser(raw1);
    const pub2 = storage.toPublicUser(raw2);

    hub.emitToUser(u1, 'stranger_revealed', {
      sessionId: session.id,
      friend: pub2,
      dmChatId: chatId
    });
    hub.emitToUser(u2, 'stranger_revealed', {
      sessionId: session.id,
      friend: pub1,
      dmChatId: chatId
    });

    const partnerProfile = username === u1 ? pub2 : pub1;
    return {
      revealed: true,
      friend: partnerProfile,
      dmChatId: chatId
    };
  }

  function reportPartner(username, reason = 'inappropriate') {
    const ended = endSessionFor(username, 'reported', 24 * 60 * 60 * 1000);
    if (ended && ended.partner) {
      reports.push({
        reporter: username,
        reported: ended.partner,
        reason: String(reason || 'inappropriate').trim().slice(0, 160),
        at: new Date().toISOString()
      });
    }
    queue.delete(username);
    return { ok: true, status: 'idle' };
  }

  return {
    getStatus,
    joinQueue,
    cancelSearch,
    sendMessage,
    sendTyping,
    skipChat,
    requestReveal,
    reportPartner,
    onUserDisconnect(username) {
      queue.delete(username);
    }
  };
}

module.exports = { createStrangerService };
