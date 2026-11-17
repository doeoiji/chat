const http = require('node:http');
const { createConfig } = require('./src/config');
const { createAuthHelpers } = require('./src/auth');
const { createStorage } = require('./src/storage');
const { createRealtimeHub } = require('./src/realtime');
const { createMailer } = require('./src/mailer');
const { createRouter } = require('./src/router');

function createApp(overrides = {}) {
  const config = createConfig(overrides);
  const auth = createAuthHelpers(config);
  const storage = createStorage(config);
  const hub = createRealtimeHub();
  const mailer = createMailer(config);
  const handleRequest = createRouter({ config, auth, storage, hub, mailer });

  const server = http.createServer(handleRequest);
  return { server, config, auth, storage, hub, mailer };
}

if (require.main === module) {
  const { server, config } = createApp();
  server.listen(config.port, config.host, () => {
    console.log(`TeleChat running at http://${config.host}:${config.port}`);
    console.log(`User folders: ${config.usersDir}`);
    console.log(`Chat log folders: ${config.chatsDir}`);
  });
}

module.exports = { createApp };
