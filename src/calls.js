const crypto = require('node:crypto');

function createCallsService({ hub, storage, audit = null, pushService = null }) {
  // callId -> { id, caller, callee, mode: 'audio'|'video', chatId, status: 'ringing'|'active'|'ended', createdAt, timeoutId, messageId }
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
      messageId: call.messageId || null,
      status: call.status,
      startedAt: call.startedAt || null,
      createdAt: call.createdAt
    };
  }

  function notifyCallDismissedPush(targetUsername, callId, chatId = '') {
    if (!pushService || !targetUsername || !callId) return;
    pushService.notifyUser(targetUsername, {
      type: 'call_ended',
      silentPush: true,
      title: 'VibeRoom',
      body: '',
      data: {
        type: 'call_ended',
        callId,
        chatId: chatId || ''
      }
    }, { ignoreMute: true }).catch(() => {});
  }

  async function ensureCallChatFolder(dmChatId, userA, userB) {
    if (String(dmChatId || '').startsWith('sec_') && typeof storage.ensureSecretChatFolder === 'function') {
      return storage.ensureSecretChatFolder(userA, userB, userA);
    }
    return storage.ensureChatFolder(userA, userB);
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
    await ensureCallChatFolder(dmChatId, callerUsername, callee);

    const call = {
      id: callId,
      caller: callerUsername,
      callee,
      mode: cleanMode,
      chatId: dmChatId,
      messageId: null,
      status: 'ringing',
      startedAt: null,
      historyLogged: false,
      signalSeq: 0,
      signalsByRecipient: {
        [callerUsername]: [],
        [callee]: []
      },
      createdAt: new Date().toISOString(),
      timeoutId: null
    };

    try {
      const initText = cleanMode === 'video' ? 'Incoming video call' : 'Incoming audio call';
      const { message, meta } = await storage.appendChatMessage(dmChatId, callerUsername, {
        text: initText,
        kind: 'call',
        call: {
          callId,
          mode: cleanMode,
          status: 'ringing',
          durationSec: 0,
          caller: callerUsername,
          callee
        }
      });
      if (message) {
        call.messageId = message.id;
        for (const p of [callerUsername, callee]) {
          hub.emitToUser(p, 'new_message', {
            chatId: dmChatId,
            message: storage.sanitizeMessageForViewer ? storage.sanitizeMessageForViewer(message, p) : message,
            meta,
            senderProfile: callerPublic
          });
        }
      }
    } catch {
      // Non-fatal if initial call card fails
    }

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
        await ensureCallChatFolder(targetCall.chatId, targetCall.caller, targetCall.callee);
        let updatedOut = null;
        if (targetCall.messageId && typeof storage.updateChatCallMessage === 'function') {
          updatedOut = await storage.updateChatCallMessage(targetCall.chatId, targetCall.messageId, {
            text,
            status: outcome,
            durationSec,
            markUnreadForUsername: outcome === 'missed' ? targetCall.callee : null
          });
        }
        if (updatedOut && updatedOut.message) {
          for (const p of [targetCall.caller, targetCall.callee]) {
            hub.emitToUser(p, 'message_updated', {
              chatId: targetCall.chatId,
              message: storage.sanitizeMessageForViewer ? storage.sanitizeMessageForViewer(updatedOut.message, p) : updatedOut.message
            });
          }
        } else {
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
        }
        if (audit) {
          audit.log({
            action: `CALL_${String(outcome || 'ended').toUpperCase()}`,
            username: targetCall.caller,
            alsoUsers: [targetCall.callee],
            details: {
              callId: targetCall.id,
              chatId: targetCall.chatId,
              mode: targetCall.mode,
              durationSec,
              callee: targetCall.callee
            }
          });
        }
      } catch {
        // Ignore history write failure on cleanup
      }
      notifyCallDismissedPush(targetCall.callee, targetCall.id, targetCall.chatId);
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
    if (call.messageId && typeof storage.updateChatCallMessage === 'function') {
      const label = call.mode === 'video' ? 'Ongoing video call' : 'Ongoing audio call';
      storage.updateChatCallMessage(call.chatId, call.messageId, {
        text: label,
        status: 'active',
        durationSec: 0
      }).then((updatedOut) => {
        if (updatedOut && updatedOut.message) {
          for (const p of [call.caller, call.callee]) {
            hub.emitToUser(p, 'message_updated', {
              chatId: call.chatId,
              message: storage.sanitizeMessageForViewer ? storage.sanitizeMessageForViewer(updatedOut.message, p) : updatedOut.message
            });
          }
        }
      }).catch(() => {});
    }
    notifyCallDismissedPush(actorUsername, callId, call.chatId);
    return { call: sanitizeCall(call), iceServers: getIceServers() };
  }

  function relaySignal(callId, actorUsername, { type, data }) {
    const { call, peer } = getCallAndPeer(callId, actorUsername);
    if (!type || !data) {
      const err = new Error('Missing signal type or payload.');
      err.statusCode = 400;
      throw err;
    }
    call.signalSeq = (call.signalSeq || 0) + 1;
    const payload = {
      seq: call.signalSeq,
      callId: call.id,
      from: actorUsername,
      type,
      data
    };
    if (call.signalsByRecipient && Array.isArray(call.signalsByRecipient[peer])) {
      call.signalsByRecipient[peer].push(payload);
      if (call.signalsByRecipient[peer].length > 150) {
        call.signalsByRecipient[peer].shift();
      }
    }
    hub.emitToUser(peer, 'call_signal', payload);
    return { ok: true, seq: payload.seq };
  }

  function getBufferedSignals(callId, actorUsername, sinceSeq = 0) {
    const { call } = getCallAndPeer(callId, actorUsername);
    const list = (call.signalsByRecipient && call.signalsByRecipient[actorUsername]) || [];
    const minSeq = Number(sinceSeq) || 0;
    return list.filter((item) => item.seq > minSeq);
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

  async function getActiveCallForUser(username) {
    const cid = activeCallByUser.get(username);
    if (!cid) return null;
    const call = calls.get(cid);
    if (!call || call.status === 'ended') return null;
    const callerRaw = await storage.getUserByUsername(call.caller).catch(() => null);
    const calleeRaw = await storage.getUserByUsername(call.callee).catch(() => null);
    return {
      call: sanitizeCall(call),
      callerProfile: callerRaw ? storage.toPublicUser(callerRaw) : { username: call.caller, displayName: call.caller },
      calleeProfile: calleeRaw ? storage.toPublicUser(calleeRaw) : { username: call.callee, displayName: call.callee },
      iceServers: getIceServers()
    };
  }

  return {
    getIceServers,
    startCall,
    acceptCall,
    relaySignal,
    getBufferedSignals,
    declineCall,
    endCall,
    getActiveCallForUser,
    onUserDisconnect(username) {
      const cid = activeCallByUser.get(username);
      if (cid && !hub.isOnline(username)) {
        endCall(cid, username, 'disconnected');
      }
    }
  };
}

module.exports = { createCallsService };
