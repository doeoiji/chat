const http = require('node:http');
const { createConfig } = require('./src/config');
const { createAuthHelpers } = require('./src/auth');
const { createStorage } = require('./src/storage');
const { createRealtimeHub } = require('./src/realtime');
const { createMailer } = require('./src/mailer');
const { createAuditLogger } = require('./src/audit');
const { createRouter } = require('./src/router');

function createApp(overrides = {}) {
  const config = createConfig(overrides);
  const auth = createAuthHelpers(config);
  const storage = createStorage(config);
  const hub = createRealtimeHub();
  const mailer = createMailer(config);
  const audit = createAuditLogger(config);
  const handleRequest = createRouter({ config, auth, storage, hub, mailer, audit });

  const server = http.createServer(handleRequest);
  return { server, config, auth, storage, hub, mailer, audit };
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
