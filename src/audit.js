const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const USERNAME_SAFE_REGEX = /^[a-z0-9_]{3,24}$/;

// Concise milestone/security actions written to each user's per-user universal.log
const NECESSARY_USER_ACTIONS = new Set([
  'EMAIL_VERIFIED_REGISTER',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'USERNAME_RENAMED',
  'PROFILE_UPDATED',
  'PRIVACY_UPDATED',
  'PASSWORD_RESET_REQUEST',
  'PASSWORD_RESET',
  'PASSWORD_CHANGED',
  'ACCOUNT_DELETE_REQUEST',
  'ACCOUNT_DELETED',
  'USER_BLOCKED',
  'USER_UNBLOCKED',
  'USER_REPORTED',
  'AVATAR_UPDATED',
  'AVATAR_REMOVED',
  'MESSAGE_SENT',
  'MESSAGE_EDITED',
  'MESSAGE_DELETED',
  'MESSAGES_FORWARDED',
  'CHAT_PINNED',
  'CHAT_PREFS_UPDATED',
  'CHAT_DELETED',
  'ROOM_CREATED',
  'ROOM_JOINED_INVITE',
  'ROOM_UPDATED',
  'ROOM_MEMBER_ADDED',
  'ROOM_MEMBER_REMOVED',
  'ROOM_LEFT',
  'ROOM_ADMIN_CHANGED',
  'STRANGER_MATCHED',
  'STRANGER_MESSAGE',
  'STRANGER_MUTUAL_REVEAL',
  'STRANGER_REPORTED',
  'CALL_STARTED',
  'CALL_ACCEPTED',
  'CALL_COMPLETED',
  'CALL_DECLINED',
  'CALL_DECLINED_BY_USER',
  'CALL_MISSED',
  'CALL_CANCELLED',
  'CALL_ENDED_BY_USER',
  'GAME_STARTED',
  'GAME_CANCELLED',
  'FRIEND_REQUEST_SENT',
  'FRIEND_ACCEPTED',
  'FRIEND_DECLINED',
  'FRIEND_REQUEST_CANCELLED',
  'UNFRIENDED',
  'SESSION_INVALID'
]);

function sanitizeLogValue(val, maxLen = 280) {
  return String(val ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function normalizeIp(rawIp) {
  let ip = sanitizeLogValue(rawIp, 128);
  if (!ip) return 'unknown';
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return ip || 'unknown';
}

function parseDeviceSummary(uaRaw) {
  const ua = sanitizeLogValue(uaRaw, 320);
  if (!ua) return 'Unknown Device';

  const isWebView = /;\s*wv\)|VibeRoom-Android/i.test(ua);
  let os = 'Unknown OS';
  const androidMatch = /Android\s+([0-9.]+)(?:;\s*([^;)]+))?/i.exec(ua);
  if (androidMatch) {
    const model = androidMatch[2] ? `; ${androidMatch[2].replace(/\s*Build\/.*$/i, '').trim()}` : '';
    os = `Android ${androidMatch[1]}${model}`;
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    const iosMatch = /OS\s+([0-9_]+)/i.exec(ua);
    const kind = /iPad/i.test(ua) ? 'iPad' : 'iPhone';
    os = iosMatch ? `${kind} (iOS ${iosMatch[1].replace(/_/g, '.')})` : kind;
  } else if (/Windows NT/i.test(ua)) {
    os = 'Windows';
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    os = 'macOS';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  let client = 'Browser';
  if (isWebView) {
    client = 'Android App (WebView)';
  } else if (/EdgA?\/([0-9.]+)/i.test(ua)) {
    client = `Edge ${RegExp.$1.split('.')[0]}`;
  } else if (/OPR\/([0-9.]+)/i.test(ua)) {
    client = `Opera ${RegExp.$1.split('.')[0]}`;
  } else if (/Chrome\/([0-9.]+)/i.test(ua) && !/Chromium/i.test(ua)) {
    client = `Chrome ${RegExp.$1.split('.')[0]}`;
  } else if (/Firefox\/([0-9.]+)/i.test(ua)) {
    client = `Firefox ${RegExp.$1.split('.')[0]}`;
  } else if (/Version\/([0-9.]+).*Safari/i.test(ua)) {
    client = `Safari ${RegExp.$1.split('.')[0]}`;
  } else if (/curl\//i.test(ua)) {
    client = 'curl';
  }

  return `${client} (${os})`;
}

function extractClientContext(req) {
  if (!req || !req.headers) {
    return { ip: 'internal', device: 'System/Internal', ua: '' };
  }
  const h = req.headers;
  const rawIp =
    h['cf-connecting-ip'] ||
    h['x-forwarded-for'] ||
    h['x-real-ip'] ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown';
  const ua = sanitizeLogValue(h['user-agent'] || '', 200);
  return {
    ip: normalizeIp(rawIp),
    device: parseDeviceSummary(ua),
    ua
  };
}

function formatDetails(details) {
  if (!details) return '';
  if (typeof details === 'string') return sanitizeLogValue(details, 500);
  const parts = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined || v === null || v === '') continue;
    const cleanVal = sanitizeLogValue(typeof v === 'object' ? JSON.stringify(v) : v, 240);
    parts.push(`${k}="${cleanVal.replace(/"/g, "'")}"`);
  }
  return parts.join(' ');
}

function createAuditLogger(config) {
  const universalLogPath = config.universalLogPath || path.join(config.dataDir, 'universal.log');
  let writeChain = Promise.resolve();

  function enqueueAppend(filePath, line, createParent = false) {
    writeChain = writeChain
      .then(async () => {
        if (createParent) {
          await fsp.mkdir(path.dirname(filePath), { recursive: true });
        }
        await fsp.appendFile(filePath, line, 'utf8');
      })
      .catch(() => {
        // Never crash request flow on audit append error
      });
    return writeChain;
  }

  function log({
    action,
    username = null,
    alsoUsers = [],
    req = null,
    client = null,
    details = null
  }) {
    const ts = new Date().toISOString();
    const ctx = client || extractClientContext(req);
    const cleanAction = sanitizeLogValue(action || 'EVENT', 64).toUpperCase();
    const cleanUser = username && USERNAME_SAFE_REGEX.test(String(username).toLowerCase())
      ? String(username).toLowerCase()
      : (username ? sanitizeLogValue(username, 64) : 'anonymous');

    const fields = [
      `[${ts}]`,
      `ACTION=${cleanAction}`,
      `user=@${cleanUser}`,
      `ip=${ctx.ip}`,
      `device="${ctx.device.replace(/"/g, "'")}"`
    ];
    if (ctx.ua) {
      fields.push(`ua="${ctx.ua.replace(/"/g, "'")}"`);
    }
    const detailStr = formatDetails(details);
    if (detailStr) {
      fields.push(detailStr);
    }
    const line = `${fields.join(' ')}\n`;

    // Concise per-user universal.log line (omits redundant verbose raw ua string)
    const isNecessaryAction =
      NECESSARY_USER_ACTIONS.has(cleanAction) ||
      (cleanAction === 'HTTP_REJECTED' && details && (details.status === 403 || details.status === 413));

    // 1. Always append to the global Universal Log
    enqueueAppend(universalLogPath, line, true);

    // 2. Append to per-user activity.log (all events) and per-user universal.log (necessary events only)
    const userTargets = new Set();
    if (username && USERNAME_SAFE_REGEX.test(String(username).toLowerCase())) {
      userTargets.add(String(username).toLowerCase());
    }
    if (Array.isArray(alsoUsers)) {
      for (const u of alsoUsers) {
        const clean = String(u || '').trim().toLowerCase();
        if (USERNAME_SAFE_REGEX.test(clean)) userTargets.add(clean);
      }
    }

    for (const targetUser of userTargets) {
      const userDir = path.join(config.usersDir, targetUser);
      if (fs.existsSync(userDir)) {
        enqueueAppend(path.join(userDir, 'activity.log'), line, false);
        if (isNecessaryAction) {
          const conciseFields = [`[${ts}]`, cleanAction];
          if (targetUser !== cleanUser) {
            conciseFields.push(`actor=@${cleanUser}`);
          }
          conciseFields.push(`ip=${ctx.ip}`, `device="${ctx.device.replace(/"/g, "'")}"`);
          if (detailStr) conciseFields.push(detailStr);
          enqueueAppend(path.join(userDir, 'universal.log'), `${conciseFields.join(' ')}\n`, false);
        }
      }
    }
  }

  function flush() {
    return writeChain;
  }

  return {
    log,
    flush,
    extractClientContext,
    universalLogPath
  };
}

module.exports = {
  createAuditLogger,
  extractClientContext,
  parseDeviceSummary,
  normalizeIp
};
