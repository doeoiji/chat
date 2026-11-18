const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64');
}

function jwkFromVapidKeys(publicKeyB64Url, privateKeyB64Url) {
  const pubRaw = fromBase64Url(publicKeyB64Url);
  if (pubRaw.length !== 65 || pubRaw[0] !== 0x04) {
    throw new Error('Invalid VAPID public key (expected uncompressed 65-byte P-256 point).');
  }
  const x = toBase64Url(pubRaw.subarray(1, 33));
  const y = toBase64Url(pubRaw.subarray(33, 65));
  return {
    kty: 'EC',
    crv: 'P-256',
    x,
    y,
    d: String(privateKeyB64Url).trim()
  };
}

function generateVapidKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pubRaw = Buffer.concat([Buffer.from([0x04]), fromBase64Url(jwk.x), fromBase64Url(jwk.y)]);
  return {
    publicKey: toBase64Url(pubRaw),
    privateKey: jwk.d,
    jwk
  };
}

function createVapidAuthHeader({ endpoint, subject, publicKey, privateKeyObj }) {
  const u = new URL(endpoint);
  const audience = `${u.protocol}//${u.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const headerB64 = toBase64Url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claimsB64 = toBase64Url(Buffer.from(JSON.stringify({ aud: audience, exp, sub: subject })));
  const unsigned = `${headerB64}.${claimsB64}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), {
    key: privateKeyObj,
    dsaEncoding: 'ieee-p1363'
  });
  return `vapid t=${unsigned}.${toBase64Url(sig)}, k=${publicKey}`;
}

function encryptWebPushPayload(subscription, payloadBuffer) {
  const uaPublic = fromBase64Url(subscription.keys && subscription.keys.p256dh);
  const authSecret = fromBase64Url(subscription.keys && subscription.keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04 || authSecret.length !== 16) {
    throw new Error('Invalid Web Push subscription keys.');
  }

  const asEcdh = crypto.createECDH('prime256v1');
  asEcdh.generateKeys();
  const asPublic = asEcdh.getPublicKey();
  const sharedSecret = asEcdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12));

  const plaintext = Buffer.concat([Buffer.from(payloadBuffer), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1 + asPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  asPublic.copy(header, 21);

  return Buffer.concat([header, encrypted]);
}

function parseFcmServiceAccount(config) {
  const pushCfg = (config && config.push) || {};
  if (pushCfg.fcmServiceAccountJson) {
    try {
      const raw = String(pushCfg.fcmServiceAccountJson).trim();
      if (raw.startsWith('{')) return JSON.parse(raw);
      if (fs.existsSync(raw)) return JSON.parse(fs.readFileSync(raw, 'utf8'));
    } catch {
      // Ignore malformed service account
    }
  }
  if (pushCfg.fcmProjectId && pushCfg.fcmClientEmail && pushCfg.fcmPrivateKey) {
    return {
      project_id: pushCfg.fcmProjectId,
      client_email: pushCfg.fcmClientEmail,
      private_key: String(pushCfg.fcmPrivateKey).replace(/\\n/g, '\n')
    };
  }
  return null;
}

function createPushService({ config, storage, transportFetch = null }) {
  const fetchImpl = transportFetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const vapidPath = path.join(config.dataDir, '.vapid.json');
  const pushCfg = (config && config.push) || {};
  const vapidSubject = pushCfg.vapidSubject || 'mailto:admin@viberoom.app';
  const fcmServiceAccount = parseFcmServiceAccount(config);
  const fcmLegacyKey = pushCfg.fcmServerKey || '';

  let cachedVapid = null;
  let fcmAccessToken = null;
  let fcmAccessExpiryMs = 0;

  async function ensureVapidKeys() {
    if (cachedVapid) return cachedVapid;

    if (pushCfg.vapidPublicKey && pushCfg.vapidPrivateKey) {
      try {
        const jwk = jwkFromVapidKeys(pushCfg.vapidPublicKey, pushCfg.vapidPrivateKey);
        cachedVapid = {
          publicKey: pushCfg.vapidPublicKey,
          privateKeyObj: crypto.createPrivateKey({ key: jwk, format: 'jwk' })
        };
        return cachedVapid;
      } catch {
        // Fall back to disk / generated keypair
      }
    }

    try {
      if (fs.existsSync(vapidPath)) {
        const saved = JSON.parse(await fsp.readFile(vapidPath, 'utf8'));
        if (saved && saved.publicKey && saved.privateKey) {
          const jwk = jwkFromVapidKeys(saved.publicKey, saved.privateKey);
          cachedVapid = {
            publicKey: saved.publicKey,
            privateKeyObj: crypto.createPrivateKey({ key: jwk, format: 'jwk' })
          };
          return cachedVapid;
        }
      }
    } catch {
      // Regenerate below if missing/corrupt
    }

    const generated = generateVapidKeyPair();
    await fsp.mkdir(path.dirname(vapidPath), { recursive: true });
    await fsp.writeFile(
      vapidPath,
      JSON.stringify({ publicKey: generated.publicKey, privateKey: generated.privateKey }, null, 2),
      'utf8'
    );
    cachedVapid = {
      publicKey: generated.publicKey,
      privateKeyObj: crypto.createPrivateKey({ key: generated.jwk, format: 'jwk' })
    };
    return cachedVapid;
  }

  async function getPublicConfig() {
    const vapid = await ensureVapidKeys();
    return {
      supported: true,
      vapidPublicKey: vapid.publicKey,
      fcmEnabled: Boolean(fcmServiceAccount || fcmLegacyKey)
    };
  }

  async function getFcmOAuthToken() {
    if (!fcmServiceAccount || !fetchImpl) return null;
    if (fcmAccessToken && Date.now() < fcmAccessExpiryMs - 60000) {
      return fcmAccessToken;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const header = toBase64Url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const claims = toBase64Url(Buffer.from(JSON.stringify({
      iss: fcmServiceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600
    })));
    const unsigned = `${header}.${claims}`;
    const keyObj = crypto.createPrivateKey(fcmServiceAccount.private_key);
    const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), keyObj);
    const assertion = `${unsigned}.${toBase64Url(sig)}`;

    const resp = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString()
    });
    if (!resp.ok) {
      throw new Error(`FCM OAuth token request failed (${resp.status})`);
    }
    const data = await resp.json();
    fcmAccessToken = data.access_token;
    fcmAccessExpiryMs = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    return fcmAccessToken;
  }

  async function sendWebPushToSub(sub, payload) {
    if (!fetchImpl || !sub || !sub.endpoint) return { ok: false, gone: false };
    try {
      const vapid = await ensureVapidKeys();
      const body = encryptWebPushPayload(sub, Buffer.from(JSON.stringify(payload), 'utf8'));
      const authHeader = createVapidAuthHeader({
        endpoint: sub.endpoint,
        subject: vapidSubject,
        publicKey: vapid.publicKey,
        privateKeyObj: vapid.privateKeyObj
      });
      const resp = await fetchImpl(sub.endpoint, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: payload.urgency || 'high'
        },
        body
      });
      if (resp.status === 404 || resp.status === 410) {
        return { ok: false, gone: true, endpoint: sub.endpoint };
      }
      return { ok: resp.ok, status: resp.status, gone: false };
    } catch {
      return { ok: false, gone: false };
    }
  }

  async function sendFcmToToken(token, payload) {
    if (!fetchImpl || !token) return { ok: false, gone: false };
    const dataMap = {
      type: String(payload.type || 'message'),
      chatId: String((payload.data && payload.data.chatId) || ''),
      messageId: String((payload.data && payload.data.messageId) || ''),
      sender: String((payload.data && payload.data.sender) || ''),
      senderName: String(payload.title || 'VibeRoom'),
      preview: String(payload.body || 'New message'),
      title: String(payload.title || 'VibeRoom'),
      body: String(payload.body || '')
    };

    try {
      if (fcmServiceAccount) {
        const oauthToken = await getFcmOAuthToken();
        if (!oauthToken) return { ok: false, gone: false };
        const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(fcmServiceAccount.project_id)}/messages:send`;
        const resp = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${oauthToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: {
              token,
              data: dataMap,
              android: {
                priority: 'high'
              }
            }
          })
        });
        if (resp.status === 404 || resp.status === 400) {
          const text = await resp.text().catch(() => '');
          if (/UNREGISTERED|NotRegistered|Requested entity was not found/i.test(text)) {
            return { ok: false, gone: true, token };
          }
        }
        return { ok: resp.ok, status: resp.status, gone: false };
      }

      if (fcmLegacyKey) {
        const resp = await fetchImpl('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            Authorization: `key=${fcmLegacyKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            to: token,
            priority: 'high',
            data: dataMap
          })
        });
        const resJson = await resp.json().catch(() => ({}));
        const firstErr = resJson && Array.isArray(resJson.results) && resJson.results[0] && resJson.results[0].error;
        if (firstErr === 'NotRegistered' || firstErr === 'InvalidRegistration') {
          return { ok: false, gone: true, token };
        }
        return { ok: resp.ok && !firstErr, gone: false };
      }
    } catch {
      return { ok: false, gone: false };
    }
    return { ok: false, gone: false };
  }

  async function notifyUser(username, payload, { chatId = null, ignoreMute = false } = {}) {
    if (!username || !storage) return { webSent: 0, fcmSent: 0 };
    if (chatId && !ignoreMute) {
      const prefs = await storage.getUserChatPrefs(username).catch(() => null);
      if (prefs && (prefs.mutedChats.includes(chatId) || prefs.archivedChats.includes(chatId))) {
        return { webSent: 0, fcmSent: 0, suppressed: true };
      }
    }
    const tokens = await storage.getUserPushTokens(username);
    if (!tokens || (tokens.webSubscriptions.length === 0 && tokens.fcmTokens.length === 0)) {
      return { webSent: 0, fcmSent: 0 };
    }

    let webSent = 0;
    let fcmSent = 0;
    const staleEndpoints = [];
    const staleFcmTokens = [];

    const webPromises = tokens.webSubscriptions.map(async (sub) => {
      const res = await sendWebPushToSub(sub, payload);
      if (res.ok) webSent++;
      else if (res.gone && res.endpoint) staleEndpoints.push(res.endpoint);
    });
    const fcmPromises = tokens.fcmTokens.map(async (entry) => {
      const res = await sendFcmToToken(entry.token, payload);
      if (res.ok) fcmSent++;
      else if (res.gone && res.token) staleFcmTokens.push(res.token);
    });

    await Promise.all([...webPromises, ...fcmPromises]);

    for (const ep of staleEndpoints) {
      await storage.removeWebPushSubscription(username, ep).catch(() => {});
    }
    for (const tk of staleFcmTokens) {
      await storage.removeFcmToken(username, tk).catch(() => {});
    }

    return { webSent, fcmSent };
  }

  async function notifyUsers(usernames, payload, options = {}) {
    if (!Array.isArray(usernames) || usernames.length === 0) return;
    await Promise.all(usernames.map((u) => notifyUser(u, payload, options)));
  }

  function formatMessagePreview(message, senderProfile, meta) {
    const senderName = (senderProfile && (senderProfile.displayName || senderProfile.username)) || message.sender;
    const isSecret = Boolean((meta && meta.type === 'secret') || (message.chatId && String(message.chatId).startsWith('sec_')));
    const isRoom = meta && (meta.type === 'group' || meta.type === 'channel');
    const title = isSecret ? `🔒 ${senderName}` : (isRoom ? `${meta.title || 'Group'} • ${senderName}` : senderName);

    let body = message.text || '';
    if (isSecret) {
      if (message.viewOnce) body = 'Sent a View-Once message';
      else if (message.poll) body = 'Sent a poll';
      else if (message.game) body = 'Sent a game';
      else if (message.sticker) body = message.sticker.type === 'gif' ? 'Sent a GIF' : 'Sent a sticker';
      else if (Array.isArray(message.attachments) && message.attachments[0]) {
        const a = message.attachments[0];
        if (message.kind === 'gif' || a.mimeType === 'image/gif' || /\.gif$/i.test(a.originalName || '')) body = 'Sent a GIF';
        else if (message.kind === 'sticker') body = 'Sent a sticker';
        else if (a.mimeType && a.mimeType.startsWith('audio/')) body = 'Sent a voice message';
        else if (a.isImage) body = 'Sent a photo';
        else if (a.mimeType && a.mimeType.startsWith('video/')) body = 'Sent a video';
        else body = 'Sent a file';
      } else {
        body = 'Sent a message';
      }
      return {
        title,
        body,
        tag: message.id,
        urgency: 'high',
        data: {
          chatId: message.chatId,
          messageId: message.id,
          sender: message.sender
        }
      };
    }

    if (message.viewOnce) {
      body = '🔒 Sent a View-Once message';
    } else if (message.timed && !message.openedAt) {
      body = `⏱ Sent a timed message (${message.ttlSeconds || 10}s)`;
    } else if (message.poll) {
      body = `${message.poll.mode === 'quiz' ? '🧠 Quiz' : '📊 Poll'}: ${message.poll.question}`;
    } else if (message.game) {
      body = `🎮 ${message.game.title || 'Mini-Game'} challenge!`;
    } else if (message.sticker) {
      body = message.sticker.type === 'gif' ? '🎞️ Sent a GIF' : `${message.sticker.emoji || '🎭'} Sent a sticker`;
    } else if (!body && Array.isArray(message.attachments) && message.attachments[0]) {
      const a = message.attachments[0];
      if (a.mimeType && a.mimeType.startsWith('audio/')) body = '🎤 Voice message';
      else if (a.isImage) body = '📷 Photo';
      else if (a.mimeType && a.mimeType.startsWith('video/')) body = '🎬 Video';
      else body = `📎 ${a.originalName}`;
    }

    return {
      title,
      body: body.slice(0, 140) || 'New message',
      tag: message.id,
      urgency: 'high',
      data: {
        chatId: message.chatId,
        messageId: message.id,
        sender: message.sender
      }
    };
  }

  return {
    getPublicConfig,
    notifyUser,
    notifyUsers,
    formatMessagePreview
  };
}

module.exports = {
  createPushService,
  encryptWebPushPayload,
  createVapidAuthHeader,
  generateVapidKeyPair,
  toBase64Url,
  fromBase64Url
};
