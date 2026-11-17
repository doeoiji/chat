const crypto = require('node:crypto');

function createCallsService({ hub, storage }) {
  // callId -> { id, caller, callee, mode: 'audio'|'video', chatId, status: 'ringing'|'active'|'ended', createdAt, timeoutId }
  const calls = new Map();
  // username -> callId
  const activeCallByUser = new Map();

  function getIceServers() {
    const servers = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ];
    if (process.env.TURN_URL) {
      const turn = { urls: process.env.TURN_URL };
      if (process.env.TURN_USERNAME) turn.username = process.env.TURN_USERNAME;
      if (process.env.TURN_CREDENTIAL) turn.credential = process.env.TURN_CREDENTIAL;
      servers.push(turn);
    }
    return servers;
  }

  function cleanupCall(callId) {
    const call = calls.get(callId);
    if (!call) return;
    if (call.timeoutId) clearTimeout(call.timeoutId);
    calls.delete(callId);
    if (activeCallByUser.get(call.caller) === callId) activeCallByUser.delete(call.caller);
    if (activeCallByUser.get(call.callee) === callId) activeCallByUser.delete(call.callee);
  }

  function sanitizeCall(call) {
    return {
      id: call.id,
      caller: call.caller,
      callee: call.callee,
      mode: call.mode,
      chatId: call.chatId,
      status: call.status,
      createdAt: call.createdAt
    };
  }

  async function startCall({ callerUsername, targetUsername, mode = 'audio', chatId = null }) {
    const callee = String(targetUsername || '').trim().toLowerCase();
    if (!callee || callee === callerUsername) {
      const err = new Error('Invalid call recipient.');
      err.statusCode = 400;
      throw err;
    }
    const targetRaw = await storage.getUserByUsername(callee);
    if (!targetRaw) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }

    if (activeCallByUser.has(callerUsername)) {
      const prevId = activeCallByUser.get(callerUsername);
      cleanupCall(prevId);
    }
    if (activeCallByUser.has(callee)) {
      const err = new Error(`@${callee} is currently in another call.`);
      err.statusCode = 409;
      throw err;
    }

    const callerRaw = await storage.getUserByUsername(callerUsername);
    const callerPublic = storage.toPublicUser(callerRaw);
    const calleePublic = storage.toPublicUser(targetRaw);

    const callId = `call_${crypto.randomBytes(6).toString('hex')}`;
    const cleanMode = mode === 'video' ? 'video' : 'audio';
    const dmChatId = chatId || storage.getDmChatId(callerUsername, callee);

    const call = {
      id: callId,
      caller: callerUsername,
      callee,
      mode: cleanMode,
      chatId: dmChatId,
      status: 'ringing',
      createdAt: new Date().toISOString(),
      timeoutId: null
    };

    call.timeoutId = setTimeout(() => {
      const c = calls.get(callId);
      if (!c || c.status !== 'ringing') return;
      c.status = 'ended';
      hub.emitToUsers([c.caller, c.callee], 'call_ended', {
        callId,
        reason: 'missed',
        endedBy: 'system'
      });
      cleanupCall(callId);
    }, 45000);
    if (typeof call.timeoutId.unref === 'function') call.timeoutId.unref();

    calls.set(callId, call);
    activeCallByUser.set(callerUsername, callId);
    activeCallByUser.set(callee, callId);

    hub.emitToUser(callee, 'call_incoming', {
      call: sanitizeCall(call),
      callerProfile: callerPublic
    });

    return {
      call: sanitizeCall(call),
      calleeProfile: calleePublic,
      iceServers: getIceServers()
    };
  }

  function getCallAndPeer(callId, actorUsername) {
    const call = calls.get(callId);
    if (!call || (call.caller !== actorUsername && call.callee !== actorUsername)) {
      const err = new Error('Call not found or already ended.');
      err.statusCode = 404;
      throw err;
    }
    const peer = call.caller === actorUsername ? call.callee : call.caller;
    return { call, peer };
  }

  function acceptCall(callId, actorUsername) {
    const { call, peer } = getCallAndPeer(callId, actorUsername);
    if (call.callee !== actorUsername) {
      const err = new Error('Only the callee can accept.');
      err.statusCode = 403;
      throw err;
    }
    if (call.timeoutId) {
      clearTimeout(call.timeoutId);
      call.timeoutId = null;
    }
    call.status = 'active';
    hub.emitToUser(peer, 'call_accepted', {
      callId,
      by: actorUsername
    });
    return { call: sanitizeCall(call), iceServers: getIceServers() };
  }

  function relaySignal(callId, actorUsername, { type, data }) {
    const { call, peer } = getCallAndPeer(callId, actorUsername);
    if (!type || !data) {
      const err = new Error('Missing signal type or payload.');
      err.statusCode = 400;
      throw err;
    }
    hub.emitToUser(peer, 'call_signal', {
      callId: call.id,
      from: actorUsername,
      type,
      data
    });
    return { ok: true };
  }

  function declineCall(callId, actorUsername) {
    const { call, peer } = getCallAndPeer(callId, actorUsername);
    call.status = 'ended';
    hub.emitToUser(peer, 'call_declined', {
      callId,
      by: actorUsername
    });
    cleanupCall(callId);
    return { ok: true };
  }

  function endCall(callId, actorUsername, reason = 'hangup') {
    const call = calls.get(callId);
    if (!call || (call.caller !== actorUsername && call.callee !== actorUsername)) {
      return { ok: true };
    }
    const peer = call.caller === actorUsername ? call.callee : call.caller;
    call.status = 'ended';
    hub.emitToUser(peer, 'call_ended', {
      callId,
      endedBy: actorUsername,
      reason
    });
    cleanupCall(callId);
    return { ok: true };
  }

  return {
    getIceServers,
    startCall,
    acceptCall,
    relaySignal,
    declineCall,
    endCall,
    onUserDisconnect(username) {
      const cid = activeCallByUser.get(username);
      if (cid && !hub.isOnline(username)) {
        endCall(cid, username, 'disconnected');
      }
    }
  };
}

module.exports = { createCallsService };
