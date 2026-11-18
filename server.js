const http = require('node:http');
const { createConfig } = require('./src/config');
const { createAuthHelpers } = require('./src/auth');
const { createStorage } = require('./src/storage');
const { createRealtimeHub } = require('./src/realtime');
const { createMailer } = require('./src/mailer');
const { createAuditLogger } = require('./src/audit');
const { createPushService } = require('./src/push');
const { createRouter } = require('./src/router');

function createApp(overrides = {}) {
  const config = createConfig(overrides);
  const auth = createAuthHelpers(config);
  const storage = createStorage(config);
  const hub = createRealtimeHub();
  const mailer = createMailer(config);
  const audit = createAuditLogger(config);
  const push = createPushService({ config, storage });
  const handleRequest = createRouter({ config, auth, storage, hub, mailer, audit, push });

  const expiryTimer = setInterval(async () => {
    try {
      const purged = await storage.purgeAllExpiredMessages();
      for (const item of purged) {
        for (const msgId of item.expiredIds) {
          hub.emitToUsers(item.participants, 'message_deleted', {
            chatId: item.chatId,
            messageId: msgId,
            forEveryone: true,
            expired: true
          });
        }
      }
    } catch {
      // Ignore periodic expiry sweep errors
    }
  }, 5000);
  if (typeof expiryTimer.unref === 'function') expiryTimer.unref();

  const server = http.createServer(handleRequest);
  return { server, config, auth, storage, hub, mailer, audit, push };
}

if (require.main === module) {
  const { server, config, audit } = createApp();
  server.listen(config.port, config.host, () => {
    audit.log({
      action: 'SERVER_STARTED',
      username: 'system',
      details: { url: `http://${config.host}:${config.port}` }
    });
    console.log(`VibeRoom running at http://${config.host}:${config.port}`);
    console.log(`User folders: ${config.usersDir}`);
    console.log(`Chat log folders: ${config.chatsDir}`);
    console.log(`Universal audit log: ${audit.universalLogPath}`);
  });
}

module.exports = { createApp };
