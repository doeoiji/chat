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
    await storage.ensureChatFolder(callerUsername, callee);

    const call = {
      id: callId,
      caller: callerUsername,
      callee,
      mode: cleanMode,
      chatId: dmChatId,
      status: 'ringing',
      startedAt: null,
      historyLogged: false,
      createdAt: new Date().toISOString(),
      timeoutId: null
    };

    async function recordCallHistory(targetCall, outcome) {
      if (!targetCall || targetCall.historyLogged || !targetCall.chatId) return;
      targetCall.historyLogged = true;
      const durationSec = targetCall.startedAt
        ? Math.max(1, Math.round((Date.now() - targetCall.startedAt) / 1000))
        : 0;
      const modeLabel = targetCall.mode === 'video' ? 'Video call' : 'Audio call';
      let text = modeLabel;
      if (outcome === 'completed') {
        const mins = Math.floor(durationSec / 60);
        const secs = String(durationSec % 60).padStart(2, '0');
        text = `${modeLabel} • ${mins}:${secs}`;
      } else if (outcome === 'missed') {
        text = `Missed ${modeLabel.toLowerCase()}`;
      } else if (outcome === 'declined') {
        text = `Declined ${modeLabel.toLowerCase()}`;
      } else {
        text = `Cancelled ${modeLabel.toLowerCase()}`;
      }
      try {
        await storage.ensureChatFolder(targetCall.caller, targetCall.callee);
        const { message, meta } = await storage.appendChatMessage(targetCall.chatId, targetCall.caller, {
          text,
          kind: 'call',
          call: {
            callId: targetCall.id,
            mode: targetCall.mode,
            status: outcome,
            durationSec,
            caller: targetCall.caller,
            callee: targetCall.callee
          }
        });
        const callerRaw = await storage.getUserByUsername(targetCall.caller);
        hub.emitToUsers([targetCall.caller, targetCall.callee], 'new_message', {
          chatId: targetCall.chatId,
          message,
          meta,
          senderProfile: callerRaw ? storage.toPublicUser(callerRaw) : null
        });
      } catch {
        // Ignore history write failure on cleanup
      }
    }

    call._recordHistory = recordCallHistory;

    call.timeoutId = setTimeout(async () => {
      const c = calls.get(callId);
      if (!c || c.status !== 'ringing') return;
      c.status = 'ended';
      hub.emitToUsers([c.caller, c.callee], 'call_ended', {
        callId,
        reason: 'missed',
        endedBy: 'system'
      });
      await recordCallHistory(c, 'missed');
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
    call.startedAt = Date.now();
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

  async function declineCall(callId, actorUsername) {
    const { call, peer } = getCallAndPeer(callId, actorUsername);
    call.status = 'ended';
    hub.emitToUser(peer, 'call_declined', {
      callId,
      by: actorUsername
    });
    if (typeof call._recordHistory === 'function') {
      await call._recordHistory(call, 'declined');
    }
    cleanupCall(callId);
    return { ok: true };
  }

  async function endCall(callId, actorUsername, reason = 'hangup') {
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
    const outcome = call.startedAt
      ? 'completed'
      : (actorUsername === call.caller ? 'cancelled' : 'missed');
    if (typeof call._recordHistory === 'function') {
      await call._recordHistory(call, outcome);
    }
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
