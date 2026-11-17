const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateEmail } = require('./emailValidator');
const { hashPassword, verifyPassword } = require('./auth');

const USERNAME_REGEX = /^[a-z0-9_]{3,24}$/;
const CHAT_ID_REGEX = /^(?:dm_[a-z0-9_]{3,24}__[a-z0-9_]{3,24}|saved_[a-z0-9_]{3,24}|(?:grp|chn)_[a-z0-9]{10,24})$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVACY_LEVELS = new Set(['everyone', 'contacts', 'nobody']);
const DEFAULT_PRIVACY = {
  email: 'everyone',
  birthday: 'everyone',
  lastSeen: 'everyone',
  avatar: 'everyone'
};

function normalizePrivacy(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    email: PRIVACY_LEVELS.has(src.email) ? src.email : DEFAULT_PRIVACY.email,
    birthday: PRIVACY_LEVELS.has(src.birthday) ? src.birthday : DEFAULT_PRIVACY.birthday,
    lastSeen: PRIVACY_LEVELS.has(src.lastSeen) ? src.lastSeen : DEFAULT_PRIVACY.lastSeen,
    avatar: PRIVACY_LEVELS.has(src.avatar) ? src.avatar : DEFAULT_PRIVACY.avatar
  };
}

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
    if (user.deleted) {
      return {
        id: user.id || 'deleted',
        username: user.username,
        displayName: 'Deleted Account',
        email: null,
        emailVerified: false,
        bio: '',
        birthday: null,
        avatarColor: '#5C6670',
        avatarUrl: null,
        deleted: true,
        createdAt: user.createdAt || null,
        lastSeen: null,
        privacy: { ...DEFAULT_PRIVACY }
      };
    }
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
      lastSeen: user.lastSeen,
      privacy: normalizePrivacy(user.privacy)
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

  async function listActivePending(purpose = 'signup') {
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
      const itemPurpose = item.purpose || 'signup';
      if (purpose && itemPurpose !== purpose) continue;
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
      if (profile && profile.username && !profile.deleted) {
        users.push(profile);
      }
    }
    return users;
  }

  async function getRawProfile(username) {
    const folder = userFolder(username);
    if (!folder) return null;
    return readJson(path.join(folder, 'profile.json'));
  }

  async function getUserByUsername(username) {
    const profile = await getRawProfile(username);
    if (!profile || profile.deleted) return null;
    return profile;
  }

  async function archiveDeletedProfileIfPresent(folder) {
    const profilePath = path.join(folder, 'profile.json');
    const existing = await readJson(profilePath);
    if (existing && existing.deleted) {
      const stamp = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await writeJsonAtomic(path.join(folder, `deleted_profile_${stamp}.json`), existing);
    }
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
      await archiveDeletedProfileIfPresent(folder);

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
        privacy: { ...DEFAULT_PRIVACY },
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

  async function verifyOtpSession(verificationId, codeInput, expectedPurpose = 'signup', expiredLabel = 'Verification session') {
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

    const record = await readJson(filePath);
    if (!record || (record.purpose || 'signup') !== expectedPurpose) {
      const err = new Error(`${expiredLabel} not found or expired.`);
      err.statusCode = 400;
      throw err;
    }

    const nowMs = Date.now();
    if (nowMs > record.expiresAt) {
      await fsp.unlink(filePath).catch(() => {});
      const err = new Error(`${expiredLabel} has expired. Please try again.`);
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
        const err = new Error('Too many incorrect attempts. Please request a new code.');
        err.statusCode = 400;
        throw err;
      }
      await writeJsonAtomic(filePath, record);
      const remaining = (record.maxAttempts || 5) - record.attempts;
      const err = new Error(`Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
      err.statusCode = 400;
      throw err;
    }

    return { record, filePath };
  }

  async function verifyPendingRegistration(verificationId, codeInput) {
    return withLock('users:registry', async () => {
      const { record, filePath } = await verifyOtpSession(verificationId, codeInput, 'signup', 'Verification session');

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
      await archiveDeletedProfileIfPresent(folder);

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
        privacy: { ...DEFAULT_PRIVACY },
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

  async function createOtpSession({ username, email, purpose }) {
    const nowMs = Date.now();
    let priorResendCount = -1;
    const activeSame = await listActivePending(purpose);
    for (const { item, fullPath } of activeSame) {
      if (item.email === email && item.username === username) {
        if (typeof item.nextResendAt === 'number' && nowMs < item.nextResendAt) {
          const err = new Error(`Please wait ${formatWaitDuration(item.nextResendAt - nowMs)} before requesting another code.`);
          err.statusCode = 429;
          throw err;
        }
        priorResendCount = typeof item.resendCount === 'number' ? item.resendCount : 0;
        await fsp.unlink(fullPath).catch(() => {});
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
      purpose,
      username,
      email,
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
      username,
      email,
      maskedEmail: maskEmail(email),
      code,
      resendCount,
      codeExpiresAt,
      nextResendAt,
      resendCooldownSeconds: Math.ceil(cooldownMs / 1000)
    };
  }

  async function createPasswordResetRequest(identifier) {
    const raw = String(identifier || '').trim().toLowerCase();
    const cleanHandle = raw.startsWith('@') ? raw.slice(1).trim() : raw;
    if (!cleanHandle) {
      const err = new Error('Please enter your username or email address.');
      err.statusCode = 400;
      throw err;
    }
    const user = raw.includes('@')
      ? await getUserByEmail(raw)
      : await getUserByUsername(cleanHandle);
    if (!user || user.deleted) {
      const err = new Error('No active account found with that username or email.');
      err.statusCode = 404;
      throw err;
    }
    return createOtpSession({ username: user.username, email: user.email, purpose: 'password_reset' });
  }

  async function resetPasswordWithOtp(verificationId, codeInput, newPassword) {
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) {
      const err = new Error('New password must be 6–128 characters long.');
      err.statusCode = 400;
      throw err;
    }
    return withLock('users:registry', async () => {
      const { record, filePath } = await verifyOtpSession(verificationId, codeInput, 'password_reset', 'Password reset session');
      const user = await getUserByUsername(record.username);
      if (!user) {
        const err = new Error('Account no longer exists.');
        err.statusCode = 404;
        throw err;
      }
      const folder = userFolder(user.username);
      await withLock(`user:${user.username}`, async () => {
        const profilePath = path.join(folder, 'profile.json');
        const cur = await readJson(profilePath);
        if (!cur || cur.deleted) {
          const err = new Error('Account no longer exists.');
          err.statusCode = 404;
          throw err;
        }
        cur.passwordHash = hashPassword(newPassword);
        cur.lastSeen = new Date().toISOString();
        await writeJsonAtomic(profilePath, cur);
      });
      await fsp.unlink(filePath).catch(() => {});
      return toPublicUser(user);
    });
  }

  async function changeUserPassword(username, currentPassword, newPassword) {
    if (typeof currentPassword !== 'string' || !currentPassword) {
      const err = new Error('Current password is required.');
      err.statusCode = 400;
      throw err;
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) {
      const err = new Error('New password must be 6–128 characters long.');
      err.statusCode = 400;
      throw err;
    }
    const folder = userFolder(username);
    if (!folder) return null;
    return withLock(`user:${username}`, async () => {
      const profilePath = path.join(folder, 'profile.json');
      const cur = await readJson(profilePath);
      if (!cur || cur.deleted) {
        const err = new Error('User not found.');
        err.statusCode = 404;
        throw err;
      }
      if (!verifyPassword(currentPassword, cur.passwordHash)) {
        const err = new Error('Current password is incorrect.');
        err.statusCode = 403;
        throw err;
      }
      cur.passwordHash = hashPassword(newPassword);
      cur.lastSeen = new Date().toISOString();
      await writeJsonAtomic(profilePath, cur);
      return toPublicUser(cur);
    });
  }

  async function createDeleteAccountOtp(username) {
    const user = await getUserByUsername(username);
    if (!user) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }
    return createOtpSession({ username: user.username, email: user.email, purpose: 'delete_account' });
  }

  async function confirmDeleteAccount(username, verificationId, codeInput, confirmText) {
    if (String(confirmText || '').trim() !== 'DELETE') {
      const err = new Error('Please type DELETE in uppercase to confirm account deletion.');
      err.statusCode = 400;
      throw err;
    }
    const clean = String(username || '').trim().toLowerCase();
    return withLock('users:registry', async () => {
      const { record, filePath } = await verifyOtpSession(verificationId, codeInput, 'delete_account', 'Deletion confirmation');
      if (record.username !== clean) {
        const err = new Error('Verification session does not belong to your account.');
        err.statusCode = 403;
        throw err;
      }
      const folder = userFolder(clean);
      if (!folder) {
        const err = new Error('User not found.');
        err.statusCode = 404;
        throw err;
      }
      const deletedSnapshot = await withLock(`user:${clean}`, async () => {
        const profilePath = path.join(folder, 'profile.json');
        const cur = await readJson(profilePath);
        if (!cur || cur.deleted) {
          const err = new Error('Account not found or already deleted.');
          err.statusCode = 404;
          throw err;
        }
        const now = new Date().toISOString();
        cur.deleted = true;
        cur.deletedAt = now;
        cur.passwordHash = null;
        cur.emailVerified = false;
        await writeJsonAtomic(profilePath, cur);
        return { username: cur.username, email: cur.email, deletedAt: now };
      });
      await fsp.unlink(filePath).catch(() => {});
      return deletedSnapshot;
    });
  }

  async function updateUserPrivacy(username, privacyUpdates = {}) {
    const folder = userFolder(username);
    if (!folder) return null;
    return withLock(`user:${username}`, async () => {
      const profilePath = path.join(folder, 'profile.json');
      const cur = await readJson(profilePath);
      if (!cur || cur.deleted) return null;
      const merged = normalizePrivacy({ ...(cur.privacy || {}), ...(privacyUpdates || {}) });
      cur.privacy = merged;
      await writeJsonAtomic(profilePath, cur);
      return toPublicUser(cur);
    });
  }

  async function readBlockedListRaw(username) {
    const folder = userFolder(username);
    if (!folder) return [];
    const data = await readJson(path.join(folder, 'blocked.json'), {});
    return Array.isArray(data && data.blocked) ? data.blocked : [];
  }

  async function blockUser(username, targetUsername) {
    const me = String(username || '').trim().toLowerCase();
    const target = String(targetUsername || '').trim().toLowerCase();
    if (!USERNAME_REGEX.test(me) || !USERNAME_REGEX.test(target) || me === target) {
      const err = new Error('Invalid target user to block.');
      err.statusCode = 400;
      throw err;
    }
    const targetUser = await getUserByUsername(target);
    if (!targetUser) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }
    const folder = userFolder(me);
    return withLock(`blocked:${me}`, async () => {
      const filePath = path.join(folder, 'blocked.json');
      const cur = await readBlockedListRaw(me);
      if (!cur.some((entry) => entry && entry.username === target)) {
        cur.push({ username: target, blockedAt: new Date().toISOString() });
        await writeJsonAtomic(filePath, { blocked: cur });
      }
      return { blocked: true, target };
    });
  }

  async function unblockUser(username, targetUsername) {
    const me = String(username || '').trim().toLowerCase();
    const target = String(targetUsername || '').trim().toLowerCase();
    const folder = userFolder(me);
    if (!folder) return { blocked: false, target };
    return withLock(`blocked:${me}`, async () => {
      const filePath = path.join(folder, 'blocked.json');
      const cur = await readBlockedListRaw(me);
      const next = cur.filter((entry) => entry && entry.username !== target);
      if (next.length !== cur.length) {
        await writeJsonAtomic(filePath, { blocked: next });
      }
      return { blocked: false, target };
    });
  }

  async function listBlockedUsers(username) {
    const list = await readBlockedListRaw(username);
    const out = [];
    for (const entry of list) {
      if (!entry || !entry.username) continue;
      const u = await getUserByUsername(entry.username);
      if (u) {
        out.push({
          ...toPublicUser(u),
          blockedAt: entry.blockedAt || null
        });
      }
    }
    return out;
  }

  async function getBlockStatus(userA, userB) {
    const a = String(userA || '').trim().toLowerCase();
    const b = String(userB || '').trim().toLowerCase();
    if (!a || !b || a === b) return { blockedByA: false, blockedByB: false, anyBlocked: false };
    const [listA, listB] = await Promise.all([readBlockedListRaw(a), readBlockedListRaw(b)]);
    const blockedByA = listA.some((e) => e && e.username === b);
    const blockedByB = listB.some((e) => e && e.username === a);
    return { blockedByA, blockedByB, anyBlocked: blockedByA || blockedByB };
  }

  async function createReport({ reporter, targetUsername, reason = 'spam', details = '', chatId = null }) {
    const cleanReporter = String(reporter || '').trim().toLowerCase();
    const cleanTarget = String(targetUsername || '').trim().toLowerCase();
    if (!USERNAME_REGEX.test(cleanReporter) || !USERNAME_REGEX.test(cleanTarget) || cleanReporter === cleanTarget) {
      const err = new Error('Invalid report target.');
      err.statusCode = 400;
      throw err;
    }
    const report = {
      id: `rpt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      reporter: cleanReporter,
      targetUsername: cleanTarget,
      reason: String(reason || 'spam').trim().slice(0, 48),
      details: String(details || '').trim().slice(0, 500),
      chatId: chatId || null,
      createdAt: new Date().toISOString()
    };
    const reportsPath = path.join(config.dataDir, 'reports.jsonl');
    await withLock('reports:log', async () => {
      await fsp.mkdir(config.dataDir, { recursive: true });
      await fsp.appendFile(reportsPath, `${JSON.stringify(report)}\n`, 'utf8');
    });
    return report;
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
    if (Array.isArray(meta.hiddenFor)) {
      meta.hiddenFor = meta.hiddenFor.map((u) => (u === oldUsername ? newUsername : u));
    }
    if (Array.isArray(meta.pinnedHiddenFor)) {
      meta.pinnedHiddenFor = meta.pinnedHiddenFor.map((u) => (u === oldUsername ? newUsername : u));
    }
    if (meta.clearedBeforeByUser && Object.prototype.hasOwnProperty.call(meta.clearedBeforeByUser, oldUsername)) {
      meta.clearedBeforeByUser[newUsername] = meta.clearedBeforeByUser[oldUsername];
      delete meta.clearedBeforeByUser[oldUsername];
    }
    if (meta.lastMessageByUser && typeof meta.lastMessageByUser === 'object') {
      if (Object.prototype.hasOwnProperty.call(meta.lastMessageByUser, oldUsername)) {
        meta.lastMessageByUser[newUsername] = meta.lastMessageByUser[oldUsername];
        delete meta.lastMessageByUser[oldUsername];
      }
      for (const key of Object.keys(meta.lastMessageByUser)) {
        const lm = meta.lastMessageByUser[key];
        if (lm && lm.sender === oldUsername) lm.sender = newUsername;
      }
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
      if (Array.isArray(msg.deletedFor)) {
        msg.deletedFor = msg.deletedFor.map((u) => (u === oldUsername ? newUsername : u));
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

        if (fs.existsSync(newFolder)) {
          await archiveDeletedProfileIfPresent(newFolder);
          for (const lf of ['activity.log', 'universal.log']) {
            const oldLog = path.join(newFolder, lf);
            if (fs.existsSync(oldLog)) {
              const prev = await fsp.readFile(oldLog, 'utf8').catch(() => '');
              const cur = await fsp.readFile(path.join(oldFolder, lf), 'utf8').catch(() => '');
              await fsp.writeFile(path.join(oldFolder, lf), `${prev}${prev && cur ? '\n' : ''}${cur}`, 'utf8');
            }
          }
          await fsp.cp(oldFolder, newFolder, { recursive: true, force: true });
          await fsp.rm(oldFolder, { recursive: true, force: true });
        } else {
          await fsp.rename(oldFolder, newFolder);
        }

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
            const isSaved = meta.type === 'saved';
            const peer = meta.participants.find((p) => p !== oldClean) || newClean;
            const newChatId = isSaved ? getSavedChatId(newClean) : (isDm ? getDmChatId(newClean, peer) : oldChatId);
            const messages = (await readJson(messagesPath, [])) || [];

            replaceUsernameInChatData(meta, messages, oldClean, newClean, oldChatId, newChatId);
            if (meta.pinnedMessage && meta.pinnedMessage.sender === oldClean) {
              meta.pinnedMessage.sender = newClean;
            }
            if (meta.pinnedMessage && meta.pinnedMessage.pinnedBy === oldClean) {
              meta.pinnedMessage.pinnedBy = newClean;
            }
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

        if (chatRenames.length > 0) {
          const prefsPath = path.join(newFolder, 'chat_prefs.json');
          const prefs = await readJson(prefsPath, null);
          if (prefs) {
            const renameMap = new Map(chatRenames.map((r) => [r.oldChatId, r.newChatId]));
            if (Array.isArray(prefs.pinnedChats)) {
              prefs.pinnedChats = prefs.pinnedChats.map((id) => renameMap.get(id) || id);
            }
            if (Array.isArray(prefs.mutedChats)) {
              prefs.mutedChats = prefs.mutedChats.map((id) => renameMap.get(id) || id);
            }
            await writeJsonAtomic(prefsPath, prefs);
          }
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
    // Hide all users from general browsing & partial searches: require exact username or email
    if (!q) return [];
    const unameQuery = q.startsWith('@') ? q.slice(1).trim() : q;
    if (!unameQuery && !q) return [];

    const allUsers = await listAllUsers();
    const matches = [];
    for (const u of allUsers) {
      if (u.username === exclude) continue;
      const uname = u.username.toLowerCase();
      const email = u.email.toLowerCase();
      if (uname === unameQuery || email === q) {
        matches.push(toPublicUser(u));
      }
    }
    return matches;
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

  function getSavedChatId(username) {
    return `saved_${String(username || '').trim().toLowerCase()}`;
  }

  async function ensureSavedChatFolder(username) {
    const clean = String(username || '').trim().toLowerCase();
    const user = await getUserByUsername(clean);
    if (!user) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }
    const chatId = getSavedChatId(clean);
    const folder = chatFolder(chatId);
    return withLock(`chat:${chatId}`, async () => {
      await fsp.mkdir(path.join(folder, 'files'), { recursive: true });
      const metaPath = path.join(folder, 'meta.json');
      const messagesPath = path.join(folder, 'messages.json');
      const logPath = path.join(folder, 'chat.log');

      let meta = await readJson(metaPath);
      if (!meta) {
        const now = new Date().toISOString();
        meta = {
          id: chatId,
          type: 'saved',
          title: 'Saved Messages',
          participants: [clean],
          createdAt: now,
          updatedAt: now,
          lastMessage: null,
          pinnedMessage: null,
          unreadCounts: { [clean]: 0 }
        };
        await writeJsonAtomic(metaPath, meta);
        await writeJsonAtomic(messagesPath, []);
        await fsp.writeFile(logPath, `# VibeRoom Saved Messages for @${clean}\n# Created: ${now}\n`, 'utf8');
      }
      return meta;
    });
  }

  async function getUserChatPrefs(username) {
    const clean = String(username || '').trim().toLowerCase();
    const folder = userFolder(clean);
    if (!folder) return { pinnedChats: [], mutedChats: [] };
    const data = await readJson(path.join(folder, 'chat_prefs.json'), {});
    return {
      pinnedChats: Array.isArray(data && data.pinnedChats) ? data.pinnedChats : [],
      mutedChats: Array.isArray(data && data.mutedChats) ? data.mutedChats : []
    };
  }

  async function setUserChatPrefsBulk(username, chatIds, { pinned, muted } = {}) {
    const clean = String(username || '').trim().toLowerCase();
    const folder = userFolder(clean);
    if (!folder) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }
    const ids = Array.isArray(chatIds) ? chatIds.map(String).filter((id) => CHAT_ID_REGEX.test(id)) : [];
    return withLock(`chatprefs:${clean}`, async () => {
      const prefsPath = path.join(folder, 'chat_prefs.json');
      const cur = await getUserChatPrefs(clean);
      const pinnedSet = new Set(cur.pinnedChats);
      const mutedSet = new Set(cur.mutedChats);
      for (const id of ids) {
        if (typeof pinned === 'boolean') {
          if (pinned) pinnedSet.add(id);
          else pinnedSet.delete(id);
        }
        if (typeof muted === 'boolean') {
          if (muted) mutedSet.add(id);
          else mutedSet.delete(id);
        }
      }
      const next = {
        pinnedChats: Array.from(pinnedSet),
        mutedChats: Array.from(mutedSet)
      };
      await writeJsonAtomic(prefsPath, next);
      return {
        items: ids.map((id) => ({
          chatId: id,
          isPinned: pinnedSet.has(id),
          isMuted: mutedSet.has(id)
        })),
        ...next
      };
    });
  }

  async function setUserChatPref(username, chatId, { pinned, muted } = {}) {
    const res = await setUserChatPrefsBulk(username, [chatId], { pinned, muted });
    const item = res.items[0] || { chatId, isPinned: false, isMuted: false };
    return {
      chatId: item.chatId,
      isPinned: item.isPinned,
      isMuted: item.isMuted,
      pinnedChats: res.pinnedChats,
      mutedChats: res.mutedChats
    };
  }

  function isMessageHiddenForUser(msg, meta, username) {
    if (Array.isArray(msg.deletedFor) && msg.deletedFor.includes(username)) {
      return true;
    }
    const clearedIso = meta && meta.clearedBeforeByUser && meta.clearedBeforeByUser[username];
    if (clearedIso && msg && msg.createdAt) {
      if (new Date(msg.createdAt).getTime() <= new Date(clearedIso).getTime()) {
        return true;
      }
    }
    return false;
  }

  function getVisibleChatMeta(meta, username) {
    if (!meta) return meta;
    const pinnedHidden = Array.isArray(meta.pinnedHiddenFor) && meta.pinnedHiddenFor.includes(username);
    const hasCustomLast = meta.lastMessageByUser && Object.prototype.hasOwnProperty.call(meta.lastMessageByUser, username);
    return {
      ...meta,
      pinnedMessage: pinnedHidden ? null : (meta.pinnedMessage || null),
      lastMessage: hasCustomLast ? meta.lastMessageByUser[username] : meta.lastMessage
    };
  }

  async function listChatsForUser(username) {
    const clean = String(username || '').trim().toLowerCase();
    const entries = await fsp.readdir(config.chatsDir, { withFileTypes: true });
    const prefs = await getUserChatPrefs(clean);
    const pinnedSet = new Set(prefs.pinnedChats);
    const mutedSet = new Set(prefs.mutedChats);
    const chats = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !CHAT_ID_REGEX.test(entry.name)) continue;
      const meta = await readJson(path.join(config.chatsDir, entry.name, 'meta.json'));
      if (!meta || !Array.isArray(meta.participants) || !meta.participants.includes(clean)) {
        continue;
      }
      if (Array.isArray(meta.hiddenFor) && meta.hiddenFor.includes(clean)) {
        continue;
      }

      const visibleMeta = getVisibleChatMeta(meta, clean);
      const isPinned = pinnedSet.has(meta.id);
      const isMuted = mutedSet.has(meta.id);

      if (meta.type === 'saved') {
        chats.push({
          id: meta.id,
          type: 'saved',
          title: 'Saved Messages',
          participants: meta.participants,
          peer: null,
          isPinned: true,
          isMuted,
          pinnedMessage: visibleMeta.pinnedMessage,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastMessage: visibleMeta.lastMessage,
          unreadCount: 0
        });
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
          isPinned,
          isMuted,
          pinnedMessage: visibleMeta.pinnedMessage,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastMessage: visibleMeta.lastMessage,
          unreadCount: (meta.unreadCounts && meta.unreadCounts[clean]) || 0
        });
        continue;
      }

      const peerUsername = meta.participants.find((p) => p !== clean) || clean;
      const peerProfile = await getRawProfile(peerUsername);
      if (!peerProfile) continue;
      const peer = toPublicUser(peerProfile);

      chats.push({
        id: meta.id,
        type: meta.type || 'dm',
        participants: meta.participants,
        peer,
        isPinned,
        isMuted,
        pinnedMessage: visibleMeta.pinnedMessage,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        lastMessage: visibleMeta.lastMessage,
        unreadCount: (meta.unreadCounts && meta.unreadCounts[clean]) || 0
      });
    }

    chats.sort((a, b) => {
      if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
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
    const allMessages = (await readJson(path.join(folder, 'messages.json'), [])) || [];
    const messages = allMessages.filter((m) => !isMessageHiddenForUser(m, meta, username));
    return { meta: getVisibleChatMeta(meta, username), messages };
  }

  function buildLastMessageSummary(msg) {
    if (!msg) return null;
    const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
    let preview = '';
    if (msg.game) {
      preview = `🎮 ${msg.game.title || msg.game.type}`;
    } else if (msg.call) {
      const icon = msg.call.mode === 'video' ? '📹 Video call' : '📞 Audio call';
      if (msg.call.status === 'missed') preview = `${icon} • Missed`;
      else if (msg.call.status === 'declined') preview = `${icon} • Declined`;
      else if (msg.call.status === 'cancelled') preview = `${icon} • Cancelled`;
      else preview = msg.call.durationSec > 0 ? `${icon} • ${Math.floor(msg.call.durationSec / 60)}:${String(msg.call.durationSec % 60).padStart(2, '0')}` : icon;
    } else if (msg.text) {
      preview = msg.text.slice(0, 80);
    } else if (atts[0]) {
      if (atts[0].isImage) preview = '📷 Photo';
      else if (atts[0].mimeType && atts[0].mimeType.startsWith('audio/')) preview = '🎤 Voice message';
      else preview = `📎 ${atts[0].originalName}`;
    }
    return {
      id: msg.id,
      sender: msg.sender,
      preview,
      hasImage: atts.some((a) => a.isImage),
      hasFile: atts.some((a) => !a.isImage),
      createdAt: msg.createdAt
    };
  }

  async function appendChatMessage(chatId, senderUsername, { text = '', files = [], replyToId = null, kind = 'text', game = null, call = null, forwardedFrom = null, linkPreview = null, allowChannelSystem = false }) {
    const folder = chatFolder(chatId);
    if (!folder) {
      const err = new Error('Invalid chat ID.');
      err.statusCode = 400;
      throw err;
    }

    const cleanText = typeof text === 'string' ? text.trim().slice(0, 4000) : '';
    if (!cleanText && (!files || files.length === 0) && !game && !call) {
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
      const msgKind = game ? 'game' : (call ? 'call' : kind);
      const readBy = call && call.status !== 'missed' && Array.isArray(meta.participants)
        ? meta.participants.slice()
        : [senderUsername];
      const message = {
        id: `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        chatId,
        kind: msgKind,
        sender: senderUsername,
        text: cleanText,
        mentions,
        attachments,
        replyTo: replySnapshot,
        forwardedFrom: forwardedFrom || undefined,
        linkPreview: linkPreview || undefined,
        game: game || undefined,
        call: call || undefined,
        reactions: {},
        readBy,
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

      // Update meta & revive chat visibility for participants on new activity
      meta.updatedAt = now;
      meta.lastMessage = buildLastMessageSummary(message);
      if (Array.isArray(meta.hiddenFor) && meta.hiddenFor.length > 0) {
        meta.hiddenFor = [];
      }
      if (meta.lastMessageByUser) {
        delete meta.lastMessageByUser;
      }
      meta.unreadCounts = meta.unreadCounts || {};
      const markUnreadForPeer = !call || call.status === 'missed';
      if (markUnreadForPeer) {
        for (const participant of meta.participants) {
          if (participant !== senderUsername) {
            meta.unreadCounts[participant] = (meta.unreadCounts[participant] || 0) + 1;
          }
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

  async function editMessage(chatId, messageId, username, newText) {
    const cleanText = typeof newText === 'string' ? newText.trim().slice(0, 4000) : '';
    if (!cleanText) {
      const err = new Error('Edited message text cannot be empty.');
      err.statusCode = 400;
      throw err;
    }

    return mutateChatMessages(chatId, async ({ meta, messages, folder }) => {
      if (!meta.participants.includes(username)) {
        const err = new Error('Chat not found.');
        err.statusCode = 404;
        throw err;
      }
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return null;
      if (msg.sender !== username) {
        const err = new Error('You can only edit your own messages.');
        err.statusCode = 403;
        throw err;
      }
      if (msg.kind === 'game' || msg.kind === 'call' || msg.kind === 'system') {
        const err = new Error('This message type cannot be edited.');
        err.statusCode = 400;
        throw err;
      }

      const now = new Date().toISOString();
      msg.text = cleanText;
      msg.mentions = extractMentions(cleanText);
      msg.editedAt = now;

      let saveMeta = false;
      if (meta.lastMessage && meta.lastMessage.id === msg.id) {
        meta.lastMessage = buildLastMessageSummary(msg);
        saveMeta = true;
      }
      if (meta.pinnedMessage && meta.pinnedMessage.id === msg.id) {
        meta.pinnedMessage.preview = cleanText.slice(0, 120);
        saveMeta = true;
      }

      const logPath = path.join(folder, 'chat.log');
      await fsp.appendFile(logPath, `[${now}] SYSTEM: ${username} edited message ${messageId}\n`, 'utf8').catch(() => {});
      return { message: msg, saveMessages: true, saveMeta };
    });
  }

  async function setMessageLinkPreview(chatId, messageId, linkPreview) {
    if (!linkPreview) return null;
    return mutateChatMessages(chatId, ({ messages }) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return null;
      msg.linkPreview = linkPreview;
      return { message: msg, saveMessages: true, saveMeta: false };
    });
  }

  async function pinMessage(chatId, messageId, username, unpin = false) {
    const folder = chatFolder(chatId);
    if (!folder) return null;
    return withLock(`chat:${chatId}`, async () => {
      const metaPath = path.join(folder, 'meta.json');
      const messagesPath = path.join(folder, 'messages.json');
      const meta = await readJson(metaPath);
      if (!meta || !meta.participants.includes(username)) return null;
      if (meta.type === 'channel' && (!Array.isArray(meta.admins) || !meta.admins.includes(username))) {
        const err = new Error('Only channel admins can pin or unpin messages.');
        err.statusCode = 403;
        throw err;
      }

      if (unpin || !messageId) {
        meta.pinnedMessage = null;
        meta.pinnedHiddenFor = [];
        await writeJsonAtomic(metaPath, meta);
        return { pinnedMessage: null, meta };
      }

      const messages = (await readJson(messagesPath, [])) || [];
      const target = messages.find((m) => m.id === messageId);
      if (!target) return null;
      const summary = buildLastMessageSummary(target);
      meta.pinnedHiddenFor = [];
      meta.pinnedMessage = {
        id: target.id,
        sender: target.sender,
        preview: (target.text ? target.text.slice(0, 120) : (summary ? summary.preview : 'Pinned message')),
        pinnedBy: username,
        pinnedAt: new Date().toISOString()
      };
      await writeJsonAtomic(metaPath, meta);
      return { pinnedMessage: meta.pinnedMessage, meta };
    });
  }

  async function bulkDeleteMessages(chatId, messageIds, username, { forEveryone = true } = {}) {
    const folder = chatFolder(chatId);
    if (!folder) return null;
    const idSet = new Set(Array.isArray(messageIds) ? messageIds.map(String) : []);
    if (idSet.size === 0) return null;

    return withLock(`chat:${chatId}`, async () => {
      const metaPath = path.join(folder, 'meta.json');
      const messagesPath = path.join(folder, 'messages.json');
      const logPath = path.join(folder, 'chat.log');

      const meta = await readJson(metaPath);
      if (!meta || !meta.participants.includes(username)) return null;

      const messages = (await readJson(messagesPath, [])) || [];
      const deletedIds = [];
      const forEveryoneIds = [];
      const deletedForMeIds = [];
      const kept = [];
      const isChannelAdmin = meta.type === 'channel' && Array.isArray(meta.admins) && meta.admins.includes(username);

      for (const target of messages) {
        if (!idSet.has(target.id)) {
          kept.push(target);
          continue;
        }

        const isOwner = target.sender === username || isChannelAdmin;
        const shouldRemoveGlobally = Boolean(forEveryone) && isOwner;

        if (forEveryone && !isOwner && idSet.size === 1) {
          const err = new Error('You can only delete your own messages for everyone.');
          err.statusCode = 403;
          throw err;
        }

        if (shouldRemoveGlobally) {
          if (Array.isArray(target.attachments)) {
            for (const att of target.attachments) {
              const filePath = path.join(folder, 'files', path.basename(att.storedName));
              await fsp.unlink(filePath).catch(() => {});
            }
          }
          deletedIds.push(target.id);
          forEveryoneIds.push(target.id);
        } else {
          if (!Array.isArray(target.deletedFor)) target.deletedFor = [];
          if (!target.deletedFor.includes(username)) {
            target.deletedFor.push(username);
          }
          const allDeletedForAll = Array.isArray(meta.participants) &&
            meta.participants.length > 0 &&
            meta.participants.every((p) => target.deletedFor.includes(p));
          if (allDeletedForAll) {
            if (Array.isArray(target.attachments)) {
              for (const att of target.attachments) {
                const filePath = path.join(folder, 'files', path.basename(att.storedName));
                await fsp.unlink(filePath).catch(() => {});
              }
            }
          } else {
            kept.push(target);
          }
          deletedIds.push(target.id);
          deletedForMeIds.push(target.id);
        }
      }

      if (deletedIds.length === 0) return null;

      await writeJsonAtomic(messagesPath, kept);
      await fsp.appendFile(
        logPath,
        `[${new Date().toISOString()}] SYSTEM: ${username} deleted ${deletedIds.length} message(s) (${forEveryoneIds.length} for everyone, ${deletedForMeIds.length} for self)\n`,
        'utf8'
      ).catch(() => {});

      const last = kept[kept.length - 1];
      meta.lastMessage = buildLastMessageSummary(last);

      if (deletedForMeIds.length > 0) {
        meta.lastMessageByUser = meta.lastMessageByUser || {};
        const visibleForUser = kept.filter((m) => !isMessageHiddenForUser(m, meta, username));
        meta.lastMessageByUser[username] = buildLastMessageSummary(visibleForUser[visibleForUser.length - 1]);
      } else if (meta.lastMessageByUser && forEveryoneIds.length > 0) {
        for (const p of meta.participants) {
          const visibleForP = kept.filter((m) => !isMessageHiddenForUser(m, meta, p));
          meta.lastMessageByUser[p] = buildLastMessageSummary(visibleForP[visibleForP.length - 1]);
        }
      }

      if (meta.pinnedMessage && forEveryoneIds.includes(meta.pinnedMessage.id)) {
        meta.pinnedMessage = null;
      } else if (meta.pinnedMessage && deletedForMeIds.includes(meta.pinnedMessage.id)) {
        if (!Array.isArray(meta.pinnedHiddenFor)) meta.pinnedHiddenFor = [];
        if (!meta.pinnedHiddenFor.includes(username)) meta.pinnedHiddenFor.push(username);
      }

      meta.updatedAt = new Date().toISOString();
      await writeJsonAtomic(metaPath, meta);

      return { deletedIds, forEveryoneIds, deletedForMeIds, meta };
    });
  }

  async function deleteMessage(chatId, messageId, username, opts = {}) {
    const res = await bulkDeleteMessages(chatId, [messageId], username, opts);
    if (!res) return null;
    return {
      deletedId: res.deletedIds[0],
      forEveryone: res.forEveryoneIds.includes(res.deletedIds[0]),
      meta: res.meta
    };
  }

  async function removeChatFromUserPrefs(username, chatId) {
    const clean = String(username || '').trim().toLowerCase();
    const folder = userFolder(clean);
    if (!folder) return;
    await withLock(`chatprefs:${clean}`, async () => {
      const prefsPath = path.join(folder, 'chat_prefs.json');
      const cur = await getUserChatPrefs(clean);
      const pinnedChats = cur.pinnedChats.filter((id) => id !== chatId);
      const mutedChats = cur.mutedChats.filter((id) => id !== chatId);
      if (pinnedChats.length !== cur.pinnedChats.length || mutedChats.length !== cur.mutedChats.length) {
        await writeJsonAtomic(prefsPath, { pinnedChats, mutedChats });
      }
    });
  }

  async function deleteChatForUser(chatId, username, { forEveryone = false } = {}) {
    const folder = chatFolder(chatId);
    if (!folder) return null;

    const outcome = await withLock(`chat:${chatId}`, async () => {
      const metaPath = path.join(folder, 'meta.json');
      const messagesPath = path.join(folder, 'messages.json');
      const logPath = path.join(folder, 'chat.log');

      const meta = await readJson(metaPath);
      if (!meta || !Array.isArray(meta.participants) || !meta.participants.includes(username)) {
        return null;
      }

      const participantsSnapshot = meta.participants.slice();
      const isRoom = meta.type === 'group' || meta.type === 'channel';
      const isSaved = meta.type === 'saved';

      if (isSaved) {
        await fsp.rm(folder, { recursive: true, force: true });
        return {
          chatId,
          forEveryone: false,
          removed: true,
          participantsToClean: [username],
          notifiedUsers: [username]
        };
      }

      if (isRoom) {
        if (forEveryone) {
          const isRoomAdmin = meta.createdBy === username || (Array.isArray(meta.admins) && meta.admins.includes(username));
          if (!isRoomAdmin) {
            const err = new Error('Only group/channel admins can delete this room for everyone.');
            err.statusCode = 403;
            throw err;
          }
          await fsp.rm(folder, { recursive: true, force: true });
          return {
            chatId,
            forEveryone: true,
            removed: true,
            participantsToClean: participantsSnapshot,
            notifiedUsers: participantsSnapshot
          };
        }

        // Delete for self in room = leave room
        meta.participants = meta.participants.filter((p) => p !== username);
        if (Array.isArray(meta.admins)) {
          meta.admins = meta.admins.filter((a) => a !== username);
        }
        if (meta.participants.length === 0) {
          await fsp.rm(folder, { recursive: true, force: true });
        } else {
          meta.updatedAt = new Date().toISOString();
          await writeJsonAtomic(metaPath, meta);
        }
        return {
          chatId,
          forEveryone: false,
          removed: true,
          participantsToClean: [username],
          notifiedUsers: [username],
          roomRemainingUsers: meta.participants.slice(),
          meta
        };
      }

      // Direct message
      if (forEveryone) {
        await fsp.rm(folder, { recursive: true, force: true });
        return {
          chatId,
          forEveryone: true,
          removed: true,
          participantsToClean: participantsSnapshot,
          notifiedUsers: participantsSnapshot
        };
      }

      // DM delete for self only: hide from sidebar and clear history prior to now
      const now = new Date().toISOString();
      if (!Array.isArray(meta.hiddenFor)) meta.hiddenFor = [];
      if (!meta.hiddenFor.includes(username)) meta.hiddenFor.push(username);
      meta.clearedBeforeByUser = meta.clearedBeforeByUser || {};
      meta.clearedBeforeByUser[username] = now;
      meta.lastMessageByUser = meta.lastMessageByUser || {};
      meta.lastMessageByUser[username] = null;
      meta.unreadCounts = meta.unreadCounts || {};
      meta.unreadCounts[username] = 0;
      if (meta.pinnedMessage) {
        if (!Array.isArray(meta.pinnedHiddenFor)) meta.pinnedHiddenFor = [];
        if (!meta.pinnedHiddenFor.includes(username)) meta.pinnedHiddenFor.push(username);
      }

      const everyoneHid = participantsSnapshot.every((p) => meta.hiddenFor.includes(p));
      if (everyoneHid) {
        await fsp.rm(folder, { recursive: true, force: true });
      } else {
        await writeJsonAtomic(metaPath, meta);
        await fsp.appendFile(logPath, `[${now}] SYSTEM: ${username} cleared & removed chat for self\n`, 'utf8').catch(() => {});
        const messages = (await readJson(messagesPath, [])) || [];
        let cleanedMsgs = 0;
        const nextMsgs = messages.filter((m) => {
          const allCleared = participantsSnapshot.every((p) => isMessageHiddenForUser(m, meta, p));
          if (allCleared) cleanedMsgs++;
          return !allCleared;
        });
        if (cleanedMsgs > 0) {
          await writeJsonAtomic(messagesPath, nextMsgs);
        }
      }

      return {
        chatId,
        forEveryone: false,
        removed: true,
        participantsToClean: [username],
        notifiedUsers: [username]
      };
    });

    if (!outcome) return null;
    for (const u of outcome.participantsToClean) {
      await removeChatFromUserPrefs(u, chatId);
    }
    return outcome;
  }

  async function bulkDeleteChats(chatIds, username, { forEveryone = false } = {}) {
    const ids = Array.isArray(chatIds) ? chatIds.map(String).filter((id) => CHAT_ID_REGEX.test(id)) : [];
    const results = [];
    for (const chatId of ids) {
      const res = await deleteChatForUser(chatId, username, { forEveryone });
      if (res) results.push(res);
    }
    return results;
  }

  async function forwardMessages({ fromChatId, messageIds, targetChatId, senderUsername }) {
    const srcFolder = chatFolder(fromChatId);
    const dstFolder = chatFolder(targetChatId);
    if (!srcFolder || !dstFolder) {
      const err = new Error('Invalid chat ID.');
      err.statusCode = 400;
      throw err;
    }

    const srcData = await getMessages(fromChatId, senderUsername);
    const idSet = new Set(Array.isArray(messageIds) ? messageIds.map(String) : []);
    const selected = srcData.messages.filter((m) => idSet.has(m.id));
    if (selected.length === 0) {
      const err = new Error('No messages selected to forward.');
      err.statusCode = 400;
      throw err;
    }

    const srcTitle = srcData.meta.title || (srcData.meta.type === 'saved' ? 'Saved Messages' : null);
    const created = [];

    for (const orig of selected) {
      const filesToCopy = [];
      if (Array.isArray(orig.attachments)) {
        for (const att of orig.attachments) {
          const srcFilePath = await getChatFilePath(fromChatId, att.storedName, senderUsername);
          if (srcFilePath) {
            const data = await fsp.readFile(srcFilePath).catch(() => null);
            if (data) {
              filesToCopy.push({
                filename: att.originalName || 'file',
                mimeType: att.mimeType || 'application/octet-stream',
                data
              });
            }
          }
        }
      }

      const fwdText = orig.text || (orig.game ? `🎮 ${orig.game.title}` : '');
      if (!fwdText && filesToCopy.length === 0) continue;

      const { message, meta } = await appendChatMessage(targetChatId, senderUsername, {
        text: fwdText,
        files: filesToCopy,
        linkPreview: orig.linkPreview || null,
        forwardedFrom: {
          sender: orig.sender,
          chatTitle: srcTitle
        }
      });
      created.push({ message, meta });
    }

    return created;
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
    getSavedChatId,
    withLock,
    userFolder,
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
    resendOtpSession: resendPendingRegistration,
    createPasswordResetRequest,
    resetPasswordWithOtp,
    changeUserPassword,
    createDeleteAccountOtp,
    confirmDeleteAccount,
    updateUserPrivacy,
    blockUser,
    unblockUser,
    listBlockedUsers,
    getBlockStatus,
    createReport,
    getRawProfile,
    updateLastSeen,
    updateUserProfile,
    updateAccountProfile,
    saveUserAvatar,
    removeUserAvatar,
    getUserAvatarPath,
    searchUsers,
    ensureChatFolder,
    ensureSavedChatFolder,
    getUserChatPrefs,
    setUserChatPref,
    setUserChatPrefsBulk,
    getChatMeta,
    listChatsForUser,
    getMessages,
    appendChatMessage,
    editMessage,
    setMessageLinkPreview,
    pinMessage,
    markChatRead,
    toggleReaction,
    deleteMessage,
    bulkDeleteMessages,
    deleteChatForUser,
    bulkDeleteChats,
    forwardMessages,
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
