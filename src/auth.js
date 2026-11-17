const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function ensureSecret(config) {
  if (config.sessionSecret) return config.sessionSecret;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const secretFile = path.join(config.dataDir, '.secret');
  if (fs.existsSync(secretFile)) {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) {
      config.sessionSecret = existing;
      return existing;
    }
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
  config.sessionSecret = generated;
  return generated;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

function signToken(payloadObj, secret) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded.username !== 'string' || typeof decoded.exp !== 'number') {
      return null;
    }
    if (Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

function createAuthHelpers(config) {
  const secret = ensureSecret(config);

  function createSessionCookie(username) {
    const token = signToken(
      { username, exp: Date.now() + config.sessionTtlMs },
      secret
    );
    const maxAge = Math.floor(config.sessionTtlMs / 1000);
    return `${config.sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  }

  function clearSessionCookie() {
    return `${config.sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }

  function getSessionUser(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[config.sessionCookieName];
    if (!token) return null;
    return verifyToken(token, secret);
  }

  return {
    hashPassword,
    verifyPassword,
    createSessionCookie,
    clearSessionCookie,
    getSessionUser
  };
}

module.exports = {
  createAuthHelpers,
  hashPassword,
  verifyPassword
};
