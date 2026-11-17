const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseMultipart, readBodyBuffer } = require('./multipart');
const { createMailer } = require('./mailer');
const { createGroupService } = require('./groups');
const { createStrangerService } = require('./stranger');
const { createGamesService } = require('./games');
const { createCallsService } = require('./calls');

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
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
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

function createRouter({ config, auth, storage, hub, mailer }) {
  const mailService = mailer || createMailer(config);
  const groups = createGroupService({ config, storage });
  const stranger = createStrangerService({ hub, storage });
  const games = createGamesService({ storage });
  const calls = createCallsService({ hub, storage });
  async function requireAuth(req, res) {
    const session = auth.getSessionUser(req);
    if (!session) {
      sendJson(res, 401, { error: 'Authentication required.' });
      return null;
    }
    const user = await storage.getUserByUsername(session.username);
    if (!user) {
      sendJson(res, 401, { error: 'Session expired or user no longer exists.' });
      return null;
    }
    return storage.toPublicUser(user);
  }

  function enrichUser(user) {
    if (!user) return null;
    return { ...user, online: hub.isOnline(user.username) };
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
        const user = await storage.authenticateUser(body.identifier || body.email || body.username, body.password);
        if (!user) {
          return sendJson(res, 401, { error: 'Invalid username/email or password.' });
        }
        const cookie = auth.createSessionCookie(user.username);
        return sendJson(res, 200, { user: enrichUser(user) }, { 'Set-Cookie': cookie });
      }

      // Auth: Logout
      if (method === 'POST' && pathname === '/api/auth/logout') {
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearSessionCookie() });
      }

      // Auth: Current user
      if (method === 'GET' && pathname === '/api/auth/me') {
        const me = await requireAuth(req, res);
        if (!me) return;
        return sendJson(res, 200, { user: enrichUser(me) });
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
          hub.renameUser(result.previousUsername, result.user.username);
          extraHeaders['Set-Cookie'] = auth.createSessionCookie(result.user.username);
        }
        const enriched = enrichUser(result.user);
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
        hub.broadcastAll('profile_updated', { user: enriched });
        return sendJson(res, 200, { user: enriched });
      }

      // Remove avatar
      if (method === 'DELETE' && pathname === '/api/users/me/avatar') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const updated = await storage.removeUserAvatar(me.username);
        const enriched = enrichUser(updated);
        hub.broadcastAll('profile_updated', { user: enriched });
        return sendJson(res, 200, { user: enriched });
      }

      // Serve user avatar
      const avatarMatch = /^\/api\/users\/([^/]+)\/avatar\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && avatarMatch) {
        const [, targetUsername, filename] = avatarMatch;
        const filePath = await storage.getUserAvatarPath(targetUsername, filename);
        if (!filePath) return sendJson(res, 404, { error: 'Avatar not found.' });
        return serveBinaryFile(res, filePath, filename, false);
      }

      // Search users by email or username
      if (method === 'GET' && pathname === '/api/users/search') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const q = urlObj.searchParams.get('q') || '';
        const users = await storage.searchUsers(q, me.username);
        return sendJson(res, 200, { users: users.map(enrichUser) });
      }

      // List active chats (DMs, Groups, and Channels)
      if (method === 'GET' && pathname === '/api/chats') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const chats = await storage.listChatsForUser(me.username);
        const enriched = chats.map((c) => ({
          ...c,
          peer: c.peer ? enrichUser(c.peer) : null
        }));
        return sendJson(res, 200, { chats: enriched });
      }

      // Open or preview a DM chat OR open an existing group/channel
      if (method === 'POST' && pathname === '/api/chats/open') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        if (body.chatId && groups.isGroupOrChannelId(body.chatId)) {
          const opened = await groups.openRoom(body.chatId, me.username);
          return sendJson(res, 200, opened);
        }

        const targetUsername = String(body.targetUsername || '').trim().toLowerCase();
        if (!targetUsername || targetUsername === me.username) {
          return sendJson(res, 400, { error: 'Invalid target user.' });
        }
        const targetRaw = await storage.getUserByUsername(targetUsername);
        if (!targetRaw) {
          return sendJson(res, 404, { error: 'User not found.' });
        }
        const peer = enrichUser(storage.toPublicUser(targetRaw));
        const chatId = storage.getDmChatId(me.username, targetUsername);
        const existingMeta = await storage.getChatMeta(chatId);

        if (!existingMeta) {
          return sendJson(res, 200, {
            chat: {
              id: chatId,
              type: 'dm',
              participants: [me.username, targetUsername].sort(),
              peer,
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
        let files = [];

        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
          const buf = await readBodyBuffer(req, config.maxUploadBytes);
          const parsed = parseMultipart(buf, contentType);
          text = parsed.fields.text || '';
          replyToId = parsed.fields.replyToId || null;
          files = parsed.files;
        } else {
          const body = await readJsonBody(req);
          text = body.text || '';
          replyToId = body.replyToId || null;
        }

        if (groups.isGroupOrChannelId(chatId)) {
          const existingMeta = await storage.getChatMeta(chatId);
          if (!existingMeta || !existingMeta.participants.includes(me.username)) {
            return sendJson(res, 404, { error: 'Room not found.' });
          }
        } else {
          const parts = chatId.slice(3).split('__');
          if (!parts.includes(me.username)) {
            return sendJson(res, 403, { error: 'Forbidden.' });
          }
          const peerUsername = parts.find((p) => p !== me.username) || parts[0];
          await storage.ensureChatFolder(me.username, peerUsername);
        }

        const { message, meta } = await storage.appendChatMessage(chatId, me.username, {
          text,
          files,
          replyToId
        });

        await storage.updateLastSeen(me.username);
        hub.emitToUsers(meta.participants, 'new_message', {
          chatId,
          message,
          meta,
          senderProfile: enrichUser(me)
        });

        return sendJson(res, 201, { message, meta });
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
        hub.emitToUsers(result.meta.participants, 'message_updated', {
          chatId,
          message: result.message
        });
        return sendJson(res, 200, { message: result.message });
      }

      // Delete own message
      const deleteMatch = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)$/.exec(pathname);
      if (method === 'DELETE' && deleteMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, messageId] = deleteMatch;
        const result = await storage.deleteMessage(chatId, messageId, me.username);
        if (!result) return sendJson(res, 404, { error: 'Message not found.' });
        hub.emitToUsers(result.meta.participants, 'message_deleted', {
          chatId,
          messageId: result.deletedId,
          meta: result.meta
        });
        return sendJson(res, 200, { ok: true });
      }

      // Serve uploaded chat image or file (authenticated participants only)
      const fileMatch = /^\/api\/chats\/([^/]+)\/files\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && fileMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, storedName] = fileMatch;
        const filePath = await storage.getChatFilePath(chatId, storedName, me.username);
        if (!filePath) return sendJson(res, 404, { error: 'File not found.' });
        const forceDownload = urlObj.searchParams.get('download') === '1';
        const originalName = storedName.replace(/^[a-f0-9]{16}_/, '');
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
        hub.emitToUsers(chat.participants, 'chat_updated', { chatId: chat.id, chat });
        return sendJson(res, 201, { chat });
      }

      if (method === 'POST' && pathname === '/api/groups/join') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const result = await groups.joinByInvite(body.inviteCode, me.username);
        hub.emitToUsers(result.chat.participants, 'chat_updated', { chatId: result.chat.id, chat: result.chat });
        return sendJson(res, 200, result);
      }

      const groupPatchMatch = /^\/api\/groups\/([^/]+)$/.exec(pathname);
      if (method === 'PATCH' && groupPatchMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const chat = await groups.updateRoom(groupPatchMatch[1], me.username, body);
        hub.emitToUsers(chat.participants, 'chat_updated', { chatId: chat.id, chat });
        return sendJson(res, 200, { chat });
      }

      const groupMemberAddMatch = /^\/api\/groups\/([^/]+)\/members$/.exec(pathname);
      if (method === 'POST' && groupMemberAddMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        const chat = await groups.addMember(groupMemberAddMatch[1], me.username, body.username);
        hub.emitToUsers(chat.participants, 'chat_updated', { chatId: chat.id, chat });
        return sendJson(res, 200, { chat });
      }

      const groupMemberDelMatch = /^\/api\/groups\/([^/]+)\/members\/([^/]+)$/.exec(pathname);
      if (method === 'DELETE' && groupMemberDelMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, chatId, targetUsername] = groupMemberDelMatch;
        const resDel = await groups.removeMember(chatId, me.username, targetUsername);
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
        hub.emitToUsers(chat.participants, 'chat_updated', { chatId: chat.id, chat });
        return sendJson(res, 200, { chat });
      }

      // ===================================================================
      // Playable Chat Mini-Games
      // ===================================================================
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
        hub.emitToUsers(meta.participants, 'new_message', {
          chatId,
          message,
          meta,
          senderProfile: enrichUser(me)
        });
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
        return sendJson(res, 200, stranger.joinQueue(me.username, body));
      }

      if (method === 'POST' && pathname === '/api/stranger/cancel') {
        const me = await requireAuth(req, res);
        if (!me) return;
        return sendJson(res, 200, stranger.cancelSearch(me.username));
      }

      if (method === 'POST' && pathname === '/api/stranger/message') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        return sendJson(res, 201, { message: stranger.sendMessage(me.username, body.text) });
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
        return sendJson(res, 200, stranger.skipChat(me.username, body));
      }

      if (method === 'POST' && pathname === '/api/stranger/reveal') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const result = await stranger.requestReveal(me.username);
        return sendJson(res, 200, result);
      }

      if (method === 'POST' && pathname === '/api/stranger/report') {
        const me = await requireAuth(req, res);
        if (!me) return;
        const body = await readJsonBody(req);
        return sendJson(res, 200, stranger.reportPartner(me.username, body.reason));
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
        const result = await calls.startCall({
          callerUsername: me.username,
          targetUsername: body.targetUsername,
          mode: body.mode,
          chatId: body.chatId
        });
        return sendJson(res, 201, result);
      }

      const callActionMatch = /^\/api\/calls\/([^/]+)\/(accept|signal|decline|end)$/.exec(pathname);
      if (method === 'POST' && callActionMatch) {
        const me = await requireAuth(req, res);
        if (!me) return;
        const [, callId, action] = callActionMatch;
        const body = await readJsonBody(req);
        if (action === 'accept') return sendJson(res, 200, calls.acceptCall(callId, me.username));
        if (action === 'signal') return sendJson(res, 200, calls.relaySignal(callId, me.username, body));
        if (action === 'decline') return sendJson(res, 200, calls.declineCall(callId, me.username));
        if (action === 'end') return sendJson(res, 200, calls.endCall(callId, me.username, body.reason || 'hangup'));
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
        hub.sendEvent(res, 'connected', {
          username: me.username,
          onlineUsers: hub.getOnlineUsernames()
        });

        if (conn.wasOffline) {
          await storage.updateLastSeen(me.username);
          hub.broadcastAll('presence', {
            username: me.username,
            online: true,
            lastSeen: new Date().toISOString()
          });
        }

        req.on('close', async () => {
          const becameOffline = conn.remove();
          if (becameOffline) {
            stranger.onUserDisconnect(me.username);
            calls.onUserDisconnect(me.username);
            await storage.updateLastSeen(me.username).catch(() => { });
            hub.broadcastAll('presence', {
              username: me.username,
              online: false,
              lastSeen: new Date().toISOString()
            });
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
