const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseMultipart, readBodyBuffer } = require('./multipart');
const { createMailer } = require('./mailer');
const { createAuditLogger } = require('./audit');
const { createLinkPreviewService } = require('./linkPreview');
const { createFriendsService } = require('./friends');
const { createGroupService } = require('./groups');
const { createStrangerService } = require('./stranger');
const { createGamesService } = require('./games');
const { createCallsService } = require('./calls');
const { createPollsService } = require('./polls');
const { createPushService } = require('./push');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip'
};

const INLINE_SAFE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/apng', 'image/avif', 'image/bmp',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm',
  'video/mp4', 'video/webm', 'application/pdf'
]);

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const buf = await readBodyBuffer(req, maxBytes);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    const err = new Error('Invalid JSON request body.');
    err.statusCode = 400;
    throw err;
  }
}

function createRouter({ config, auth, storage, hub, mailer, audit, push }) {
  const mailService = mailer || createMailer(config);
  const auditLogger = audit || createAuditLogger(config);
  const pushService = push || createPushService({ config, storage });
  const linkPreview = createLinkPreviewService();
  const friends = createFriendsService({ config, storage });
  const groups = createGroupService({ config, storage, friends });
  const stranger = createStrangerService({ hub, storage, friends });
  const games = createGamesService({ storage, friends });
  const polls = createPollsService({ storage });
  const calls = createCallsService({ hub, storage, audit: auditLogger });

  function emitSanitizedMessageEvent(participants, eventName, chatId, rawMessage, extra = {}) {
    if (!Array.isArray(participants) || !rawMessage) return;
    for (const participant of participants) {
      hub.emitToUser(participant, eventName, {
        ...extra,
        chatId,
        message: storage.sanitizeMessageForViewer(rawMessage, participant)
      });
    }
  }

  function dispatchChatPushNotifications(meta, senderUser, message) {
    if (!meta || !Array.isArray(meta.participants) || !message) return;
    const recipients = meta.participants.filter((u) => u && u !== senderUser.username);
    if (recipients.length === 0) return;
    const payload = pushService.formatMessagePreview(message, senderUser, meta);
    pushService.notifyUsers(recipients, payload, { chatId: meta.id }).catch(() => {});
  }
  async function requireAuth(req, res, { logUnauthorized = true } = {}) {
    const session = auth.getSessionUser(req);
    if (!session) {
      if (logUnauthorized) {
        auditLogger.log({
          action: 'UNAUTHORIZED_ACCESS',
          req,
          details: { method: req.method, path: req.url }
        });
      }
      sendJson(res, 401, { error: 'Authentication required.' });
      return null;
    }
    const user = await storage.getUserByUsername(session.username);
    if (!user) {
      if (logUnauthorized) {
        auditLogger.log({
          action: 'SESSION_INVALID',
          username: session.username,
          req,
          details: { method: req.method, path: req.url }
        });
      }
      sendJson(res, 401, { error: 'Session expired or user no longer exists.' });
      return null;
    }
    return storage.toPublicUser(user);
  }

  function enrichUser(user) {
    if (!user) return null;
    return { ...user, online: hub.isOnline(user.username) };
  }

  function canViewerSeePrivacyField(level, isSelf, isContact, anyBlocked) {
    if (isSelf) return true;
    if (anyBlocked) return false;
    if (level === 'nobody') return false;
    if (level === 'contacts') return Boolean(isContact);
    return true;
  }

  async function enrichUserForViewer(viewerUsername, rawPublicUser) {
    if (!rawPublicUser) return null;
    if (!viewerUsername || viewerUsername === rawPublicUser.username) {
      return enrichUser(rawPublicUser);
    }
    if (rawPublicUser.deleted) {
      const { privacy: _p, ...rest } = rawPublicUser;
      return { ...rest, online: false, lastSeen: null, blockedByMe: false, blockedByPeer: false };
    }
    const [isContact, blockStatus] = await Promise.all([
      friends.areFriends(viewerUsername, rawPublicUser.username),
      storage.getBlockStatus(viewerUsername, rawPublicUser.username)
    ]);
    const priv = rawPublicUser.privacy || { email: 'everyone', birthday: 'everyone', lastSeen: 'everyone', avatar: 'everyone' };
    const { privacy: _drop, ...base } = rawPublicUser;
    const showLastSeen = canViewerSeePrivacyField(priv.lastSeen, false, isContact, blockStatus.anyBlocked);
    return {
      ...base,
      email: canViewerSeePrivacyField(priv.email, false, isContact, blockStatus.anyBlocked) ? rawPublicUser.email : null,
      birthday: canViewerSeePrivacyField(priv.birthday, false, isContact, blockStatus.anyBlocked) ? rawPublicUser.birthday : null,
      avatarUrl: canViewerSeePrivacyField(priv.avatar, false, isContact, blockStatus.anyBlocked) ? rawPublicUser.avatarUrl : null,
      online: showLastSeen ? hub.isOnline(rawPublicUser.username) : false,
      lastSeen: showLastSeen ? rawPublicUser.lastSeen : null,
      blockedByMe: blockStatus.blockedByA,
      blockedByPeer: blockStatus.blockedByB
    };
  }

  async function getVisibleOnlineUsers(viewerUsername) {
    const allOnline = hub.getOnlineUsernames();
    const visible = [];
    for (const uname of allOnline) {
      if (uname === viewerUsername) {
        visible.push(uname);
        continue;
      }
      const target = await storage.getUserByUsername(uname);
      if (!target) continue;
      const priv = (target.privacy && target.privacy.lastSeen) || 'everyone';
      if (priv === 'nobody') continue;
      const blockStatus = await storage.getBlockStatus(viewerUsername, uname);
      if (blockStatus.anyBlocked) continue;
      if (priv === 'contacts') {
        const isFriend = await friends.areFriends(viewerUsername, uname);
        if (!isFriend) continue;
      }
      visible.push(uname);
    }
    return visible;
  }

  async function emitPresenceRespectingPrivacy(subjectUsername, online, lastSeen) {
    const target = await storage.getUserByUsername(subjectUsername);
    const priv = (target && target.privacy && target.privacy.lastSeen) || 'everyone';
    const viewers = hub.getOnlineUsernames().filter((u) => u !== subjectUsername);
    for (const viewer of viewers) {
      const blockStatus = await storage.getBlockStatus(viewer, subjectUsername);
      let allowed = !blockStatus.anyBlocked && priv !== 'nobody';
      if (allowed && priv === 'contacts') {
        allowed = await friends.areFriends(viewer, subjectUsername);
      }
      if (allowed) {
        hub.emitToUser(viewer, 'presence', {
          username: subjectUsername,
          online: Boolean(online),
          lastSeen: priv === 'nobody' ? null : lastSeen
        });
      } else {
        hub.emitToUser(viewer, 'presence', {
          username: subjectUsername,
          online: false,
          lastSeen: null
        });
      }
    }
  }

  function scheduleLinkPreview(chatId, message) {
    if (!message || !message.text || message.viewOnce || message.kind === 'poll') return;
    const url = linkPreview.extractFirstUrl(message.text);
    if (!url) return;
    linkPreview.fetchPreview(url).then(async (preview) => {
      if (!preview) return;
      const updated = await storage.setMessageLinkPreview(chatId, message.id, preview).catch(() => null);
      if (updated && updated.message && updated.meta) {
        hub.emitToUsers(updated.meta.participants, 'message_updated', {
          chatId,
          message: updated.message
        });
      }
    }).catch(() => {});
  }

  async function getAssetVersion(publicRoot, filename) {
    try {
      const stat = await fsp.stat(path.join(publicRoot, filename));
      return crypto
        .createHash('sha1')
        .update(`${stat.mtimeMs}:${stat.size}`)
        .digest('hex')
        .slice(0, 8);
    } catch {
      return '1';
    }
  }

  async function serveStatic(reqPath, urlObj, res) {
    const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
    const publicRoot = path.resolve(config.publicDir);
    const targetPath = path.resolve(publicRoot, '.' + cleanPath);
    if (!targetPath.startsWith(publicRoot + path.sep) && targetPath !== path.join(publicRoot, 'index.html')) {
      res.writeHead(403);
      res.end('Forbidden');
      return true;
    }

    try {
      const stat = await fsp.stat(targetPath);
      if (!stat.isFile()) return false;
      const ext = path.extname(targetPath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';

      if (cleanPath === '/index.html') {
        const [cssVer, jsVer, featVer, rawHtml] = await Promise.all([
          getAssetVersion(publicRoot, 'styles.css'),
          getAssetVersion(publicRoot, 'app.js'),
          getAssetVersion(publicRoot, 'features.js'),
          fsp.readFile(targetPath, 'utf8')
        ]);
        const versionedHtml = rawHtml
          .replace(/\/styles\.css(?:\?v=[^"']*)?/g, `/styles.css?v=${cssVer}`)
          .replace(/\/app\.js(?:\?v=[^"']*)?/g, `/app.js?v=${jsVer}`)
          .replace(/\/features\.js(?:\?v=[^"']*)?/g, `/features.js?v=${featVer}`);
        const buf = Buffer.from(versionedHtml, 'utf8');
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': buf.length,
          'Cache-Control': 'no-store'
        });
        res.end(buf);
        return true;
      }

      const hasVersion = urlObj.searchParams.has('v');
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stat.size,
        'Cache-Control': hasVersion ? 'public, max-age=31536000, immutable' : 'no-cache'
      });
      fs.createReadStream(targetPath).pipe(res);
      return true;
    } catch {
      return false;
    }
  }

  async function serveBinaryFile(res, filePath, downloadName, forceDownload = false) {
    const stat = await fsp.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const isInline = !forceDownload && INLINE_SAFE_MIMES.has(mime);
    const dispType = isInline ? 'inline' : 'attachment';
    const encodedName = encodeURIComponent(downloadName || path.basename(filePath));

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Content-Disposition': `${dispType}; filename*=UTF-8''${encodedName}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400'
    });
    fs.createReadStream(filePath).pipe(res);
  }

  return async function handleRequest(req, res) {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(urlObj.pathname);
    const method = (req.method || 'GET').toUpperCase();

    try {
      // Health check
      if (method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
      }

      // Auth: Register (Step 1 — validate fields, send 6-digit verification email)
      if (method === 'POST' && pathname === '/api/auth/register') {
        const body = await readJsonBody(req);
        const pending = await storage.createPendingRegistration({
          username: body.username,
          email: body.email,
          password: body.password,
          displayName: body.displayName
        });
        const mailResult = await mailService.sendVerificationCode({
          to: pending.email,
          username: pending.username,
          code: pending.code,
          expiresMinutes: Math.round(config.verificationTtlMs / 60000)
        });
        auditLogger.log({
          action: 'REGISTER_REQUEST',
          username: pending.username,
          req,
          details: { maskedEmail: pending.maskedEmail }
        });
        return sendJson(res, 202, {
          verificationRequired: true,
          verificationId: pending.verificationId,
          maskedEmail: pending.maskedEmail,
          codeExpiresAt: pending.codeExpiresAt,
          nextResendAt: pending.nextResendAt,
          resendCount: pending.resendCount,
          resendCooldownSeconds: pending.resendCooldownSeconds,
          deliveryMode: mailResult.deliveryMode,
          ...(mailResult.devCode ? { devCode: mailResult.devCode } : {})
        });
      }

      // Auth: Verify Email (Step 2 — confirm 6-digit code and create verified account)
      if (method === 'POST' && pathname === '/api/auth/verify-email') {
        const body = await readJsonBody(req);
        const user = await storage.verifyPendingRegistration(body.verificationId, body.code);
        const cookie = auth.createSessionCookie(user.username);
        auditLogger.log({
          action: 'EMAIL_VERIFIED_REGISTER',
          username: user.username,
          req,
          details: { email: user.email }
        });
        return sendJson(res, 201, { user: enrichUser(user) }, { 'Set-Cookie': cookie });
      }

      // Auth: Resend Verification Code
      if (method === 'POST' && pathname === '/api/auth/resend-verification') {
        const body = await readJsonBody(req);
        const pending = await storage.resendPendingRegistration(body.verificationId);
        const mailResult = await mailService.sendVerificationCode({
          to: pending.email,
          username: pending.username,
          code: pending.code,
          expiresMinutes: Math.round(config.verificationTtlMs / 60000)
        });
        auditLogger.log({
          action: 'RESEND_VERIFICATION',
          username: pending.username,
          req,
          details: { resendCount: pending.resendCount }
        });
        return sendJson(res, 200, {
          verificationId: pending.verificationId,
          maskedEmail: pending.maskedEmail,
          codeExpiresAt: pending.codeExpiresAt,
          nextResendAt: pending.nextResendAt,
          resendCount: pending.resendCount,
          resendCooldownSeconds: pending.resendCooldownSeconds,
          deliveryMode: mailResult.deliveryMode,
          ...(mailResult.devCode ? { devCode: mailResult.devCode } : {})
        });
      }

      // Auth: Login (by username or email)
      if (method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJsonBody(req);
        const identifier = body.identifier || body.email || body.username;
        const user = await storage.authenticateUser(identifier, body.password);
        if (!user) {
          auditLogger.log({
            action: 'LOGIN_FAILED',
            username: identifier ? String(identifier).toLowerCase() : 'unknown',
            req,
            details: { identifier }
          });
          return sendJson(res, 401, { error: 'Invalid username/email or password.' });
        }
        const cookie = auth.createSessionCookie(user.username);
        auditLogger.log({
          action: 'LOGIN_SUCCESS',
          username: user.username,
          req,
          details: { identifier }
        });
        return sendJson(res, 200, { user: enrichUser(user) }, { 'Set-Cookie': cookie });
      }

      // Auth: Logout
      if (method === 'POST' && pathname === '/api/auth/logout') {
        const session = auth.getSessionUser(req);
        auditLogger.log({
          action: 'LOGOUT',
          username: session ? session.username : null,
          req
        });
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearSessionCookie() });
      }

      // Auth: Forgot password (Step 1 — request email OTP)
      if (method === 'POST' && pathname === '/api/auth/forgot-password') {
        const body = await readJsonBody(req);
        const pending = await storage.createPasswordResetRequest(body.identifier || body.email || body.username);
        const mailResult = await mailService.sendVerificationCode({
          to: pending.email,
          username: pending.username,
          code: pending.code,
          expiresMinutes: Math.round(config.verificationTtlMs / 60000),
          purpose: 'password_reset'
        });
        auditLogger.log({
          action: 'PASSWORD_RESET_REQUEST',
          username: pending.username,
          req,
          details: { maskedEmail: pending.maskedEmail }
        });
        return sendJson(res, 200, {
          verificationRequired: true,
          verificationId: pending.verificationId,
          maskedEmail: pending.maskedEmail,
          codeExpiresAt: pending.codeExpiresAt,
          nextResendAt: pending.nextResendAt,
          resendCount: pending.resendCount,
          resendCooldownSeconds: pending.resendCooldownSeconds,
          deliveryMode: mailResult.deliveryMode,
          ...(mailResult.devCode ? { devCode: mailResult.devCode } : {})
        });
      }

      // Auth: Reset password (Step 2 — verify email OTP & set new password)
      if (method === 'POST' && pathname === '/api/auth/reset-password') {
        const body = await readJsonBody(req);
        const user = await storage.resetPasswordWithOtp(body.verificationId, body.code, body.newPassword);
        auditLogger.log({
          action: 'PASSWORD_RESET',
          username: user.username,
          req
        });
        return sendJson(res, 200, { ok: true, username: user.username });
      }

      // Auth: Current user
      if (method === 'GET' && pathname === '/api/auth/me') {
        const me = await requireAuth(req, res, { logUnauthorized: false });
        if (!me) return;
        return sendJson(res, 200, { user: enrichUser(me) });
      }

      // Account: Change password (authenticated)
      if (method === 'POST' && pathname === '/api/users/me/password') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        await storage.changeUserPassword(me.username, body.currentPassword, body.newPassword);
        auditLogger.log({ action: 'PASSWORD_CHANGED', username: me.username, req });
        return sendJson(res, 200, { ok: true });
      }

      // Account: Update privacy settings
      if (method === 'PATCH' && pathname === '/api/users/me/privacy') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const updated = await storage.updateUserPrivacy(me.username, body);
        auditLogger.log({
          action: 'PRIVACY_UPDATED',
          username: me.username,
          req,
          details: updated ? updated.privacy : {}
        });
        await emitPresenceRespectingPrivacy(me.username, hub.isOnline(me.username), updated ? updated.lastSeen : new Date().toISOString());
        return sendJson(res, 200, { user: enrichUser(updated) });
      }

      // Account: Request deletion email verification code
      if (method === 'POST' && pathname === '/api/users/me/delete-request') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const otp = await storage.createDeleteAccountOtp(me.username);
        const mailResult = await mailService.sendVerificationCode({
          to: otp.email,
          username: otp.username,
          code: otp.code,
          expiresMinutes: Math.round(config.verificationTtlMs / 60000),
          purpose: 'delete_account'
        });
        auditLogger.log({
          action: 'ACCOUNT_DELETE_REQUEST',
          username: me.username,
          req,
          details: { maskedEmail: otp.maskedEmail }
        });
        return sendJson(res, 200, {
          verificationId: otp.verificationId,
          maskedEmail: otp.maskedEmail,
          codeExpiresAt: otp.codeExpiresAt,
          nextResendAt: otp.nextResendAt,
          resendCooldownSeconds: otp.resendCooldownSeconds,
          deliveryMode: mailResult.deliveryMode,
          ...(mailResult.devCode ? { devCode: mailResult.devCode } : {})
        });
      }

      // Account: Confirm deletion with email code + "DELETE" confirmation (preserves logs & data)
      if (method === 'POST' && pathname === '/api/users/me/delete-confirm') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const snapshot = await storage.confirmDeleteAccount(me.username, body.verificationId, body.code, body.confirmText);
        auditLogger.log({
          action: 'ACCOUNT_DELETED',
          username: me.username,
          req,
          details: { email: snapshot.email, deletedAt: snapshot.deletedAt, dataPreserved: true }
        });
        hub.emitToUser(me.username, 'account_deleted', { username: me.username });
        hub.broadcastAll('presence', { username: me.username, online: false, lastSeen: null });
        return sendJson(res, 200, { ok: true, deleted: true }, { 'Set-Cookie': auth.clearSessionCookie() });
      }

      // Update current user profile (username, displayName, bio)
      if (method === 'PATCH' && pathname === '/api/users/me') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const result = await storage.updateAccountProfile(me.username, {
          username: body.username,
          displayName: body.displayName,
          bio: body.bio,
          birthday: body.birthday
        });
        const extraHeaders = {};
        if (result.renamed && result.user) {
          await friends.renameUsername(result.previousUsername, result.user.username);
          hub.renameUser(result.previousUsername, result.user.username);
          extraHeaders['Set-Cookie'] = auth.createSessionCookie(result.user.username);
        }
        const enriched = enrichUser(result.user);
        auditLogger.log({
          action: result.renamed ? 'USERNAME_RENAMED' : 'PROFILE_UPDATED',
          username: result.user.username,
          req,
          details: result.renamed
            ? { from: result.previousUsername, to: result.user.username, displayName: result.user.displayName }
            : { displayName: result.user.displayName, birthday: result.user.birthday }
        });
        hub.broadcastAll('profile_updated', {
          user: enriched,
          previousUsername: result.previousUsername,
          chatRenames: result.chatRenames
        });
        return sendJson(res, 200, {
          user: enriched,
          renamedFrom: result.renamed ? result.previousUsername : null,
          chatRenames: result.chatRenames
        }, extraHeaders);
      }

      // Upload avatar
      if (method === 'POST' && pathname === '/api/users/me/avatar') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
          return sendJson(res, 400, { error: 'Expected multipart/form-data.' });
        }
        const buf = await readBodyBuffer(req, config.maxUploadBytes);
        const { files } = parseMultipart(buf, contentType);
        const file = files[0];
        if (!file || !file.mimeType.startsWith('image/') || file.mimeType === 'image/svg+xml') {
          return sendJson(res, 400, { error: 'Please upload a valid PNG, JPG, GIF, or WebP image.' });
        }
        const updated = await storage.saveUserAvatar(me.username, file);
        const enriched = enrichUser(updated);
        auditLogger.log({
          action: 'AVATAR_UPDATED',
          username: me.username,
          req,
          details: { filename: file.filename, bytes: file.data.length }
        });
        hub.broadcastAll('profile_updated', { user: enriched });
        return sendJson(res, 200, { user: enriched });
      }

      // Remove avatar
      if (method === 'DELETE' && pathname === '/api/users/me/avatar') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const updated = await storage.removeUserAvatar(me.username);
        const enriched = enrichUser(updated);
        auditLogger.log({ action: 'AVATAR_REMOVED', username: me.username, req });
        hub.broadcastAll('profile_updated', { user: enriched });
        return sendJson(res, 200, { user: enriched });
      }

      // Serve user avatar (enforcing avatar privacy & blocks)
      const avatarMatch = /^\/api\/users\/([^/]+)\/avatar\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && avatarMatch) {
        const [, targetUsername, filename] = avatarMatch;
        const targetProfile = await storage.getUserByUsername(targetUsername);
        if (targetProfile) {
          const privAvatar = (targetProfile.privacy && targetProfile.privacy.avatar) || 'everyone';
          const viewerSess = auth.getSessionUser(req);
          const viewer = viewerSess ? viewerSess.username : null;
          if (viewer !== targetProfile.username) {
            if (viewer) {
              const blockStatus = await storage.getBlockStatus(viewer, targetProfile.username);
              if (blockStatus.anyBlocked) return sendJson(res, 403, { error: 'Avatar is hidden.' });
            }
            if (privAvatar === 'nobody') {
              return sendJson(res, 403, { error: 'Avatar is private.' });
            }
            if (privAvatar === 'contacts') {
              const okFriend = viewer ? await friends.areFriends(viewer, targetProfile.username) : false;
              if (!okFriend) return sendJson(res, 403, { error: 'Avatar is visible to contacts only.' });
            }
          }
        }
        const filePath = await storage.getUserAvatarPath(targetUsername, filename);
        if (!filePath) return sendJson(res, 404, { error: 'Avatar not found.' });
        return serveBinaryFile(res, filePath, filename, false);
      }

      // Blocked Users & Report Controls
      if (method === 'GET' && pathname === '/api/users/blocked') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const blocked = await storage.listBlockedUsers(me.username);
        return sendJson(res, 200, { blocked: blocked.map((u) => ({ ...u, online: false, lastSeen: null, avatarUrl: null })) });
      }

      if (method === 'POST' && pathname === '/api/users/block') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const targetUsername = body.targetUsername || body.username;
        const resBlock = await storage.blockUser(me.username, targetUsername);
        auditLogger.log({
          action: 'USER_BLOCKED',
          username: me.username,
          alsoUsers: [resBlock.target],
          req,
          details: { target: resBlock.target }
        });
        hub.emitToUsers([me.username, resBlock.target], 'block_updated', {
          by: me.username,
          target: resBlock.target,
          blocked: true
        });
        return sendJson(res, 200, resBlock);
      }

      const unblockMatch = /^\/api\/users\/block\/([^/]+)$/.exec(pathname);
      if (method === 'DELETE' && unblockMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const target = unblockMatch[1].trim().toLowerCase();
        const resUnblock = await storage.unblockUser(me.username, target);
        auditLogger.log({
          action: 'USER_UNBLOCKED',
          username: me.username,
          alsoUsers: [target],
          req,
          details: { target }
        });
        hub.emitToUsers([me.username, target], 'block_updated', {
          by: me.username,
          target,
          blocked: false
        });
        return sendJson(res, 200, resUnblock);
      }

      if (method === 'POST' && pathname === '/api/users/report') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const report = await storage.createReport({
          reporter: me.username,
          targetUsername: body.targetUsername || body.username,
          reason: body.reason,
          details: body.details,
          chatId: body.chatId || null
        });
        auditLogger.log({
          action: 'USER_REPORTED',
          username: me.username,
          alsoUsers: [report.targetUsername],
          req,
          details: { target: report.targetUsername, reason: report.reason, reportId: report.id }
        });
        return sendJson(res, 201, { ok: true, reportId: report.id });
      }

      // Shareable profile lookup (?user=handle)
      const profileMatch = /^\/api\/users\/profile\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && profileMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const cleanHandle = profileMatch[1].trim().toLowerCase();
        const target = await storage.getUserByUsername(cleanHandle);
        if (!target) return sendJson(res, 404, { error: 'User not found.' });
        const enriched = await enrichUserForViewer(me.username, storage.toPublicUser(target));
        const relationship = await friends.getRelationship(me.username, target.username);
        return sendJson(res, 200, { user: { ...enriched, relationship } });
      }

      // Search users by exact email or username
      if (method === 'GET' && pathname === '/api/users/search') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const q = urlObj.searchParams.get('q') || '';
        const users = await storage.searchUsers(q, me.username);
        if (q.trim()) {
          auditLogger.log({
            action: 'USER_SEARCH',
            username: me.username,
            req,
            details: { query: q.trim(), matches: users.length }
          });
        }
        const enrichedUsers = await Promise.all(users.map(async (u) => ({
          ...(await enrichUserForViewer(me.username, u)),
          relationship: await friends.getRelationship(me.username, u.username)
        })));
        return sendJson(res, 200, { users: enrichedUsers });
      }

      // ===================================================================
      // Friends & Friend Requests
      // ===================================================================
      if (method === 'GET' && pathname === '/api/friends') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const data = await friends.listFriendsData(me.username);
        return sendJson(res, 200, {
          friends: await Promise.all(data.friends.map((u) => enrichUserForViewer(me.username, u))),
          sent: await Promise.all(data.sent.map(async (item) => ({ ...item, user: await enrichUserForViewer(me.username, item.user) }))),
          received: await Promise.all(data.received.map(async (item) => ({ ...item, user: await enrichUserForViewer(me.username, item.user) })))
        });
      }

      if (method === 'POST' && pathname === '/api/friends/request') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const rawTarget = String(body.targetUsername || body.username || '').trim().toLowerCase();
        if (rawTarget) {
          const blk = await storage.getBlockStatus(me.username, rawTarget);
          if (blk.anyBlocked) {
            return sendJson(res, 403, { error: 'Cannot send a friend request while a block is active.' });
          }
        }
        const result = await friends.sendFriendRequest(me.username, body.targetUsername || body.username);
        auditLogger.log({
          action: result.autoAccepted ? 'FRIEND_ACCEPTED' : 'FRIEND_REQUEST_SENT',
          username: me.username,
          alsoUsers: [result.target.username],
          req,
          details: { target: result.target.username, status: result.status }
        });
        hub.emitToUsers([me.username, result.target.username], 'friends_updated', {
          from: me.username,
          to: result.target.username,
          status: result.status
        });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && pathname === '/api/friends/accept') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const result = await friends.acceptFriendRequest(me.username, body.username);
        auditLogger.log({
          action: 'FRIEND_ACCEPTED',
          username: me.username,
          alsoUsers: [result.friend.username],
          req,
          details: { friend: result.friend.username }
        });
        hub.emitToUsers([me.username, result.friend.username], 'friends_updated', {
          by: me.username,
          friend: result.friend.username,
          status: 'friends'
        });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && pathname === '/api/friends/decline') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const target = String(body.username || '').trim().toLowerCase();
        await friends.declineFriendRequest(me.username, target);
        auditLogger.log({
          action: 'FRIEND_DECLINED',
          username: me.username,
          alsoUsers: [target],
          req,
          details: { target }
        });
        hub.emitToUsers([me.username, target], 'friends_updated', { by: me.username, target, status: 'none' });
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'POST' && pathname === '/api/friends/cancel') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const target = String(body.username || '').trim().toLowerCase();
        await friends.cancelFriendRequest(me.username, target);
        auditLogger.log({
          action: 'FRIEND_REQUEST_CANCELLED',
          username: me.username,
          alsoUsers: [target],
          req,
          details: { target }
        });
        hub.emitToUsers([me.username, target], 'friends_updated', { by: me.username, target, status: 'none' });
        return sendJson(res, 200, { ok: true });
      }

      const unfriendMatch = /^\/api\/friends\/([^/]+)$/.exec(pathname);
      if (method === 'DELETE' && unfriendMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const target = unfriendMatch[1].trim().toLowerCase();
        await friends.removeFriend(me.username, target);
        auditLogger.log({
          action: 'UNFRIENDED',
          username: me.username,
          alsoUsers: [target],
          req,
          details: { target }
        });
        hub.emitToUsers([me.username, target], 'friends_updated', { by: me.username, target, status: 'none' });
        return sendJson(res, 200, { ok: true });
      }

      // List active chats (DMs, Groups, and Channels)
      if (method === 'GET' && pathname === '/api/chats') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chats = await storage.listChatsForUser(me.username);
        const enriched = await Promise.all(chats.map(async (c) => ({
          ...c,
          peer: c.peer ? await enrichUserForViewer(me.username, c.peer) : null
        })));
        return sendJson(res, 200, { chats: enriched });
      }

      // Open or preview a DM chat, Saved Messages, OR open an existing group/channel
      if (method === 'POST' && pathname === '/api/chats/open') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const prefs = await storage.getUserChatPrefs(me.username);
        const pinnedSet = new Set(prefs.pinnedChats);
        const mutedSet = new Set(prefs.mutedChats);
        const archivedSet = new Set(prefs.archivedChats);

        if (body.chatId && groups.isGroupOrChannelId(body.chatId)) {
          const opened = await groups.openRoom(body.chatId, me.username);
          const metaObj = await storage.getChatMeta(body.chatId);
          opened.chat.isPinned = pinnedSet.has(opened.chat.id);
          opened.chat.isMuted = mutedSet.has(opened.chat.id);
          opened.chat.isArchived = archivedSet.has(opened.chat.id);
          opened.chat.pinnedMessage = metaObj && metaObj.pinnedMessage ? metaObj.pinnedMessage : null;
          return sendJson(res, 200, opened);
        }

        const mySavedId = storage.getSavedChatId(me.username);
        if (body.chatId && String(body.chatId).startsWith('saved_') && body.chatId !== mySavedId) {
          return sendJson(res, 403, { error: 'Forbidden.' });
        }
        if (body.type === 'saved' || body.chatId === 'saved' || body.chatId === mySavedId) {
          await storage.ensureSavedChatFolder(me.username);
          const { meta, messages } = await storage.getMessages(mySavedId, me.username);
          return sendJson(res, 200, {
            chat: {
              id: meta.id,
              type: 'saved',
              title: 'Saved Messages',
              participants: meta.participants,
              peer: null,
              isPinned: true,
              isMuted: mutedSet.has(meta.id),
              isArchived: false,
              pinnedMessage: meta.pinnedMessage || null,
              createdAt: meta.createdAt,
              updatedAt: meta.updatedAt,
              lastMessage: meta.lastMessage,
              unreadCount: 0,
              exists: true
            },
            messages
          });
        }

        const targetUsername = String(body.targetUsername || '').trim().toLowerCase();
        if (!targetUsername || targetUsername === me.username) {
          return sendJson(res, 400, { error: 'Invalid target user.' });
        }
        const targetRaw = (await storage.getUserByUsername(targetUsername)) || (await storage.getRawProfile(targetUsername));
        if (!targetRaw) {
          return sendJson(res, 404, { error: 'User not found.' });
        }
        const enrichedPeer = await enrichUserForViewer(me.username, storage.toPublicUser(targetRaw));
        const peer = {
          ...enrichedPeer,
          relationship: await friends.getRelationship(me.username, targetUsername)
        };
        const chatId = storage.getDmChatId(me.username, targetUsername);
        const existingMeta = await storage.getChatMeta(chatId);

        if (!existingMeta) {
          return sendJson(res, 200, {
            chat: {
              id: chatId,
              type: 'dm',
              participants: [me.username, targetUsername].sort(),
              peer,
              isPinned: pinnedSet.has(chatId),
              isMuted: mutedSet.has(chatId),
              isArchived: archivedSet.has(chatId),
              pinnedMessage: null,
              createdAt: null,
              updatedAt: null,
              lastMessage: null,
              unreadCount: 0,
              exists: false
            },
            messages: []
          });
        }

        const { meta, messages } = await storage.getMessages(chatId, me.username);
        return sendJson(res, 200, {
          chat: {
            id: meta.id,
            type: meta.type,
            participants: meta.participants,
            peer,
            isPinned: pinnedSet.has(meta.id),
            isMuted: mutedSet.has(meta.id),
            isArchived: archivedSet.has(meta.id),
            pinnedMessage: meta.pinnedMessage || null,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
            lastMessage: meta.lastMessage,
            unreadCount: (meta.unreadCounts && meta.unreadCounts[me.username]) || 0,
            exists: true
          },
          messages
        });
      }

      // Get messages in a chat
      const chatMsgsMatch = /^\/api\/chats\/([^/]+)\/messages$/.exec(pathname);
      if (method === 'GET' && chatMsgsMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = chatMsgsMatch[1];
        const existingMeta = await storage.getChatMeta(chatId);
        if (!existingMeta) {
          return sendJson(res, 200, { messages: [], exists: false });
        }
        const { meta, messages } = await storage.getMessages(chatId, me.username);
        return sendJson(res, 200, { meta, messages, exists: true });
      }

      // Send message (text, images/files) in DM, Group, or Channel
      if (method === 'POST' && chatMsgsMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = chatMsgsMatch[1];

        if (!storage.CHAT_ID_REGEX.test(chatId)) {
          return sendJson(res, 400, { error: 'Invalid chat ID.' });
        }

        let text = '';
        let replyToId = null;
        let kind = 'text';
        let sticker = null;
        let voiceMeta = null;
        let ttlSeconds = 0;
        let viewOnce = false;
        let files = [];

        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
          const buf = await readBodyBuffer(req, config.maxUploadBytes);
          const parsed = parseMultipart(buf, contentType);
          text = parsed.fields.text || '';
          replyToId = parsed.fields.replyToId || null;
          if (parsed.fields.kind === 'sticker' || parsed.fields.kind === 'gif') {
            kind = parsed.fields.kind;
          }
          if (parsed.fields.sticker) {
            try { sticker = JSON.parse(parsed.fields.sticker); } catch { }
          }
          if (parsed.fields.voiceMeta) {
            try { voiceMeta = JSON.parse(parsed.fields.voiceMeta); } catch { }
          }
          if (parsed.fields.ttlSeconds) {
            ttlSeconds = Number(parsed.fields.ttlSeconds) || 0;
          }
          viewOnce = parsed.fields.viewOnce === '1' || parsed.fields.viewOnce === 'true';
          files = parsed.files;
        } else {
          const body = await readJsonBody(req);
          text = body.text || '';
          replyToId = body.replyToId || null;
          if (body.kind === 'sticker' || body.kind === 'gif') {
            kind = body.kind;
          }
          if (body.sticker && typeof body.sticker === 'object') {
            sticker = body.sticker;
          }
          if (body.voiceMeta && typeof body.voiceMeta === 'object') {
            voiceMeta = body.voiceMeta;
          }
          if (body.ttlSeconds) {
            ttlSeconds = Number(body.ttlSeconds) || 0;
          }
          viewOnce = Boolean(body.viewOnce);
        }

        if (groups.isGroupOrChannelId(chatId)) {
          const existingMeta = await storage.getChatMeta(chatId);
          if (!existingMeta || !existingMeta.participants.includes(me.username)) {
            return sendJson(res, 404, { error: 'Room not found.' });
          }
        } else if (chatId.startsWith('saved_')) {
          if (chatId !== storage.getSavedChatId(me.username)) {
            return sendJson(res, 403, { error: 'Forbidden.' });
          }
          await storage.ensureSavedChatFolder(me.username);
        } else {
          const parts = chatId.slice(3).split('__');
          if (!parts.includes(me.username)) {
            return sendJson(res, 403, { error: 'Forbidden.' });
          }
          const peerUsername = parts.find((p) => p !== me.username) || parts[0];
          const peerProfile = await storage.getUserByUsername(peerUsername);
          if (!peerProfile) {
            return sendJson(res, 404, { error: 'This user account is no longer active.' });
          }
          const blk = await storage.getBlockStatus(me.username, peerUsername);
          if (blk.blockedByA) {
            return sendJson(res, 403, { error: 'You blocked this user. Unblock them to send messages.' });
          }
          if (blk.blockedByB) {
            return sendJson(res, 403, { error: 'You cannot send messages to this user.' });
          }
          await storage.ensureChatFolder(me.username, peerUsername);
        }

        const { message, meta } = await storage.appendChatMessage(chatId, me.username, {
          text,
          files,
          replyToId,
          kind,
          sticker,
          voiceMeta,
          ttlSeconds,
          viewOnce
        });

        await storage.updateLastSeen(me.username);
        auditLogger.log({
          action: 'MESSAGE_SENT',
          username: me.username,
          alsoUsers: meta.participants.filter((p) => p !== me.username && meta.type === 'dm'),
          req,
          details: {
            chatId,
            messageId: message.id,
            text: message.viewOnce ? '[view-once]' : (message.text ? message.text.slice(0, 160) : ''),
            files: (message.attachments || []).map((a) => `${a.originalName}(${a.size}B)`).join(','),
            mentions: (message.mentions || []).join(','),
            ttlSeconds: message.ttlSeconds || 0,
            viewOnce: Boolean(message.viewOnce)
          }
        });
        emitSanitizedMessageEvent(meta.participants, 'new_message', chatId, message, {
          meta,
          senderProfile: enrichUser(me)
        });
        scheduleLinkPreview(chatId, message);
        dispatchChatPushNotifications(meta, me, message);

        return sendJson(res, 201, {
          message: storage.sanitizeMessageForViewer(message, me.username),
          meta
        });
      }

      // Mark chat as read
      const readMatch = /^\/api\/chats\/([^/]+)\/read$/.exec(pathname);
      if (method === 'POST' && readMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = readMatch[1];
        const result = await storage.markChatRead(chatId, me.username);
        if (!result) return sendJson(res, 200, { ok: true, newlyReadIds: [] });

        if (result.newlyReadIds.length > 0) {
          hub.emitToUsers(result.meta.participants, 'read_receipt', {
            chatId,
            reader: me.username,
            messageIds: result.newlyReadIds
          });
        }
        return sendJson(res, 200, { ok: true, newlyReadIds: result.newlyReadIds });
      }

      // Typing indicator (supports DM & Group)
      const typingMatch = /^\/api\/chats\/([^/]+)\/typing$/.exec(pathname);
      if (method === 'POST' && typingMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = typingMatch[1];
        if (!storage.CHAT_ID_REGEX.test(chatId)) {
          return sendJson(res, 400, { error: 'Invalid chat ID.' });
        }
        const body = await readJsonBody(req);
        let recipients = [];
        if (groups.isGroupOrChannelId(chatId)) {
          const meta = await storage.getChatMeta(chatId);
          if (!meta || !meta.participants.includes(me.username)) {
            return sendJson(res, 403, { error: 'Forbidden.' });
          }
          recipients = meta.participants.filter((p) => p !== me.username);
        } else if (chatId.startsWith('saved_')) {
          if (chatId !== storage.getSavedChatId(me.username)) return sendJson(res, 403, { error: 'Forbidden.' });
          recipients = [];
        } else {
          const parts = chatId.slice(3).split('__');
          if (!parts.includes(me.username)) return sendJson(res, 403, { error: 'Forbidden.' });
          recipients = parts.filter((p) => p !== me.username);
        }
        if (recipients.length > 0) {
          hub.emitToUsers(recipients, 'typing', {
            chatId,
            username: me.username,
            isTyping: Boolean(body.isTyping)
          });
        }
        return sendJson(res, 200, { ok: true });
      }

      // React to message
      const reactMatch = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/react$/.exec(pathname);
      if (method === 'POST' && reactMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, messageId] = reactMatch;
        const body = await readJsonBody(req);
        const result = await storage.toggleReaction(chatId, messageId, me.username, body.emoji);
        if (!result) return sendJson(res, 404, { error: 'Message not found.' });
        auditLogger.log({
          action: 'MESSAGE_REACT',
          username: me.username,
          req,
          details: { chatId, messageId, emoji: body.emoji }
        });
        hub.emitToUsers(result.meta.participants, 'message_updated', {
          chatId,
          message: result.message
        });
        return sendJson(res, 200, { message: result.message });
      }

      // Edit own message
      const msgItemMatch = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)$/.exec(pathname);
      if (method === 'PATCH' && msgItemMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, messageId] = msgItemMatch;
        const body = await readJsonBody(req);
        const result = await storage.editMessage(chatId, messageId, me.username, body.text);
        if (!result) return sendJson(res, 404, { error: 'Message not found.' });
        auditLogger.log({
          action: 'MESSAGE_EDITED',
          username: me.username,
          req,
          details: { chatId, messageId, text: result.message.text.slice(0, 160) }
        });
        hub.emitToUsers(result.meta.participants, 'message_updated', {
          chatId,
          message: result.message
        });
        scheduleLinkPreview(chatId, result.message);
        return sendJson(res, 200, { message: result.message });
      }

      // Delete message (for self only OR also for other user / everyone)
      if (method === 'DELETE' && msgItemMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, messageId] = msgItemMatch;
        const qForEveryone = urlObj.searchParams.get('forEveryone');
        let forEveryone = qForEveryone !== null ? qForEveryone !== '0' && qForEveryone !== 'false' : undefined;
        if (forEveryone === undefined) {
          const body = await readJsonBody(req).catch(() => ({}));
          forEveryone = typeof body.forEveryone === 'boolean' ? body.forEveryone : true;
        }
        const result = await storage.deleteMessage(chatId, messageId, me.username, { forEveryone });
        if (!result) return sendJson(res, 404, { error: 'Message not found.' });
        auditLogger.log({
          action: 'MESSAGE_DELETED',
          username: me.username,
          req,
          details: { chatId, messageId: result.deletedId, forEveryone: result.forEveryone }
        });
        const recipients = result.forEveryone ? result.meta.participants : [me.username];
        hub.emitToUsers(recipients, 'message_deleted', {
          chatId,
          messageId: result.deletedId,
          forEveryone: result.forEveryone,
          meta: result.meta
        });
        return sendJson(res, 200, { ok: true, forEveryone: result.forEveryone });
      }

      // Bulk delete multiple messages (with forEveryone toggle)
      const bulkDeleteMatch = /^\/api\/chats\/([^/]+)\/messages\/bulk-delete$/.exec(pathname);
      if (method === 'POST' && bulkDeleteMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = bulkDeleteMatch[1];
        const body = await readJsonBody(req);
        const forEveryone = typeof body.forEveryone === 'boolean' ? body.forEveryone : true;
        const result = await storage.bulkDeleteMessages(chatId, body.messageIds, me.username, { forEveryone });
        if (!result) return sendJson(res, 404, { error: 'No matching messages found.' });
        auditLogger.log({
          action: 'MESSAGE_DELETED',
          username: me.username,
          req,
          details: { chatId, count: result.deletedIds.length, forEveryone, ids: result.deletedIds.join(',') }
        });
        for (const deletedId of result.forEveryoneIds) {
          hub.emitToUsers(result.meta.participants, 'message_deleted', {
            chatId,
            messageId: deletedId,
            forEveryone: true,
            meta: result.meta
          });
        }
        for (const deletedId of result.deletedForMeIds) {
          hub.emitToUser(me.username, 'message_deleted', {
            chatId,
            messageId: deletedId,
            forEveryone: false,
            meta: result.meta
          });
        }
        return sendJson(res, 200, {
          ok: true,
          deletedIds: result.deletedIds,
          forEveryoneIds: result.forEveryoneIds,
          deletedForMeIds: result.deletedForMeIds
        });
      }

      // Forward messages to one or more chats (including Saved Messages)
      const forwardMatch = /^\/api\/chats\/([^/]+)\/forward$/.exec(pathname);
      if (method === 'POST' && forwardMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const fromChatId = forwardMatch[1];
        const body = await readJsonBody(req);
        const targets = Array.isArray(body.targetChatIds) ? body.targetChatIds.slice(0, 10) : [];
        const messageIds = Array.isArray(body.messageIds) ? body.messageIds : [];
        if (targets.length === 0 || messageIds.length === 0) {
          return sendJson(res, 400, { error: 'Target chat and messages are required.' });
        }

        const forwardedCount = [];
        for (const rawTarget of targets) {
          const targetChatId = rawTarget === 'saved' ? storage.getSavedChatId(me.username) : String(rawTarget || '');
          if (!storage.CHAT_ID_REGEX.test(targetChatId)) continue;
          if (targetChatId.startsWith('saved_')) {
            if (targetChatId !== storage.getSavedChatId(me.username)) continue;
            await storage.ensureSavedChatFolder(me.username);
          } else if (groups.isGroupOrChannelId(targetChatId)) {
            const tm = await storage.getChatMeta(targetChatId);
            if (!tm || !tm.participants.includes(me.username)) continue;
          } else {
            const parts = targetChatId.slice(3).split('__');
            if (!parts.includes(me.username)) continue;
            const peer = parts.find((p) => p !== me.username) || parts[0];
            await storage.ensureChatFolder(me.username, peer);
          }

          const createdList = await storage.forwardMessages({
            fromChatId,
            messageIds,
            targetChatId,
            senderUsername: me.username
          });
          for (const item of createdList) {
            forwardedCount.push(item.message.id);
            hub.emitToUsers(item.meta.participants, 'new_message', {
              chatId: targetChatId,
              message: item.message,
              meta: item.meta,
              senderProfile: enrichUser(me)
            });
          }
        }
        auditLogger.log({
          action: 'MESSAGES_FORWARDED',
          username: me.username,
          req,
          details: { fromChatId, targets: targets.join(','), count: forwardedCount.length }
        });
        return sendJson(res, 200, { ok: true, count: forwardedCount.length });
      }

      // Pin or unpin a message at the top of a chat
      const pinMatch = /^\/api\/chats\/([^/]+)\/pin$/.exec(pathname);
      if (method === 'POST' && pinMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = pinMatch[1];
        const body = await readJsonBody(req);
        const resPin = await storage.pinMessage(chatId, body.messageId || null, me.username, Boolean(body.unpin));
        if (!resPin) return sendJson(res, 404, { error: 'Chat or message not found.' });
        auditLogger.log({
          action: 'CHAT_PINNED',
          username: me.username,
          req,
          details: { chatId, messageId: resPin.pinnedMessage ? resPin.pinnedMessage.id : 'unpinned' }
        });
        hub.emitToUsers(resPin.meta.participants, 'chat_pinned', {
          chatId,
          pinnedMessage: resPin.pinnedMessage
        });
        return sendJson(res, 200, { pinnedMessage: resPin.pinnedMessage });
      }

      // Bulk pin/mute/archive chats
      if (method === 'POST' && pathname === '/api/chats/bulk-prefs') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const resBulk = await storage.setUserChatPrefsBulk(me.username, body.chatIds, {
          pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
          muted: typeof body.muted === 'boolean' ? body.muted : undefined,
          archived: typeof body.archived === 'boolean' ? body.archived : undefined
        });
        for (const item of resBulk.items) {
          auditLogger.log({
            action: 'CHAT_PREFS_UPDATED',
            username: me.username,
            req,
            details: {
              chatId: item.chatId,
              isPinned: item.isPinned,
              isMuted: item.isMuted,
              isArchived: item.isArchived
            }
          });
          hub.emitToUser(me.username, 'chat_prefs_updated', item);
        }
        return sendJson(res, 200, resBulk);
      }

      // Bulk delete one or more chats (for self only OR also for other user / everyone)
      if (method === 'POST' && pathname === '/api/chats/bulk-delete') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const forEveryone = Boolean(body.forEveryone);
        const results = await storage.bulkDeleteChats(body.chatIds, me.username, { forEveryone });
        if (results.length === 0) {
          return sendJson(res, 404, { error: 'No matching chats found.' });
        }
        for (const outcome of results) {
          auditLogger.log({
            action: 'CHAT_DELETED',
            username: me.username,
            req,
            details: { chatId: outcome.chatId, forEveryone: outcome.forEveryone }
          });
          hub.emitToUsers(outcome.notifiedUsers, 'chat_deleted', {
            chatId: outcome.chatId,
            forEveryone: outcome.forEveryone,
            by: me.username
          });
          if (Array.isArray(outcome.roomRemainingUsers) && outcome.roomRemainingUsers.length > 0 && outcome.meta) {
            hub.emitToUsers(outcome.roomRemainingUsers, 'chat_updated', {
              chatId: outcome.chatId,
              chat: outcome.meta
            });
          }
        }
        return sendJson(res, 200, { ok: true, deletedChatIds: results.map((r) => r.chatId), forEveryone });
      }

      // Delete single chat (for self only OR also for other user / everyone)
      const deleteChatMatch = /^\/api\/chats\/([^/]+)$/.exec(pathname);
      if (method === 'DELETE' && deleteChatMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = deleteChatMatch[1];
        if (!storage.CHAT_ID_REGEX.test(chatId)) {
          return sendJson(res, 400, { error: 'Invalid chat ID.' });
        }
        const qForEveryone = urlObj.searchParams.get('forEveryone');
        let forEveryone = qForEveryone !== null ? (qForEveryone === '1' || qForEveryone === 'true') : undefined;
        if (forEveryone === undefined) {
          const body = await readJsonBody(req).catch(() => ({}));
          forEveryone = Boolean(body.forEveryone);
        }
        const outcome = await storage.deleteChatForUser(chatId, me.username, { forEveryone });
        if (!outcome) return sendJson(res, 404, { error: 'Chat not found.' });
        auditLogger.log({
          action: 'CHAT_DELETED',
          username: me.username,
          req,
          details: { chatId: outcome.chatId, forEveryone: outcome.forEveryone }
        });
        hub.emitToUsers(outcome.notifiedUsers, 'chat_deleted', {
          chatId: outcome.chatId,
          forEveryone: outcome.forEveryone,
          by: me.username
        });
        if (Array.isArray(outcome.roomRemainingUsers) && outcome.roomRemainingUsers.length > 0 && outcome.meta) {
          hub.emitToUsers(outcome.roomRemainingUsers, 'chat_updated', {
            chatId: outcome.chatId,
            chat: outcome.meta
          });
        }
        return sendJson(res, 200, { ok: true, chatId: outcome.chatId, forEveryone: outcome.forEveryone });
      }

      // Pin/unpin, mute/unmute, or archive/unarchive a chat
      const chatPrefsMatch = /^\/api\/chats\/([^/]+)\/prefs$/.exec(pathname);
      if (method === 'POST' && chatPrefsMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = chatPrefsMatch[1];
        const body = await readJsonBody(req);
        const prefsOut = await storage.setUserChatPref(me.username, chatId, {
          pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
          muted: typeof body.muted === 'boolean' ? body.muted : undefined,
          archived: typeof body.archived === 'boolean' ? body.archived : undefined
        });
        auditLogger.log({
          action: 'CHAT_PREFS_UPDATED',
          username: me.username,
          req,
          details: {
            chatId,
            isPinned: prefsOut.isPinned,
            isMuted: prefsOut.isMuted,
            isArchived: prefsOut.isArchived
          }
        });
        hub.emitToUser(me.username, 'chat_prefs_updated', prefsOut);
        return sendJson(res, 200, prefsOut);
      }

      // View-Once open & burn endpoints
      const viewOnceOpenMatch = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/view-once$/.exec(pathname);
      if (method === 'POST' && viewOnceOpenMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, msgId] = viewOnceOpenMatch;
        const out = await storage.openViewOnceMessage(chatId, msgId, me.username);
        if (!out) return sendJson(res, 404, { error: 'View-Once message not found.' });

        auditLogger.log({
          action: 'MESSAGE_VIEW_ONCE_OPENED',
          username: me.username,
          req,
          details: { chatId, messageId: msgId, immediateBurn: out.immediateBurn }
        });

        // Notify sender & other participants that this View-Once message was opened/consumed
        emitSanitizedMessageEvent(out.meta.participants, 'message_updated', chatId, out.updatedMessage);
        if (!out.immediateBurn) {
          const t = setTimeout(async () => {
            try {
              const burned = await storage.burnViewOnceMessage(chatId, msgId, me.username);
              if (burned && burned.message && burned.meta) {
                emitSanitizedMessageEvent(burned.meta.participants, 'message_updated', chatId, burned.message);
              }
            } catch {
              // Ignore
            }
          }, 65 * 1000);
          if (typeof t.unref === 'function') t.unref();
        }

        return sendJson(res, 200, {
          message: out.revealedMessage,
          consumed: out.immediateBurn
        });
      }

      const viewOnceBurnMatch = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/view-once\/burn$/.exec(pathname);
      if (method === 'POST' && viewOnceBurnMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, msgId] = viewOnceBurnMatch;
        const burned = await storage.burnViewOnceMessage(chatId, msgId, me.username);
        if (!burned) return sendJson(res, 404, { error: 'View-Once message not found.' });
        emitSanitizedMessageEvent(burned.meta.participants, 'message_updated', chatId, burned.message);
        return sendJson(res, 200, {
          ok: true,
          message: storage.sanitizeMessageForViewer(burned.message, me.username)
        });
      }

      // In-Chat Polls & Quizzes
      const chatPollsMatch = /^\/api\/chats\/([^/]+)\/polls$/.exec(pathname);
      if (method === 'POST' && chatPollsMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = chatPollsMatch[1];
        const body = await readJsonBody(req);
        if (!groups.isGroupOrChannelId(chatId)) {
          const parts = chatId.startsWith('dm_') ? chatId.slice(3).split('__') : [];
          if (parts.length === 2 && parts.includes(me.username)) {
            const peer = parts.find((p) => p !== me.username) || parts[0];
            await storage.ensureChatFolder(me.username, peer);
          }
        }
        const { message, meta } = await polls.createPoll({
          chatId,
          creatorUsername: me.username,
          question: body.question,
          options: body.options,
          mode: body.mode,
          multiple: body.multiple,
          anonymous: body.anonymous,
          correctOptionIndex: body.correctOptionIndex,
          explanation: body.explanation
        });
        auditLogger.log({
          action: 'POLL_CREATED',
          username: me.username,
          req,
          details: { chatId, pollId: message.poll.id, mode: message.poll.mode }
        });
        emitSanitizedMessageEvent(meta.participants, 'new_message', chatId, message, {
          meta,
          senderProfile: enrichUser(me)
        });
        dispatchChatPushNotifications(meta, me, message);
        return sendJson(res, 201, {
          message: storage.sanitizeMessageForViewer(message, me.username),
          meta
        });
      }

      const pollVoteMatch = /^\/api\/chats\/([^/]+)\/polls\/([^/]+)\/vote$/.exec(pathname);
      if (method === 'POST' && pollVoteMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, pollId] = pollVoteMatch;
        const body = await readJsonBody(req);
        const { message, meta } = await polls.votePoll({
          chatId,
          pollId,
          voterUsername: me.username,
          optionIndexes: Array.isArray(body.optionIndexes)
            ? body.optionIndexes
            : (body.optionIndex !== undefined ? [body.optionIndex] : [])
        });
        emitSanitizedMessageEvent(meta.participants, 'message_updated', chatId, message);
        return sendJson(res, 200, {
          message: storage.sanitizeMessageForViewer(message, me.username)
        });
      }

      const pollCloseMatch = /^\/api\/chats\/([^/]+)\/polls\/([^/]+)\/close$/.exec(pathname);
      if (method === 'POST' && pollCloseMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, pollId] = pollCloseMatch;
        const { message, meta } = await polls.closePoll({
          chatId,
          pollId,
          requesterUsername: me.username
        });
        emitSanitizedMessageEvent(meta.participants, 'message_updated', chatId, message);
        return sendJson(res, 200, {
          message: storage.sanitizeMessageForViewer(message, me.username)
        });
      }

      // Push Notification Registration & Test Endpoints (Web Push + Android FCM)
      if (method === 'GET' && pathname === '/api/push/config') {
        const me = await requireAuth(req, res);
        if (!me) return;
        return sendJson(res, 200, await pushService.getPublicConfig());
      }

      if (method === 'POST' && pathname === '/api/push/web/subscribe') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const saved = await storage.saveWebPushSubscription(me.username, body.subscription || body);
        if (!saved) return sendJson(res, 400, { error: 'Invalid Web Push subscription.' });
        return sendJson(res, 200, { ok: true, count: saved.webSubscriptions.length });
      }

      if (method === 'POST' && pathname === '/api/push/web/unsubscribe') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        await storage.removeWebPushSubscription(me.username, body.endpoint || '');
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'POST' && pathname === '/api/push/fcm/register') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const saved = await storage.saveFcmToken(me.username, body.token, body.platform || 'android');
        if (!saved) return sendJson(res, 400, { error: 'Valid FCM device token is required.' });
        auditLogger.log({
          action: 'FCM_TOKEN_REGISTERED',
          username: me.username,
          req,
          details: { platform: body.platform || 'android', count: saved.fcmTokens.length }
        });
        return sendJson(res, 200, { ok: true, count: saved.fcmTokens.length });
      }

      if (method === 'POST' && pathname === '/api/push/fcm/unregister') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        await storage.removeFcmToken(me.username, body.token || '');
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'POST' && pathname === '/api/push/test') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const result = await pushService.notifyUser(me.username, {
          title: 'VibeRoom Push Test',
          body: 'Background push notifications are active on this device! 🔔',
          tag: 'vr_push_test',
          urgency: 'high',
          data: { chatId: '', sender: me.username }
        }, { ignoreMute: true });
        return sendJson(res, 200, { ok: true, ...result });
      }

      // Serve uploaded chat image or file (authenticated participants only)
      const fileMatch = /^\/api\/chats\/([^/]+)\/files\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && fileMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, storedName] = fileMatch;
        const viewToken = urlObj.searchParams.get('viewToken') || '';
        const filePath = await storage.getChatFilePath(chatId, storedName, me.username, viewToken);
        if (!filePath) return sendJson(res, 404, { error: 'File not found.' });
        const forceDownload = urlObj.searchParams.get('download') === '1';
        const originalName = storedName.replace(/^[a-f0-9]{16}_/, '');
        auditLogger.log({
          action: 'FILE_ACCESSED',
          username: me.username,
          req,
          details: { chatId, file: originalName, download: forceDownload }
        });
        return serveBinaryFile(res, filePath, originalName, forceDownload);
      }

      // ===================================================================
      // Group Chats & Channels
      // ===================================================================
      if (method === 'POST' && pathname === '/api/groups') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const chat = await groups.createGroupOrChannel({
          creator: me.username,
          type: body.type,
          title: body.title,
          description: body.description,
          memberUsernames: body.members
        });
        auditLogger.log({
          action: 'ROOM_CREATED',
          username: me.username,
          req,
          details: { chatId: chat.id, type: chat.type, title: chat.title, members: (chat.participants || []).join(',') }
        });
        hub.emitToUsers(chat.participants, 'chat_updated', { chatId: chat.id, chat });
        return sendJson(res, 201, { chat });
      }

      if (method === 'POST' && pathname === '/api/groups/join') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const result = await groups.joinByInvite(body.inviteCode, me.username);
        auditLogger.log({
          action: 'ROOM_JOINED_INVITE',
          username: me.username,
          req,
          details: { chatId: result.chat.id, title: result.chat.title }
        });
        hub.emitToUsers(result.chat.participants, 'chat_updated', { chatId: result.chat.id, chat: result.chat });
        return sendJson(res, 200, result);
      }

      const groupPatchMatch = /^\/api\/groups\/([^/]+)$/.exec(pathname);
      if (method === 'PATCH' && groupPatchMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const chat = await groups.updateRoom(groupPatchMatch[1], me.username, body);
        auditLogger.log({
          action: 'ROOM_UPDATED',
          username: me.username,
          req,
          details: { chatId: chat.id, title: chat.title, regeneratedInvite: Boolean(body.regenerateInvite) }
        });
        hub.emitToUsers(chat.participants, 'chat_updated', { chatId: chat.id, chat });
        return sendJson(res, 200, { chat });
      }

      const groupMemberAddMatch = /^\/api\/groups\/([^/]+)\/members$/.exec(pathname);
      if (method === 'POST' && groupMemberAddMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const chat = await groups.addMember(groupMemberAddMatch[1], me.username, body.username);
        auditLogger.log({
          action: 'ROOM_MEMBER_ADDED',
          username: me.username,
          alsoUsers: [body.username],
          req,
          details: { chatId: chat.id, addedUser: body.username }
        });
        hub.emitToUsers(chat.participants, 'chat_updated', { chatId: chat.id, chat });
        return sendJson(res, 200, { chat });
      }

      const groupMemberDelMatch = /^\/api\/groups\/([^/]+)\/members\/([^/]+)$/.exec(pathname);
      if (method === 'DELETE' && groupMemberDelMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, targetUsername] = groupMemberDelMatch;
        const resDel = await groups.removeMember(chatId, me.username, targetUsername);
        auditLogger.log({
          action: resDel.removedUsername === me.username ? 'ROOM_LEFT' : 'ROOM_MEMBER_REMOVED',
          username: me.username,
          alsoUsers: [resDel.removedUsername],
          req,
          details: { chatId, targetUser: resDel.removedUsername }
        });
        if (resDel.chat && Array.isArray(resDel.chat.participants)) {
          hub.emitToUsers(resDel.chat.participants, 'chat_updated', { chatId, chat: resDel.chat });
        }
        hub.emitToUser(resDel.removedUsername, 'chat_removed', { chatId });
        return sendJson(res, 200, { chat: resDel.chat, ok: true });
      }

      const groupAdminsMatch = /^\/api\/groups\/([^/]+)\/admins$/.exec(pathname);
      if (method === 'POST' && groupAdminsMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const chat = await groups.setMemberAdmin(
          groupAdminsMatch[1],
          me.username,
          body.username,
          Boolean(body.isAdmin)
        );
        auditLogger.log({
          action: 'ROOM_ADMIN_CHANGED',
          username: me.username,
          alsoUsers: [body.username],
          req,
          details: { chatId: chat.id, targetUser: body.username, isAdmin: Boolean(body.isAdmin) }
        });
        hub.emitToUsers(chat.participants, 'chat_updated', { chatId: chat.id, chat });
        return sendJson(res, 200, { chat });
      }

      // ===================================================================
      // Playable Chat Mini-Games
      // ===================================================================
      if (method === 'GET' && pathname === '/api/games/leaderboard') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const relList = await friends.listFriendsData(me.username);
        const friendUsernames = Array.isArray(relList.friends) ? relList.friends.map((f) => f.username) : [];
        const board = await storage.getGameLeaderboard(me.username, friendUsernames);
        return sendJson(res, 200, board);
      }

      const gameCreateMatch = /^\/api\/chats\/([^/]+)\/games$/.exec(pathname);
      if (method === 'POST' && gameCreateMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chatId = gameCreateMatch[1];
        const body = await readJsonBody(req);
        if (!groups.isGroupOrChannelId(chatId)) {
          const parts = chatId.startsWith('dm_') ? chatId.slice(3).split('__') : [];
          if (parts.length === 2 && parts.includes(me.username)) {
            const peer = parts.find((p) => p !== me.username) || parts[0];
            await storage.ensureChatFolder(me.username, peer);
          }
        }
        const { message, meta } = await games.createGame({
          chatId,
          creatorUsername: me.username,
          gameType: body.gameType,
          opponentUsername: body.opponentUsername
        });
        auditLogger.log({
          action: 'GAME_STARTED',
          username: me.username,
          req,
          details: { chatId, gameId: message.game.id, type: message.game.type, players: message.game.players.join(',') }
        });
        hub.emitToUsers(meta.participants, 'new_message', {
          chatId,
          message,
          meta,
          senderProfile: enrichUser(me)
        });
        dispatchChatPushNotifications(meta, me, message);
        return sendJson(res, 201, { message, meta });
      }

      const gameMoveMatch = /^\/api\/chats\/([^/]+)\/games\/([^/]+)\/move$/.exec(pathname);
      if (method === 'POST' && gameMoveMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, gameId] = gameMoveMatch;
        const body = await readJsonBody(req);
        const { message, meta } = await games.makeMove({
          chatId,
          gameId,
          playerUsername: me.username,
          move: body.move || body
        });
        auditLogger.log({
          action: 'GAME_MOVE',
          username: me.username,
          req,
          details: { chatId, gameId, status: message.game.status, winner: message.game.winner }
        });
        hub.emitToUsers(meta.participants, 'message_updated', {
          chatId,
          message
        });
        return sendJson(res, 200, { message });
      }

      const gameCancelMatch = /^\/api\/chats\/([^/]+)\/games\/([^/]+)\/cancel$/.exec(pathname);
      if (method === 'POST' && gameCancelMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, gameId] = gameCancelMatch;
        const { message, meta } = await games.cancelGame({
          chatId,
          gameId,
          requesterUsername: me.username
        });
        auditLogger.log({
          action: 'GAME_CANCELLED',
          username: me.username,
          req,
          details: { chatId, gameId }
        });
        hub.emitToUsers(meta.participants, 'message_updated', {
          chatId,
          message
        });
        return sendJson(res, 200, { message });
      }

      // ===================================================================
      // Anonymous Random Chat ("Stranger Lounge")
      // ===================================================================
      if (method === 'GET' && pathname === '/api/stranger/status') {
        const me = await requireAuth(req, res);
        if (!me) return;
        return sendJson(res, 200, stranger.getStatus(me.username));
      }

      if (method === 'POST' && pathname === '/api/stranger/meet') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const out = stranger.joinQueue(me.username, body);
        auditLogger.log({
          action: out.status === 'matched' ? 'STRANGER_MATCHED' : 'STRANGER_QUEUE_JOIN',
          username: me.username,
          req,
          details: {
            language: body.language || 'any',
            interests: Array.isArray(body.interests) ? body.interests.join(',') : '',
            sessionId: out.session ? out.session.sessionId : undefined,
            myAlias: out.session ? out.session.myAlias : undefined
          }
        });
        return sendJson(res, 200, out);
      }

      if (method === 'POST' && pathname === '/api/stranger/cancel') {
        const me = await requireAuth(req, res);
        if (!me) return;
        auditLogger.log({ action: 'STRANGER_QUEUE_CANCEL', username: me.username, req });
        return sendJson(res, 200, stranger.cancelSearch(me.username));
      }

      if (method === 'POST' && pathname === '/api/stranger/message') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const msg = stranger.sendMessage(me.username, body.text);
        auditLogger.log({
          action: 'STRANGER_MESSAGE',
          username: me.username,
          req,
          details: { alias: msg.senderAlias, text: msg.text ? msg.text.slice(0, 160) : '' }
        });
        return sendJson(res, 201, { message: msg });
      }

      if (method === 'POST' && pathname === '/api/stranger/typing') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        stranger.sendTyping(me.username, body.isTyping);
        return sendJson(res, 200, { ok: true });
      }

      if (method === 'POST' && pathname === '/api/stranger/next') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        auditLogger.log({ action: 'STRANGER_SKIP', username: me.username, req, details: { autoRequeue: Boolean(body.autoRequeue) } });
        return sendJson(res, 200, stranger.skipChat(me.username, body));
      }

      if (method === 'POST' && pathname === '/api/stranger/reveal') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const result = await stranger.requestReveal(me.username);
        auditLogger.log({
          action: result.revealed ? 'STRANGER_MUTUAL_REVEAL' : 'STRANGER_REVEAL_REQUESTED',
          username: me.username,
          alsoUsers: result.friend ? [result.friend.username] : [],
          req,
          details: { revealed: Boolean(result.revealed), friend: result.friend ? result.friend.username : undefined }
        });
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && pathname === '/api/stranger/report') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const rep = stranger.reportPartner(me.username, body.reason);
        auditLogger.log({
          action: 'STRANGER_REPORTED',
          username: me.username,
          alsoUsers: rep.reported ? [rep.reported] : [],
          req,
          details: { reportedUser: rep.reported || 'none', reason: rep.reason }
        });
        return sendJson(res, 200, { ok: true, status: 'idle' });
      }

      // ===================================================================
      // Audio & Video Calling (WebRTC Signaling)
      // ===================================================================
      if (method === 'GET' && pathname === '/api/calls/config') {
        const me = await requireAuth(req, res);
        if (!me) return;
        return sendJson(res, 200, { iceServers: calls.getIceServers() });
      }

      if (method === 'POST' && pathname === '/api/calls/start') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const target = String(body.targetUsername || '').trim().toLowerCase();
        if (target) {
          const blk = await storage.getBlockStatus(me.username, target);
          if (blk.anyBlocked) {
            return sendJson(res, 403, { error: 'Calls are disabled because one of you has blocked the other.' });
          }
        }
        const result = await calls.startCall({
          callerUsername: me.username,
          targetUsername: body.targetUsername,
          mode: body.mode,
          chatId: body.chatId
        });
        auditLogger.log({
          action: 'CALL_STARTED',
          username: me.username,
          alsoUsers: [result.call.callee],
          req,
          details: { callId: result.call.id, target: result.call.callee, mode: result.call.mode }
        });
        pushService.notifyUser(result.call.callee, {
          title: `Incoming ${result.call.mode === 'video' ? 'Video' : 'Audio'} Call`,
          body: `${me.displayName || me.username} is calling you on VibeRoom`,
          tag: `call_${result.call.id}`,
          urgency: 'high',
          data: { chatId: result.call.chatId || '', sender: me.username, type: 'call' }
        }, { chatId: result.call.chatId || null }).catch(() => {});
        return sendJson(res, 201, result);
      }

      const callActionMatch = /^\/api\/calls\/([^/]+)\/(accept|signal|decline|end)$/.exec(pathname);
      if (method === 'POST' && callActionMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, callId, action] = callActionMatch;
        const body = await readJsonBody(req);
        if (action === 'accept') {
          const out = calls.acceptCall(callId, me.username);
          auditLogger.log({ action: 'CALL_ACCEPTED', username: me.username, req, details: { callId } });
          return sendJson(res, 200, out);
        }
        if (action === 'signal') return sendJson(res, 200, calls.relaySignal(callId, me.username, body));
        if (action === 'decline') {
          const out = await calls.declineCall(callId, me.username);
          auditLogger.log({ action: 'CALL_DECLINED_BY_USER', username: me.username, req, details: { callId } });
          return sendJson(res, 200, out);
        }
        if (action === 'end') {
          const out = await calls.endCall(callId, me.username, body.reason || 'hangup');
          auditLogger.log({ action: 'CALL_ENDED_BY_USER', username: me.username, req, details: { callId, reason: body.reason || 'hangup' } });
          return sendJson(res, 200, out);
        }
      }

      // SSE Real-time Event Stream
      if (method === 'GET' && pathname === '/api/events') {
        const me = await requireAuth(req, res);
        if (!me) return;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });

        const conn = hub.addClient(me.username, res);
        const sseClientCtx = auditLogger.extractClientContext(req);
        const sseConnectedAt = Date.now();
        auditLogger.log({
          action: 'SSE_CONNECTED',
          username: me.username,
          client: sseClientCtx
        });
        hub.sendEvent(res, 'connected', {
          username: me.username,
          onlineUsers: await getVisibleOnlineUsers(me.username)
        });

        if (conn.wasOffline) {
          const nowIso = new Date().toISOString();
          await storage.updateLastSeen(me.username);
          await emitPresenceRespectingPrivacy(me.username, true, nowIso);
        }

        req.on('close', async () => {
          const becameOffline = conn.remove();
          auditLogger.log({
            action: 'SSE_DISCONNECTED',
            username: me.username,
            client: sseClientCtx,
            details: { sessionSec: Math.round((Date.now() - sseConnectedAt) / 1000) }
          });
          if (becameOffline) {
            stranger.onUserDisconnect(me.username);
            calls.onUserDisconnect(me.username);
            await storage.updateLastSeen(me.username).catch(() => { });
            await emitPresenceRespectingPrivacy(me.username, false, new Date().toISOString());
          }
        });
        return;
      }

      // Serve frontend static assets
      if (method === 'GET') {
        const served = await serveStatic(pathname, urlObj, res);
        if (served) return;
      }

      sendJson(res, 404, { error: 'Not found.' });
    } catch (err) {
      const status = err.statusCode || 500;
      const sess = auth.getSessionUser(req);
      auditLogger.log({
        action: status >= 500 ? 'SERVER_ERROR' : 'HTTP_REJECTED',
        username: sess ? sess.username : null,
        req,
        details: { method, path: pathname, status, error: err.message }
      });
      if (status >= 500) {
        console.error('[VibeRoom Error]', err);
      }
      if (!res.headersSent) {
        sendJson(
          res,
          status,
          { error: err.message || 'Internal server error.' },
          status === 413 ? { Connection: 'close' } : {}
        );
      }
    }
  };
}

module.exports = { createRouter };
