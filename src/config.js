const fs = require('node:fs');
const path = require('node:path');

function loadDotEnv(rootDir) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = line.slice(0, eqIndex).trim();
      let val = line.slice(eqIndex + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore malformed .env
  }
}

function createConfig(overrides = {}) {
  const rootDir = overrides.rootDir || path.resolve(__dirname, '..');
  if (!overrides.skipDotEnv) {
    loadDotEnv(rootDir);
  }

  const dataDir = overrides.dataDir || process.env.DATA_DIR || path.join(rootDir, 'data');
  const maxUploadMb = Number(overrides.maxUploadMb ?? process.env.MAX_UPLOAD_MB ?? 25) || 25;

  const smtpHost = overrides.smtpHost ?? process.env.SMTP_HOST ?? '';
  const smtpPort = Number(overrides.smtpPort ?? process.env.SMTP_PORT ?? 587) || 587;
  const smtpUser = overrides.smtpUser ?? process.env.SMTP_USER ?? '';
  const smtpPass = overrides.smtpPass ?? process.env.SMTP_PASS ?? '';
  const smtpFrom = overrides.smtpFrom ?? process.env.SMTP_FROM ?? smtpUser;
  const smtpSecureRaw = overrides.smtpSecure ?? process.env.SMTP_SECURE;
  const smtpSecure = smtpSecureRaw !== undefined
    ? String(smtpSecureRaw).toLowerCase() === 'true'
    : smtpPort === 465;

  return {
    rootDir,
    publicDir: path.join(rootDir, 'public'),
    dataDir,
    usersDir: path.join(dataDir, 'users'),
    chatsDir: path.join(dataDir, 'chats'),
    pendingDir: path.join(dataDir, 'pending'),
    outboxDir: path.join(dataDir, 'outbox'),
    universalLogPath: overrides.universalLogPath || process.env.UNIVERSAL_LOG_PATH || path.join(dataDir, 'universal.log'),
    port: Number(overrides.port ?? process.env.PORT ?? 3000),
    host: overrides.host ?? process.env.HOST ?? '127.0.0.1',
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    maxUploadMb,
    sessionSecret: overrides.sessionSecret || process.env.SESSION_SECRET || null,
    sessionCookieName: 'telechat_session',
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    verificationTtlMs: Number(overrides.verificationTtlMs ?? 5 * 60 * 1000), // 5 minutes
    verificationResendCooldownMs: Number(overrides.verificationResendCooldownMs ?? 2 * 60 * 1000), // 2 minutes initial
    verificationResendStepMs: Number(overrides.verificationResendStepMs ?? 2 * 60 * 1000), // +2 minutes per resend
    verificationSessionTtlMs: Number(overrides.verificationSessionTtlMs ?? 60 * 60 * 1000), // 60 minutes session lifetime
    allowDevEmailCode: overrides.allowDevEmailCode ?? (process.env.ALLOW_DEV_EMAIL_CODE !== 'false'),
    push: {
      vapidPublicKey: overrides.vapidPublicKey ?? process.env.VAPID_PUBLIC_KEY ?? '',
      vapidPrivateKey: overrides.vapidPrivateKey ?? process.env.VAPID_PRIVATE_KEY ?? '',
      vapidSubject: overrides.vapidSubject ?? process.env.VAPID_SUBJECT ?? 'mailto:admin@viberoom.app',
      fcmServiceAccountJson: overrides.fcmServiceAccountJson ?? process.env.FCM_SERVICE_ACCOUNT_JSON ?? '',
      fcmProjectId: overrides.fcmProjectId ?? process.env.FCM_PROJECT_ID ?? '',
      fcmClientEmail: overrides.fcmClientEmail ?? process.env.FCM_CLIENT_EMAIL ?? '',
      fcmPrivateKey: overrides.fcmPrivateKey ?? process.env.FCM_PRIVATE_KEY ?? '',
      fcmServerKey: overrides.fcmServerKey ?? process.env.FCM_SERVER_KEY ?? ''
    },
    smtp: overrides.smtp === null
      ? null
      : (smtpHost && smtpUser && smtpPass
        ? {
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          user: smtpUser,
          pass: smtpPass,
          from: smtpFrom || smtpUser
        }
        : null)
  };
}

module.exports = { createConfig };
