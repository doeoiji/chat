const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateEmail } = require('./emailValidator');
const { hashPassword, verifyPassword } = require('./auth');

const USERNAME_REGEX = /^[a-z0-9_]{3,24}$/;
const CHAT_ID_REGEX = /^(?:dm_[a-z0-9_]{3,24}__[a-z0-9_]{3,24}|(?:grp|chn)_[a-z0-9]{10,24})$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractMentions(text) {
  if (typeof text !== 'string' || !text.includes('@')) return [];
  const found = new Set();
  for (const m of text.matchAll(/(?:^|\s)@([a-z0-9_]{3,24})\b/gi)) {
    found.add(m[1].toLowerCase());
  }
  return Array.from(found);
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #5288C1 0%, #3A6EA5 100%)',
  'linear-gradient(135deg, #E17076 0%, #C04D54 100%)',
  'linear-gradient(135deg, #7BC862 0%, #52A23B 100%)',
  'linear-gradient(135deg, #E5A04C 0%, #C77A28 100%)',
  'linear-gradient(135deg, #9B7CEB 0%, #7254C4 100%)',
  'linear-gradient(135deg, #4AB8D8 0%, #2C8EAD 100%)',
  'linear-gradient(135deg, #E56FA8 0%, #BF4783 100%)'
];

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\-() ]+/g, '_').trim();
  if (!base || base === '.' || base === '..') return 'file';
  return base.slice(0, 120);
}

function normalizeBirthday(input) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    const err = new Error('Please enter a valid birthday date (YYYY-MM-DD).');
    err.statusCode = 400;
    throw err;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day ||
    year < 1900 ||
    d.getTime() > Date.now()
  ) {
    const err = new Error('Please enter a valid birthday date.');
    err.statusCode = 400;
    throw err;
  }
  return raw;
}

function getDmChatId(userA, userB) {
  const a = String(userA).trim().toLowerCase();
  const b = String(userB).trim().toLowerCase();
  if (!USERNAME_REGEX.test(a) || !USERNAME_REGEX.test(b)) {
    throw new Error('Invalid username for chat.');
  }
  const sorted = [a, b].sort();
  return `dm_${sorted[0]}__${sorted[1]}`;
}

function isImageMime(mimeType, filename) {
  if (typeof mimeType === 'string' && mimeType.startsWith('image/')) {
    return mimeType !== 'image/svg+xml'; // treat SVG as downloadable file for XSS safety
  }
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(filename || '');
}

function createStorage(config) {
  fs.mkdirSync(config.usersDir, { recursive: true });
  fs.mkdirSync(config.chatsDir, { recursive: true });
  fs.mkdirSync(config.pendingDir, { recursive: true });

  // Per-key async lock queue to prevent concurrent read-modify-write races
  const queues = new Map();
  function withLock(key, fn) {
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {}).finally(() => {
      if (queues.get(key) === tail) {
        queues.delete(key);
      }
    });
    queues.set(key, tail);
    return next;
  }

  function userFolder(username) {
    const clean = String(username || '').trim().toLowerCase();
    if (!USERNAME_REGEX.test(clean)) return null;
    const resolved = path.resolve(config.usersDir, clean);
    if (!resolved.startsWith(path.resolve(config.usersDir) + path.sep)) return null;
    return resolved;
  }

  function chatFolder(chatId) {
    if (!CHAT_ID_REGEX.test(String(chatId || ''))) return null;
    const resolved = path.resolve(config.chatsDir, chatId);
    if (!resolved.startsWith(path.resolve(config.chatsDir) + path.sep)) return null;
    return resolved;
  }

  async function readJson(filePath, fallback = null) {
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err && err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  async function writeJsonAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmpPath, filePath);
  }

  function toPublicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      email: user.email,
      emailVerified: Boolean(user.emailVerified),
      bio: user.bio || '',
      birthday: user.birthday || null,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl || null,
      createdAt: user.createdAt,
      lastSeen: user.lastSeen
    };
  }

  function maskEmail(email) {
    const [local, domain] = String(email || '').split('@');
    if (!local || !domain) return email;
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}***@${domain}`;
  }

  function hashVerificationCode(verificationId, code) {
    return crypto
      .createHmac('sha256', config.sessionSecret || 'telechat-otp-secret')
      .update(`${verificationId}:${code}`)
      .digest('hex');
  }

  function pendingFilePath(verificationId) {
    if (!UUID_REGEX.test(String(verificationId || ''))) return null;
    const resolved = path.resolve(config.pendingDir, `${verificationId}.json`);
    if (!resolved.startsWith(path.resolve(config.pendingDir) + path.sep)) return null;
    return resolved;
  }

  async function listActivePending() {
    const entries = await fsp.readdir(config.pendingDir, { withFileTypes: true });
    const now = Date.now();
    const active = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const fullPath = path.join(config.pendingDir, entry.name);
      const item = await readJson(fullPath);
      if (!item || typeof item.expiresAt !== 'number' || now > item.expiresAt) {
        await fsp.unlink(fullPath).catch(() => {});
        continue;
      }
      active.push({ item, fullPath });
    }
    return active;
  }

  async function listAllUsers() {
    const entries = await fsp.readdir(config.usersDir, { withFileTypes: true });
    const users = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profilePath = path.join(config.usersDir, entry.name, 'profile.json');
      const profile = await readJson(profilePath);
      if (profile && profile.username) {
        users.push(profile);
      }
    }
    return users;
  }

  async function getUserByUsername(username) {
    const folder = userFolder(username);
    if (!folder) return null;
    return readJson(path.join(folder, 'profile.json'));
  }

  async function getUserByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return null;
    const users = await listAllUsers();
    return users.find((u) => u.email === normalized) || null;
  }

  async function createUser({ username, email, password, displayName }) {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!USERNAME_REGEX.test(cleanUsername)) {
      const err = new Error('Username must be 3–24 characters using only letters, numbers, and underscores.');
      err.statusCode = 400;
      throw err;
    }

    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      const err = new Error(emailCheck.reason);
      err.statusCode = 400;
      throw err;
    }

    if (typeof password !== 'string' || password.length < 6) {
      const err = new Error('Password must be at least 6 characters long.');
      err.statusCode = 400;
      throw err;
    }
    if (password.length > 128) {
      const err = new Error('Password must be 128 characters or fewer.');
      err.statusCode = 400;
      throw err;
    }

    return withLock('users:registry', async () => {
      const existingByUsername = await getUserByUsername(cleanUsername);
      if (existingByUsername) {
        const err = new Error('That username is already taken.');
        err.statusCode = 409;
        throw err;
      }

      const existingByEmail = await getUserByEmail(emailCheck.normalized);
      if (existingByEmail) {
        const err = new Error('An account with this email already exists.');
        err.statusCode = 409;
        throw err;
      }

      const folder = userFolder(cleanUsername);
      await fsp.mkdir(path.join(folder, 'uploads'), { recursive: true });

      const cleanDisplay = typeof displayName === 'string' && displayName.trim()
        ? displayName.trim().slice(0, 48)
        : cleanUsername;

      const colorIndex = Math.abs(
        cleanUsername.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
      ) % AVATAR_GRADIENTS.length;

      const now = new Date().toISOString();
      const user = {
        id: `usr_${crypto.randomUUID()}`,
        username: cleanUsername,
        displayName: cleanDisplay,
        email: emailCheck.normalized,
        emailVerified: true,
        verifiedAt: now,
        passwordHash: hashPassword(password),
        bio: '',
        avatarColor: AVATAR_GRADIENTS[colorIndex],
        avatarUrl: null,
        createdAt: now,
        lastSeen: now
      };

      await writeJsonAtomic(path.join(folder, 'profile.json'), user);
      return toPublicUser(user);
    });
  }

  function validateSignupFields({ username, email, password, displayName }) {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!USERNAME_REGEX.test(cleanUsername)) {
      const err = new Error('Username must be 3–24 characters using only letters, numbers, and underscores.');
      err.statusCode = 400;
      throw err;
    }

    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      const err = new Error(emailCheck.reason);
      err.statusCode = 400;
      throw err;
    }

    if (typeof password !== 'string' || password.length < 6) {
      const err = new Error('Password must be at least 6 characters long.');
      err.statusCode = 400;
      throw err;
    }
    if (password.length > 128) {
      const err = new Error('Password must be 128 characters or fewer.');
      err.statusCode = 400;
      throw err;
    }

    const cleanDisplay = typeof displayName === 'string' && displayName.trim()
      ? displayName.trim().slice(0, 48)
      : cleanUsername;

    return { cleanUsername, email: emailCheck.normalized, password, cleanDisplay };
  }

  function getResendCooldownMs(resendCount) {
    return config.verificationResendCooldownMs + (resendCount * config.verificationResendStepMs);
  }

  function formatWaitDuration(ms) {
    const totalSec = Math.max(1, Math.ceil(ms / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins > 0 && secs > 0) return `${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m`;
    return `${secs}s`;
  }

  async function createPendingRegistration(input) {
    const { cleanUsername, email, password, cleanDisplay } = validateSignupFields(input);

    return withLock('users:registry', async () => {
      const existingByUsername = await getUserByUsername(cleanUsername);
      if (existingByUsername) {
        const err = new Error('That username is already taken.');
        err.statusCode = 409;
        throw err;
      }

      const existingByEmail = await getUserByEmail(email);
      if (existingByEmail) {
        const err = new Error('An account with this email already exists.');
        err.statusCode = 409;
        throw err;
      }

      const nowMs = Date.now();
      let priorResendCount = -1;
      const activePending = await listActivePending();
      for (const { item, fullPath } of activePending) {
        if (item.email === email) {
          if (typeof item.nextResendAt === 'number' && nowMs < item.nextResendAt) {
            const err = new Error(`Please wait ${formatWaitDuration(item.nextResendAt - nowMs)} before requesting another code.`);
            err.statusCode = 429;
            throw err;
          }
          priorResendCount = typeof item.resendCount === 'number' ? item.resendCount : 0;
          await fsp.unlink(fullPath).catch(() => {});
        } else if (item.username === cleanUsername) {
          const err = new Error('That username is currently awaiting email verification.');
          err.statusCode = 409;
          throw err;
        }
      }

      const verificationId = crypto.randomUUID();
      const code = String(crypto.randomInt(100000, 1000000));
      const resendCount = priorResendCount >= 0 ? priorResendCount + 1 : 0;
      const cooldownMs = getResendCooldownMs(resendCount);
      const codeExpiresAt = nowMs + config.verificationTtlMs;
      const nextResendAt = nowMs + cooldownMs;

      const record = {
        verificationId,
        username: cleanUsername,
        displayName: cleanDisplay,
        email,
        passwordHash: hashPassword(password),
        codeHash: hashVerificationCode(verificationId, code),
        attempts: 0,
        maxAttempts: 5,
        resendCount,
        createdAt: new Date(nowMs).toISOString(),
        lastSentAt: nowMs,
        codeExpiresAt,
        nextResendAt,
        expiresAt: nowMs + config.verificationSessionTtlMs
      };

      await writeJsonAtomic(pendingFilePath(verificationId), record);

      return {
        verificationId,
        username: cleanUsername,
        email,
        maskedEmail: maskEmail(email),
        code,
        resendCount,
        codeExpiresAt,
        nextResendAt,
        resendCooldownSeconds: Math.ceil(cooldownMs / 1000)
      };
    });
  }

  async function resendPendingRegistration(verificationId) {
    const filePath = pendingFilePath(verificationId);
    if (!filePath) {
      const err = new Error('Invalid verification session.');
      err.statusCode = 400;
      throw err;
    }

    return withLock('users:registry', async () => {
      const record = await readJson(filePath);
      if (!record) {
        const err = new Error('Verification session not found or expired. Please register again.');
        err.statusCode = 404;
        throw err;
      }
      const nowMs = Date.now();
      if (nowMs > record.expiresAt) {
        await fsp.unlink(filePath).catch(() => {});
        const err = new Error('Verification session has expired. Please register again.');
        err.statusCode = 400;
        throw err;
      }

      const nextAllowedAt = typeof record.nextResendAt === 'number'
        ? record.nextResendAt
        : (record.lastSentAt || 0) + getResendCooldownMs(record.resendCount || 0);

      if (nowMs < nextAllowedAt) {
        const err = new Error(`Please wait ${formatWaitDuration(nextAllowedAt - nowMs)} before requesting another code.`);
        err.statusCode = 429;
        throw err;
      }

      const nextResendCount = (record.resendCount || 0) + 1;
      const cooldownMs = getResendCooldownMs(nextResendCount);
      const code = String(crypto.randomInt(100000, 1000000));

      record.codeHash = hashVerificationCode(verificationId, code);
      record.attempts = 0;
      record.resendCount = nextResendCount;
      record.lastSentAt = nowMs;
      record.codeExpiresAt = nowMs + config.verificationTtlMs;
      record.nextResendAt = nowMs + cooldownMs;
      record.expiresAt = Math.max(record.expiresAt, nowMs + config.verificationSessionTtlMs);

      await writeJsonAtomic(filePath, record);

      return {
        verificationId,
        username: record.username,
        email: record.email,
        maskedEmail: maskEmail(record.email),
        code,
        resendCount: nextResendCount,
        codeExpiresAt: record.codeExpiresAt,
        nextResendAt: record.nextResendAt,
        resendCooldownSeconds: Math.ceil(cooldownMs / 1000)
      };
    });
  }

  async function verifyPendingRegistration(verificationId, codeInput) {
    const filePath = pendingFilePath(verificationId);
    if (!filePath) {
      const err = new Error('Invalid verification session.');
      err.statusCode = 400;
      throw err;
    }

    const cleanCode = String(codeInput || '').trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      const err = new Error('Please enter the 6-digit verification code.');
      err.statusCode = 400;
      throw err;
    }

    return withLock('users:registry', async () => {
      const record = await readJson(filePath);
      if (!record) {
        const err = new Error('Verification session not found or expired. Please register again.');
        err.statusCode = 400;
        throw err;
      }

      const nowMs = Date.now();
      if (nowMs > record.expiresAt) {
        await fsp.unlink(filePath).catch(() => {});
        const err = new Error('Verification session has expired. Please register again.');
        err.statusCode = 400;
        throw err;
      }

      const codeExpiry = typeof record.codeExpiresAt === 'number' ? record.codeExpiresAt : record.expiresAt;
      if (nowMs > codeExpiry) {
        const err = new Error('Verification code has expired. Please request a new code.');
        err.statusCode = 400;
        throw err;
      }

      const candidateHash = hashVerificationCode(verificationId, cleanCode);
      const a = Buffer.from(candidateHash, 'hex');
      const b = Buffer.from(record.codeHash, 'hex');
      const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

      if (!matches) {
        record.attempts = (record.attempts || 0) + 1;
        if (record.attempts >= (record.maxAttempts || 5)) {
          await fsp.unlink(filePath).catch(() => {});
          const err = new Error('Too many incorrect attempts. Please register again.');
          err.statusCode = 400;
          throw err;
        }
        await writeJsonAtomic(filePath, record);
        const remaining = (record.maxAttempts || 5) - record.attempts;
        const err = new Error(`Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
        err.statusCode = 400;
        throw err;
      }

      // Final uniqueness safety check
      if (await getUserByUsername(record.username)) {
        await fsp.unlink(filePath).catch(() => {});
        const err = new Error('That username is already taken.');
        err.statusCode = 409;
        throw err;
      }
      if (await getUserByEmail(record.email)) {
        await fsp.unlink(filePath).catch(() => {});
        const err = new Error('An account with this email already exists.');
        err.statusCode = 409;
        throw err;
      }

      const folder = userFolder(record.username);
      await fsp.mkdir(path.join(folder, 'uploads'), { recursive: true });

      const colorIndex = Math.abs(
        record.username.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
      ) % AVATAR_GRADIENTS.length;

      const now = new Date().toISOString();
      const user = {
        id: `usr_${crypto.randomUUID()}`,
        username: record.username,
        displayName: record.displayName || record.username,
        email: record.email,
        emailVerified: true,
        verifiedAt: now,
        passwordHash: record.passwordHash,
        bio: '',
        avatarColor: AVATAR_GRADIENTS[colorIndex],
        avatarUrl: null,
        createdAt: now,
        lastSeen: now
      };

      await writeJsonAtomic(path.join(folder, 'profile.json'), user);
      await fsp.unlink(filePath).catch(() => {});
      return toPublicUser(user);
    });
  }

  async function authenticateUser(identifier, password) {
    const clean = String(identifier || '').trim().toLowerCase();
    if (!clean || typeof password !== 'string' || !password) {
      return null;
    }

    let user = null;
    if (clean.includes('@')) {
      user = await getUserByEmail(clean);
    } else {
      user = await getUserByUsername(clean);
    }

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return null;
    }

    await updateLastSeen(user.username);
    return toPublicUser(user);
  }

  async function updateLastSeen(username) {
    const folder = userFolder(username);
    if (!folder) return;
    await withLock(`user:${username}`, async () => {
      const profilePath = path.join(folder, 'profile.json');
      const user = await readJson(profilePath);
      if (!user) return;
      user.lastSeen = new Date().toISOString();
      await writeJsonAtomic(profilePath, user);
    });
  }

  async function updateUserProfile(username, updates) {
    const normalizedBirthday = normalizeBirthday(updates.birthday);
    const folder = userFolder(username);
    if (!folder) return null;
    return withLock(`user:${username}`, async () => {
      const profilePath = path.join(folder, 'profile.json');
      const user = await readJson(profilePath);
      if (!user) return null;

      if (typeof updates.displayName === 'string') {
        const trimmed = updates.displayName.trim();
        if (trimmed) user.displayName = trimmed.slice(0, 48);
      }
      if (typeof updates.bio === 'string') {
        user.bio = updates.bio.trim().slice(0, 160);
      }
      if (normalizedBirthday !== undefined) {
        user.birthday = normalizedBirthday;
      }
      if (typeof updates.avatarUrl === 'string' || updates.avatarUrl === null) {
        user.avatarUrl = updates.avatarUrl;
      }
      user.lastSeen = new Date().toISOString();

      await writeJsonAtomic(profilePath, user);
      return toPublicUser(user);
    });
  }

  async function deleteLocalAvatarFile(folder, avatarUrl) {
    if (!folder || typeof avatarUrl !== 'string') return;
    const prefix = '/avatar/';
    const idx = avatarUrl.lastIndexOf(prefix);
    if (idx < 0) return;
    const encodedName = avatarUrl.slice(idx + prefix.length).split('?')[0];
    let fileName = '';
    try {
      fileName = decodeURIComponent(encodedName);
    } catch {
      fileName = encodedName;
    }
    const safeName = path.basename(fileName);
    if (!safeName || safeName === '.' || safeName === '..') return;
    const uploadsDir = path.resolve(folder, 'uploads');
    const fullPath = path.resolve(uploadsDir, safeName);
    if (!fullPath.startsWith(uploadsDir + path.sep)) return;
    await fsp.unlink(fullPath).catch(() => {});
  }

  async function saveUserAvatar(username, file) {
    const folder = userFolder(username);
    if (!folder) throw new Error('User not found.');
    const existing = await getUserByUsername(username);
    const prevAvatarUrl = existing ? existing.avatarUrl : null;
    const uploadsDir = path.join(folder, 'uploads');
    await fsp.mkdir(uploadsDir, { recursive: true });
    const ext = path.extname(sanitizeFilename(file.filename)).toLowerCase() || '.png';
    const storedName = `avatar_${Date.now()}${ext}`;
    await fsp.writeFile(path.join(uploadsDir, storedName), file.data);
    const avatarUrl = `/api/users/${encodeURIComponent(username)}/avatar/${encodeURIComponent(storedName)}`;
    const updated = await updateUserProfile(username, { avatarUrl });
    if (prevAvatarUrl && prevAvatarUrl !== avatarUrl) {
      await deleteLocalAvatarFile(folder, prevAvatarUrl);
    }
    return updated;
  }

  async function removeUserAvatar(username) {
    const folder = userFolder(username);
    if (!folder) return null;
    return withLock(`user:${username}`, async () => {
      const profilePath = path.join(folder, 'profile.json');
      const user = await readJson(profilePath);
      if (!user) return null;

      const prevAvatarUrl = user.avatarUrl;
      user.avatarUrl = null;
      user.lastSeen = new Date().toISOString();
      await writeJsonAtomic(profilePath, user);
      await deleteLocalAvatarFile(folder, prevAvatarUrl);
      return toPublicUser(user);
    });
  }

  function replaceUsernameInChatData(meta, messages, oldUsername, newUsername, oldChatId, newChatId) {
    meta.id = newChatId;
    const isDm = !meta.type || meta.type === 'dm';
    meta.participants = meta.participants.map((p) => (p === oldUsername ? newUsername : p));
    if (isDm) meta.participants.sort();
    if (Array.isArray(meta.admins)) {
      meta.admins = meta.admins.map((a) => (a === oldUsername ? newUsername : a));
    }
    if (meta.createdBy === oldUsername) {
      meta.createdBy = newUsername;
    }
    if (meta.unreadCounts && Object.prototype.hasOwnProperty.call(meta.unreadCounts, oldUsername)) {
      meta.unreadCounts[newUsername] = meta.unreadCounts[oldUsername];
      delete meta.unreadCounts[oldUsername];
    }
    if (meta.lastMessage && meta.lastMessage.sender === oldUsername) {
      meta.lastMessage.sender = newUsername;
    }

    const oldFilePrefix = `/api/chats/${oldChatId}/files/`;
    const newFilePrefix = `/api/chats/${newChatId}/files/`;
    for (const msg of messages) {
      if (msg.sender === oldUsername) msg.sender = newUsername;
      if (msg.replyTo && msg.replyTo.sender === oldUsername) msg.replyTo.sender = newUsername;
      if (Array.isArray(msg.mentions)) {
        msg.mentions = msg.mentions.map((u) => (u === oldUsername ? newUsername : u));
      }
      if (Array.isArray(msg.readBy)) {
        msg.readBy = msg.readBy.map((u) => (u === oldUsername ? newUsername : u));
      }
      if (msg.reactions && typeof msg.reactions === 'object') {
        for (const emoji of Object.keys(msg.reactions)) {
          if (Array.isArray(msg.reactions[emoji])) {
            msg.reactions[emoji] = msg.reactions[emoji].map((u) => (u === oldUsername ? newUsername : u));
          }
        }
      }
      if (Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          if (typeof att.url === 'string' && att.url.startsWith(oldFilePrefix)) {
            att.url = newFilePrefix + att.url.slice(oldFilePrefix.length);
          }
        }
      }
    }
  }

  async function updateAccountProfile(currentUsername, updates = {}) {
    const normalizedBirthday = normalizeBirthday(updates.birthday);
    const oldClean = String(currentUsername || '').trim().toLowerCase();
    const hasNewUsername = typeof updates.username === 'string';
    const newClean = hasNewUsername ? updates.username.trim().toLowerCase() : oldClean;

    if (!hasNewUsername || newClean === oldClean) {
      const user = await updateUserProfile(oldClean, updates);
      return { user, renamed: false, previousUsername: oldClean, chatRenames: [] };
    }

    if (!USERNAME_REGEX.test(newClean)) {
      const err = new Error('Username must be 3–24 characters using only letters, numbers, and underscores.');
      err.statusCode = 400;
      throw err;
    }

    return withLock('users:registry', async () => {
      const oldFolder = userFolder(oldClean);
      const newFolder = userFolder(newClean);
      if (!oldFolder || !newFolder) {
        const err = new Error('Invalid username.');
        err.statusCode = 400;
        throw err;
      }

      const existing = await getUserByUsername(newClean);
      if (existing) {
        const err = new Error('That username is already taken.');
        err.statusCode = 409;
        throw err;
      }

      const activePending = await listActivePending();
      for (const { item } of activePending) {
        if (item.username === newClean) {
          const err = new Error('That username is currently awaiting email verification.');
          err.statusCode = 409;
          throw err;
        }
      }

      return withLock(`user:${oldClean}`, async () => {
        const oldProfilePath = path.join(oldFolder, 'profile.json');
        const user = await readJson(oldProfilePath);
        if (!user) {
          const err = new Error('User not found.');
          err.statusCode = 404;
          throw err;
        }

        await fsp.rename(oldFolder, newFolder);

        const prevDisplay = user.displayName;
        user.username = newClean;
        if (typeof updates.displayName === 'string') {
          const trimmedDisplay = updates.displayName.trim();
          if (trimmedDisplay) user.displayName = trimmedDisplay.slice(0, 48);
        } else if (!prevDisplay || prevDisplay === oldClean) {
          user.displayName = newClean;
        }
        if (typeof updates.bio === 'string') {
          user.bio = updates.bio.trim().slice(0, 160);
        }
        if (normalizedBirthday !== undefined) {
          user.birthday = normalizedBirthday;
        }
        const oldAvatarPrefix = `/api/users/${encodeURIComponent(oldClean)}/avatar/`;
        if (typeof user.avatarUrl === 'string' && user.avatarUrl.startsWith(oldAvatarPrefix)) {
          user.avatarUrl = `/api/users/${encodeURIComponent(newClean)}/avatar/${user.avatarUrl.slice(oldAvatarPrefix.length)}`;
        }
        user.lastSeen = new Date().toISOString();
        await writeJsonAtomic(path.join(newFolder, 'profile.json'), user);

        // Update all DM chat folders involving this user so history & attachments remain intact
        const chatRenames = [];
        const chatEntries = await fsp.readdir(config.chatsDir, { withFileTypes: true }).catch(() => []);
        for (const entry of chatEntries) {
          if (!entry.isDirectory() || !CHAT_ID_REGEX.test(entry.name)) continue;
          const oldChatId = entry.name;
          const oldChatFolder = path.join(config.chatsDir, oldChatId);
          const metaCheck = await readJson(path.join(oldChatFolder, 'meta.json'));
          if (!metaCheck || !Array.isArray(metaCheck.participants) || !metaCheck.participants.includes(oldClean)) {
            continue;
          }

          await withLock(`chat:${oldChatId}`, async () => {
            const metaPath = path.join(oldChatFolder, 'meta.json');
            const messagesPath = path.join(oldChatFolder, 'messages.json');
            const logPath = path.join(oldChatFolder, 'chat.log');
            const meta = await readJson(metaPath);
            if (!meta || !Array.isArray(meta.participants) || !meta.participants.includes(oldClean)) return;

            const isDm = !meta.type || meta.type === 'dm';
            const peer = meta.participants.find((p) => p !== oldClean) || newClean;
            const newChatId = isDm ? getDmChatId(newClean, peer) : oldChatId;
            const messages = (await readJson(messagesPath, [])) || [];

            replaceUsernameInChatData(meta, messages, oldClean, newClean, oldChatId, newChatId);
            await writeJsonAtomic(metaPath, meta);
            await writeJsonAtomic(messagesPath, messages);
            await fsp.appendFile(
              logPath,
              `# User renamed: ${oldClean} -> ${newClean} (${new Date().toISOString()})\n`,
              'utf8'
            ).catch(() => {});

            if (newChatId !== oldChatId) {
              const newChatFolder = path.join(config.chatsDir, newChatId);
              await fsp.rename(oldChatFolder, newChatFolder);
            }
            chatRenames.push({ oldChatId, newChatId });
          });
        }

        return {
          user: toPublicUser(user),
          renamed: true,
          previousUsername: oldClean,
          chatRenames
        };
      });
    });
  }

  async function getUserAvatarPath(username, filename) {
    const folder = userFolder(username);
    if (!folder) return null;
    const safeName = path.basename(String(filename || ''));
    const uploadsDir = path.resolve(folder, 'uploads');
    const fullPath = path.resolve(uploadsDir, safeName);
    if (!fullPath.startsWith(uploadsDir + path.sep)) return null;
    if (!fs.existsSync(fullPath)) return null;
    return fullPath;
  }

  async function searchUsers(query, excludeUsername = '') {
    const q = String(query || '').trim().toLowerCase();
    const exclude = String(excludeUsername || '').trim().toLowerCase();
    const allUsers = await listAllUsers();

    const candidates = allUsers.filter((u) => u.username !== exclude);
    if (!q) {
      return candidates
        .sort((a, b) => a.username.localeCompare(b.username))
        .slice(0, 30)
        .map(toPublicUser);
    }

    const scored = [];
    for (const u of candidates) {
      const uname = u.username.toLowerCase();
      const email = u.email.toLowerCase();
      const dname = (u.displayName || '').toLowerCase();

      let score = 0;
      if (uname === q || email === q) score = 100;
      else if (uname.startsWith(q) || email.startsWith(q)) score = 75;
      else if (dname.startsWith(q)) score = 60;
      else if (uname.includes(q) || email.includes(q)) score = 40;
      else if (dname.includes(q)) score = 20;

      if (score > 0) {
        scored.push({ score, user: u });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.user.username.localeCompare(b.user.username));
    return scored.slice(0, 30).map((s) => toPublicUser(s.user));
  }

  async function ensureChatFolder(userA, userB) {
    const a = String(userA).trim().toLowerCase();
    const b = String(userB).trim().toLowerCase();
    if (a === b) {
      const err = new Error('You cannot start a chat with yourself.');
      err.statusCode = 400;
      throw err;
    }

    const [profileA, profileB] = await Promise.all([
      getUserByUsername(a),
      getUserByUsername(b)
    ]);
    if (!profileA || !profileB) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }

    const chatId = getDmChatId(a, b);
    const folder = chatFolder(chatId);

    return withLock(`chat:${chatId}`, async () => {
      await fsp.mkdir(path.join(folder, 'files'), { recursive: true });
      const metaPath = path.join(folder, 'meta.json');
      const messagesPath = path.join(folder, 'messages.json');
      const logPath = path.join(folder, 'chat.log');

      let meta = await readJson(metaPath);
      if (!meta) {
        const now = new Date().toISOString();
        const participants = [a, b].sort();
        meta = {
          id: chatId,
          type: 'dm',
          participants,
          createdAt: now,
          updatedAt: now,
          lastMessage: null,
          unreadCounts: {
            [participants[0]]: 0,
            [participants[1]]: 0
          }
        };
        await writeJsonAtomic(metaPath, meta);
        await writeJsonAtomic(messagesPath, []);
        const header = `# VibeRoom Conversation Log: ${participants[0]} <-> ${participants[1]}\n# Created: ${now}\n`;
        await fsp.writeFile(logPath, header, 'utf8');
      }

      return meta;
    });
  }

  async function getChatMeta(chatId) {
    const folder = chatFolder(chatId);
    if (!folder) return null;
    return readJson(path.join(folder, 'meta.json'));
  }

  async function listChatsForUser(username) {
    const clean = String(username || '').trim().toLowerCase();
    const entries = await fsp.readdir(config.chatsDir, { withFileTypes: true });
    const chats = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !CHAT_ID_REGEX.test(entry.name)) continue;
      const meta = await readJson(path.join(config.chatsDir, entry.name, 'meta.json'));
      if (!meta || !Array.isArray(meta.participants) || !meta.participants.includes(clean)) {
        continue;
      }

      if (meta.type === 'group' || meta.type === 'channel') {
        chats.push({
          id: meta.id,
          type: meta.type,
          title: meta.title || 'Untitled Room',
          description: meta.description || '',
          inviteCode: meta.inviteCode || '',
          avatarColor: meta.avatarColor || AVATAR_GRADIENTS[0],
          admins: Array.isArray(meta.admins) ? meta.admins : [],
          createdBy: meta.createdBy || '',
          participants: meta.participants,
          memberCount: meta.participants.length,
          peer: null,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastMessage: meta.lastMessage,
          unreadCount: (meta.unreadCounts && meta.unreadCounts[clean]) || 0
        });
        continue;
      }

      const peerUsername = meta.participants.find((p) => p !== clean) || clean;
      const peer = toPublicUser(await getUserByUsername(peerUsername));
      if (!peer) continue;

      chats.push({
        id: meta.id,
        type: meta.type || 'dm',
        participants: meta.participants,
        peer,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        lastMessage: meta.lastMessage,
        unreadCount: (meta.unreadCounts && meta.unreadCounts[clean]) || 0
      });
    }

    chats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return chats;
  }

  async function getMessages(chatId, username) {
    const meta = await getChatMeta(chatId);
    if (!meta || !meta.participants.includes(username)) {
      const err = new Error('Chat not found.');
      err.statusCode = 404;
      throw err;
    }
    const folder = chatFolder(chatId);
    const messages = (await readJson(path.join(folder, 'messages.json'), [])) || [];
    return { meta, messages };
  }

  async function appendChatMessage(chatId, senderUsername, { text = '', files = [], replyToId = null, kind = 'text', game = null, allowChannelSystem = false }) {
    const folder = chatFolder(chatId);
    if (!folder) {
      const err = new Error('Invalid chat ID.');
      err.statusCode = 400;
      throw err;
    }

    const cleanText = typeof text === 'string' ? text.trim().slice(0, 4000) : '';
    if (!cleanText && (!files || files.length === 0) && !game) {
      const err = new Error('Message text or at least one file is required.');
      err.statusCode = 400;
      throw err;
    }

    return withLock(`chat:${chatId}`, async () => {
      const metaPath = path.join(folder, 'meta.json');
      const messagesPath = path.join(folder, 'messages.json');
      const logPath = path.join(folder, 'chat.log');
      const filesDir = path.join(folder, 'files');

      const meta = await readJson(metaPath);
      if (!meta || !meta.participants.includes(senderUsername)) {
        const err = new Error('Chat not found.');
        err.statusCode = 404;
        throw err;
      }
      if (meta.type === 'channel' && !allowChannelSystem && (!Array.isArray(meta.admins) || !meta.admins.includes(senderUsername))) {
        const err = new Error('Only channel admins can post in this channel.');
        err.statusCode = 403;
        throw err;
      }

      await fsp.mkdir(filesDir, { recursive: true });
      const messages = (await readJson(messagesPath, [])) || [];

      let replySnapshot = null;
      if (replyToId) {
        const target = messages.find((m) => m.id === replyToId);
        if (target) {
          replySnapshot = {
            id: target.id,
            sender: target.sender,
            text: target.text
              ? target.text.slice(0, 140)
              : (target.attachments && target.attachments[0] ? `[${target.attachments[0].originalName}]` : '')
          };
        }
      }

      const attachments = [];
      for (const f of files) {
        const fileId = crypto.randomBytes(8).toString('hex');
        const safeOriginal = sanitizeFilename(f.filename);
        const storedName = `${fileId}_${safeOriginal}`;
        const destPath = path.join(filesDir, storedName);
        await fsp.writeFile(destPath, f.data);

        const isImage = isImageMime(f.mimeType, safeOriginal);
        attachments.push({
          id: fileId,
          originalName: safeOriginal,
          storedName,
          mimeType: f.mimeType || 'application/octet-stream',
          size: f.data.length,
          isImage,
          url: `/api/chats/${encodeURIComponent(chatId)}/files/${encodeURIComponent(storedName)}`
        });
      }

      const now = new Date().toISOString();
      const mentions = extractMentions(cleanText);
      const message = {
        id: `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        chatId,
        kind: game ? 'game' : kind,
        sender: senderUsername,
        text: cleanText,
        mentions,
        attachments,
        replyTo: replySnapshot,
        game: game || undefined,
        reactions: {},
        readBy: [senderUsername],
        createdAt: now
      };

      messages.push(message);
      await writeJsonAtomic(messagesPath, messages);

      // Append human-readable line to chat.log
      const attachmentNote = attachments.length
        ? ` ${attachments.map((a) => `[${a.isImage ? 'image' : 'file'}: ${a.originalName} (${a.size}B)]`).join(' ')}`
        : '';
      const logLine = `[${now}] ${senderUsername}: ${cleanText.replace(/\r?\n/g, ' ')}${attachmentNote}\n`;
      await fsp.appendFile(logPath, logLine, 'utf8');

      // Update meta
      meta.updatedAt = now;
      const previewText = game
        ? `🎮 ${game.title || game.type}`
        : (cleanText
          ? cleanText.slice(0, 80)
          : (attachments[0].isImage ? '📷 Photo' : `📎 ${attachments[0].originalName}`));
      meta.lastMessage = {
        id: message.id,
        sender: senderUsername,
        preview: previewText,
        hasImage: attachments.some((a) => a.isImage),
        hasFile: attachments.some((a) => !a.isImage),
        createdAt: now
      };
      meta.unreadCounts = meta.unreadCounts || {};
      for (const participant of meta.participants) {
        if (participant !== senderUsername) {
          meta.unreadCounts[participant] = (meta.unreadCounts[participant] || 0) + 1;
        }
      }
      await writeJsonAtomic(metaPath, meta);

      return { message, meta };
    });
  }

  async function mutateChatMessages(chatId, mutatorFn) {
    const folder = chatFolder(chatId);
    if (!folder) return null;
    return withLock(`chat:${chatId}`, async () => {
      const metaPath = path.join(folder, 'meta.json');
      const messagesPath = path.join(folder, 'messages.json');
      const meta = await readJson(metaPath);
      if (!meta) return null;
      const messages = (await readJson(messagesPath, [])) || [];
      const result = await mutatorFn({ meta, messages, folder });
      if (!result) return null;
      if (result.saveMessages) {
        await writeJsonAtomic(messagesPath, messages);
      }
      if (result.saveMeta) {
        await writeJsonAtomic(metaPath, meta);
      }
      return { ...result, meta };
    });
  }

  async function markChatRead(chatId, username) {
    const folder = chatFolder(chatId);
    if (!folder) return null;

    return withLock(`chat:${chatId}`, async () => {
      const metaPath = path.join(folder, 'meta.json');
      const messagesPath = path.join(folder, 'messages.json');
      const meta = await readJson(metaPath);
      if (!meta || !meta.participants.includes(username)) return null;

      const messages = (await readJson(messagesPath, [])) || [];
      const newlyReadIds = [];
      for (const msg of messages) {
        if (!Array.isArray(msg.readBy)) msg.readBy = [msg.sender];
        if (!msg.readBy.includes(username)) {
          msg.readBy.push(username);
          newlyReadIds.push(msg.id);
        }
      }

      if (newlyReadIds.length > 0) {
        await writeJsonAtomic(messagesPath, messages);
      }

      if (meta.unreadCounts && meta.unreadCounts[username] > 0) {
        meta.unreadCounts[username] = 0;
        await writeJsonAtomic(metaPath, meta);
      }

      return { meta, newlyReadIds };
    });
  }

  async function toggleReaction(chatId, messageId, username, emoji) {
    const folder = chatFolder(chatId);
    if (!folder) return null;
    const cleanEmoji = String(emoji || '').trim().slice(0, 8);
    if (!cleanEmoji) return null;

    return withLock(`chat:${chatId}`, async () => {
      const meta = await readJson(path.join(folder, 'meta.json'));
      if (!meta || !meta.participants.includes(username)) return null;

      const messagesPath = path.join(folder, 'messages.json');
      const messages = (await readJson(messagesPath, [])) || [];
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return null;

      if (!msg.reactions || typeof msg.reactions !== 'object') {
        msg.reactions = {};
      }
      const list = Array.isArray(msg.reactions[cleanEmoji]) ? msg.reactions[cleanEmoji] : [];
      const idx = list.indexOf(username);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        list.push(username);
      }
      if (list.length === 0) {
        delete msg.reactions[cleanEmoji];
      } else {
        msg.reactions[cleanEmoji] = list;
      }

      await writeJsonAtomic(messagesPath, messages);
      return { message: msg, meta };
    });
  }

  async function deleteMessage(chatId, messageId, username) {
    const folder = chatFolder(chatId);
    if (!folder) return null;

    return withLock(`chat:${chatId}`, async () => {
      const metaPath = path.join(folder, 'meta.json');
      const messagesPath = path.join(folder, 'messages.json');
      const logPath = path.join(folder, 'chat.log');

      const meta = await readJson(metaPath);
      if (!meta || !meta.participants.includes(username)) return null;

      const messages = (await readJson(messagesPath, [])) || [];
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return null;

      const target = messages[idx];
      if (target.sender !== username) {
        const err = new Error('You can only delete your own messages.');
        err.statusCode = 403;
        throw err;
      }

      // Remove uploaded files attached to this message
      if (Array.isArray(target.attachments)) {
        for (const att of target.attachments) {
          const filePath = path.join(folder, 'files', path.basename(att.storedName));
          await fsp.unlink(filePath).catch(() => {});
        }
      }

      messages.splice(idx, 1);
      await writeJsonAtomic(messagesPath, messages);
      await fsp.appendFile(logPath, `[${new Date().toISOString()}] SYSTEM: ${username} deleted message ${messageId}\n`, 'utf8');

      // Recompute lastMessage
      const last = messages[messages.length - 1];
      if (last) {
        const preview = last.text
          ? last.text.slice(0, 80)
          : (last.attachments && last.attachments[0]
            ? (last.attachments[0].isImage ? '📷 Photo' : `📎 ${last.attachments[0].originalName}`)
            : '');
        meta.lastMessage = {
          id: last.id,
          sender: last.sender,
          preview,
          hasImage: (last.attachments || []).some((a) => a.isImage),
          hasFile: (last.attachments || []).some((a) => !a.isImage),
          createdAt: last.createdAt
        };
      } else {
        meta.lastMessage = null;
      }
      meta.updatedAt = new Date().toISOString();
      await writeJsonAtomic(metaPath, meta);

      return { deletedId: messageId, meta };
    });
  }

  async function getChatFilePath(chatId, storedName, username) {
    const meta = await getChatMeta(chatId);
    if (!meta || !meta.participants.includes(username)) return null;

    const folder = chatFolder(chatId);
    if (!folder) return null;
    const filesDir = path.resolve(folder, 'files');
    const safeName = path.basename(String(storedName || ''));
    const fullPath = path.resolve(filesDir, safeName);
    if (!fullPath.startsWith(filesDir + path.sep)) return null;
    if (!fs.existsSync(fullPath)) return null;
    return fullPath;
  }

  return {
    USERNAME_REGEX,
    CHAT_ID_REGEX,
    AVATAR_GRADIENTS,
    getDmChatId,
    withLock,
    chatFolder,
    readJson,
    writeJsonAtomic,
    mutateChatMessages,
    toPublicUser,
    getUserByUsername,
    getUserByEmail,
    createUser,
    createPendingRegistration,
    resendPendingRegistration,
    verifyPendingRegistration,
    authenticateUser,
    updateLastSeen,
    updateUserProfile,
    updateAccountProfile,
    saveUserAvatar,
    removeUserAvatar,
    getUserAvatarPath,
    searchUsers,
    ensureChatFolder,
    getChatMeta,
    listChatsForUser,
    getMessages,
    appendChatMessage,
    markChatRead,
    toggleReaction,
    deleteMessage,
    getChatFilePath
  };
}

module.exports = {
  createStorage,
  USERNAME_REGEX,
  CHAT_ID_REGEX,
  getDmChatId,
  sanitizeFilename
};
