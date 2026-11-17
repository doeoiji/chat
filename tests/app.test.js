const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { PassThrough, Writable } = require('node:stream');
const { createConfig } = require('../src/config');
const { createAuthHelpers } = require('../src/auth');
const { createStorage } = require('../src/storage');
const { createRealtimeHub } = require('../src/realtime');
const { createMailer } = require('../src/mailer');
const { createRouter } = require('../src/router');
const { validateEmail } = require('../src/emailValidator');

function invokeRouter(handleRequest, urlPath, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const reqSocket = new PassThrough();
    const outChunks = [];
    const resSocket = new Writable({
      highWaterMark: 1024 * 1024,
      write(chunk, encoding, cb) {
        outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        cb();
      }
    });
    const req = new http.IncomingMessage(reqSocket);
    req.url = urlPath;
    req.method = method;
    req.headers = {
      host: '127.0.0.1:3000',
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    };

    const res = new http.ServerResponse(req);
    res.assignSocket(resSocket);

    res.on('finish', () => {
      setImmediate(() => {
        const rawBuf = Buffer.concat(outChunks);
        const headerSep = rawBuf.indexOf('\r\n\r\n');
        const headerBlock = headerSep >= 0 ? rawBuf.subarray(0, headerSep).toString('utf8') : '';
        const bodyBuf = headerSep >= 0 ? rawBuf.subarray(headerSep + 4) : rawBuf;

        const parsedHeaders = {};
        const setCookies = [];
        for (const line of headerBlock.split('\r\n').slice(1)) {
          const idx = line.indexOf(':');
          if (idx <= 0) continue;
          const k = line.slice(0, idx).trim().toLowerCase();
          const v = line.slice(idx + 1).trim();
          if (k === 'set-cookie') setCookies.push(v);
          parsedHeaders[k] = v;
        }

        const contentType = parsedHeaders['content-type'] || '';
        const parsedBody = contentType.includes('application/json') && bodyBuf.length
          ? JSON.parse(bodyBuf.toString('utf8'))
          : bodyBuf;
        const cookieVal = setCookies[0] || null;
        resolve({
          status: res.statusCode,
          headers: parsedHeaders,
          cookie: cookieVal ? String(cookieVal).split(';')[0] : null,
          body: parsedBody
        });
      });
    });

    handleRequest(req, res).catch(reject);

    if (body !== null && body !== undefined) {
      req.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
    }
    req.push(null);
  });
}

test('emailValidator accepts valid platforms and blocks temp/fake emails', () => {
  assert.equal(validateEmail('Alice@Gmail.com').valid, true);
  assert.equal(validateEmail('alice@gmail.com').normalized, 'alice@gmail.com');
  assert.equal(validateEmail('bob@outlook.com').valid, true);
  assert.equal(validateEmail('carol@proton.me').valid, true);
  assert.equal(validateEmail('dave@icloud.com').valid, true);
  assert.equal(validateEmail('student@mit.edu').valid, true);

  // Temp mails blocked
  assert.equal(validateEmail('spammer@mailinator.com').valid, false);
  assert.equal(validateEmail('temp@10minutemail.com').valid, false);
  assert.equal(validateEmail('anon@yopmail.com').valid, false);
  assert.equal(validateEmail('fake@temp-mail.org').valid, false);
  assert.equal(validateEmail('sub@sub.guerrillamail.com').valid, false);

  // Unrecognized random domain blocked
  assert.equal(validateEmail('user@random-unverified-domain-123.xyz').valid, false);
  assert.equal(validateEmail('not-an-email').valid, false);
});

test('email verification lifecycle handles 5m expiry, progressive 2m->4m->6m resend cooldown, wrong codes, and devCode hiding', async (t) => {
  // Verify default timing configuration (5 min expiration, 2 min initial resend + 2 min increment)
  const defaultCfg = createConfig({ skipDotEnv: true, smtp: null });
  assert.equal(defaultCfg.verificationTtlMs, 5 * 60 * 1000);
  assert.equal(defaultCfg.verificationResendCooldownMs, 2 * 60 * 1000);
  assert.equal(defaultCfg.verificationResendStepMs, 2 * 60 * 1000);

  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telechat-verify-test-'));
  const config = createConfig({
    dataDir: tempDataDir,
    skipDotEnv: true,
    smtp: null,
    allowDevEmailCode: false
  });
  const auth = createAuthHelpers(config);
  const storage = createStorage(config);
  const hub = createRealtimeHub();
  const mailer = createMailer(config);
  const handleRequest = createRouter({ config, auth, storage, hub, mailer });

  t.after(() => {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  });

  const req = (urlPath, opts) => invokeRouter(handleRequest, urlPath, opts);

  const startRes = await req('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'verify_user',
      email: 'verify.user@gmail.com',
      password: 'password123'
    })
  });
  assert.equal(startRes.status, 202);
  assert.equal(startRes.body.verificationRequired, true);
  assert.equal(startRes.body.resendCooldownSeconds, 120);
  assert.equal(startRes.body.resendCount, 0);
  assert.equal(startRes.body.devCode, undefined); // hidden when allowDevEmailCode is false
  assert.equal(fs.existsSync(path.join(tempDataDir, 'users', 'verify_user')), false);

  // Extract code from outbox log
  const outboxText = fs.readFileSync(path.join(tempDataDir, 'outbox', 'verify.user@gmail.com.log'), 'utf8');
  const codeMatch = /Verification Code: (\d{6})/.exec(outboxText);
  assert.ok(codeMatch);
  const realCode = codeMatch[1];

  // Wrong code rejected with remaining attempts
  const badRes = await req('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      verificationId: startRes.body.verificationId,
      code: realCode === '000000' ? '111111' : '000000'
    })
  });
  assert.equal(badRes.status, 400);
  assert.match(badRes.body.error, /4 attempts remaining/);

  // Resend cooldown enforced
  const resendBlocked = await req('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId: startRes.body.verificationId })
  });
  assert.equal(resendBlocked.status, 429);

  // Correct code completes signup
  const okRes = await req('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      verificationId: startRes.body.verificationId,
      code: realCode
    })
  });
  assert.equal(okRes.status, 201);
  assert.equal(okRes.body.user.emailVerified, true);
  assert.ok(okRes.cookie);
  assert.ok(fs.existsSync(path.join(tempDataDir, 'users', 'verify_user', 'profile.json')));
  assert.equal(fs.existsSync(path.join(tempDataDir, 'pending', `${startRes.body.verificationId}.json`)), false);
});

test('progressive resend cooldown scales linearly and allows resending after code expiry', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telechat-progressive-test-'));
  // Scaled timings: 100ms code expiry, 150ms initial resend + 150ms increment (150ms -> 300ms -> 450ms)
  const config = createConfig({
    dataDir: tempDataDir,
    skipDotEnv: true,
    smtp: null,
    verificationTtlMs: 100,
    verificationResendCooldownMs: 150,
    verificationResendStepMs: 150,
    verificationSessionTtlMs: 10000
  });
  const auth = createAuthHelpers(config);
  const storage = createStorage(config);
  const hub = createRealtimeHub();
  const mailer = createMailer(config);
  const handleRequest = createRouter({ config, auth, storage, hub, mailer });

  t.after(() => {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  });

  const req = (urlPath, opts) => invokeRouter(handleRequest, urlPath, opts);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const reg = await req('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'prog_user',
      email: 'prog@gmail.com',
      password: 'password123'
    })
  });
  assert.equal(reg.status, 202);
  const firstCode = reg.body.devCode;

  // Wait >150ms so first code expires AND initial 150ms cooldown elapses
  await sleep(170);
  const expiredVerify = await req('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId: reg.body.verificationId, code: firstCode })
  });
  assert.equal(expiredVerify.status, 400);
  assert.match(expiredVerify.body.error, /expired/i);

  // 1st resend succeeds and doubles cooldown step (next cooldown = 150 + 1*150 = 300ms)
  const resend1 = await req('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId: reg.body.verificationId })
  });
  assert.equal(resend1.status, 200);
  assert.equal(resend1.body.resendCount, 1);

  // After 100ms (< 300ms), 2nd resend must still be blocked
  await sleep(100);
  const tooEarly = await req('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId: reg.body.verificationId })
  });
  assert.equal(tooEarly.status, 429);

  // Wait remaining cooldown and do 2nd resend (next cooldown = 150 + 2*150 = 450ms)
  await sleep(240);
  const resend2 = await req('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId: reg.body.verificationId })
  });
  assert.equal(resend2.status, 200);
  assert.equal(resend2.body.resendCount, 2);

  // Verify immediately with fresh 2nd resend code
  const ok = await req('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId: reg.body.verificationId, code: resend2.body.devCode })
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.username, 'prog_user');
});

test('full user registration, folder storage, search, chat logs, and image/file upload flow', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telechat-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const auth = createAuthHelpers(config);
  const storage = createStorage(config);
  const hub = createRealtimeHub();
  const mailer = createMailer(config);
  const handleRequest = createRouter({ config, auth, storage, hub, mailer });

  t.after(() => {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  });

  const req = (urlPath, opts) => invokeRouter(handleRequest, urlPath, opts);

  async function registerAndVerify(payload) {
    const start = await req('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(start.status, 202);
    assert.equal(start.body.verificationRequired, true);
    assert.match(start.body.devCode, /^\d{6}$/);

    const verified = await req('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationId: start.body.verificationId,
        code: start.body.devCode
      })
    });
    return verified;
  }

  // 1. Reject temp email registration
  const tempRes = await req('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'tempuser',
      email: 'tempuser@mailinator.com',
      password: 'password123'
    })
  });
  assert.equal(tempRes.status, 400);
  assert.match(tempRes.body.error, /Temporary|disposable/i);

  // 2. Register & verify Alice & Bob with valid emails
  const aliceReg = await registerAndVerify({
    username: 'Alice_01',
    displayName: 'Alice Wonderland',
    email: 'Alice@gmail.com',
    password: 'secretPassword1'
  });
  assert.equal(aliceReg.status, 201);
  assert.equal(aliceReg.body.user.username, 'alice_01');
  assert.equal(aliceReg.body.user.emailVerified, true);
  assert.equal(aliceReg.body.user.passwordHash, undefined);
  assert.ok(aliceReg.cookie);

  const bobReg = await registerAndVerify({
    username: 'bob_dev',
    email: 'bob.dev@outlook.com',
    password: 'secretPassword2'
  });
  assert.equal(bobReg.status, 201);
  assert.ok(bobReg.cookie);

  // Verify user folders were created on disk
  assert.ok(fs.existsSync(path.join(tempDataDir, 'users', 'alice_01', 'profile.json')));
  assert.ok(fs.existsSync(path.join(tempDataDir, 'users', 'bob_dev', 'profile.json')));

  // 3. Login by email
  const bobLogin = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'bob.dev@outlook.com',
      password: 'secretPassword2'
    })
  });
  assert.equal(bobLogin.status, 200);
  assert.equal(bobLogin.body.user.username, 'bob_dev');

  // 4. Search by email and by username
  const searchByEmail = await req('/api/users/search?q=bob.dev@outlook.com', {
    headers: { Cookie: aliceReg.cookie }
  });
  assert.equal(searchByEmail.status, 200);
  assert.equal(searchByEmail.body.users.length, 1);
  assert.equal(searchByEmail.body.users[0].username, 'bob_dev');

  const searchByUsername = await req('/api/users/search?q=alice_01', {
    headers: { Cookie: bobReg.cookie }
  });
  assert.equal(searchByUsername.status, 200);
  assert.equal(searchByUsername.body.users.length, 1);
  assert.equal(searchByUsername.body.users[0].email, 'alice@gmail.com');

  // 5. Open chat (should NOT create chat folder yet until first message)
  const openRes = await req('/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: aliceReg.cookie },
    body: JSON.stringify({ targetUsername: 'bob_dev' })
  });
  assert.equal(openRes.status, 200);
  const chatId = openRes.body.chat.id;
  assert.equal(chatId, 'dm_alice_01__bob_dev');
  assert.equal(fs.existsSync(path.join(tempDataDir, 'chats', chatId)), false);

  // 6. Send text message -> creates chat folder & chat.log
  const msg1Res = await req(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: aliceReg.cookie },
    body: JSON.stringify({ text: 'Hey Bob! Welcome to TeleChat.' })
  });
  assert.equal(msg1Res.status, 201);
  assert.equal(msg1Res.body.message.text, 'Hey Bob! Welcome to TeleChat.');

  const chatFolder = path.join(tempDataDir, 'chats', chatId);
  assert.ok(fs.existsSync(path.join(chatFolder, 'meta.json')));
  assert.ok(fs.existsSync(path.join(chatFolder, 'messages.json')));
  assert.ok(fs.existsSync(path.join(chatFolder, 'chat.log')));

  const logContent = fs.readFileSync(path.join(chatFolder, 'chat.log'), 'utf8');
  assert.match(logContent, /alice_01: Hey Bob! Welcome to TeleChat\./);

  // 7. Upload an image and a text file via multipart/form-data
  const boundary = '----TeleChatTestBoundary987654';
  const multipartBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nHere is a photo and a note\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello file content\r\n--${boundary}--\r\n`)
  ]);

  const uploadRes = await req(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      Cookie: bobReg.cookie,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: multipartBody
  });
  assert.equal(uploadRes.status, 201);
  assert.equal(uploadRes.body.message.attachments.length, 2);
  assert.equal(uploadRes.body.message.attachments[0].isImage, true);
  assert.equal(uploadRes.body.message.attachments[1].isImage, false);

  // Verify uploaded files are stored inside the chat's files/ directory
  const storedFiles = fs.readdirSync(path.join(chatFolder, 'files'));
  assert.equal(storedFiles.length, 2);

  // 8. Download uploaded file as participant & verify static serving
  const notesAtt = uploadRes.body.message.attachments[1];
  const savedFilePath = await storage.getChatFilePath(chatId, notesAtt.storedName, 'alice_01');
  assert.ok(savedFilePath);
  assert.equal(fs.readFileSync(savedFilePath, 'utf8'), 'hello file content');

  const dlRes = await req(notesAtt.url, { headers: { Cookie: aliceReg.cookie } });
  assert.equal(dlRes.status, 200);
  assert.equal(dlRes.body.toString('utf8'), 'hello file content');

  const homeRes = await req('/');
  assert.equal(homeRes.status, 200);
  const homeHtml = homeRes.body.toString('utf8');
  assert.match(homeHtml, /<title>VibeRoom/);
  assert.match(homeHtml, /\/styles\.css\?v=[a-f0-9]{8}/);
  assert.match(homeHtml, /\/app\.js\?v=[a-f0-9]{8}/);
  assert.equal(homeRes.headers['cache-control'], 'no-store');

  const manifestRes = await req('/manifest.webmanifest');
  assert.equal(manifestRes.status, 200);
  const manifestJson = JSON.parse(manifestRes.body.toString('utf8'));
  assert.equal(manifestJson.name, 'VibeRoom');

  // Non-participant should be denied access to files
  const carolReg = await registerAndVerify({
    username: 'carol_x',
    email: 'carol@proton.me',
    password: 'secretPassword3'
  });
  assert.equal(carolReg.status, 201);
  const deniedRes = await req(notesAtt.url, { headers: { Cookie: carolReg.cookie } });
  assert.equal(deniedRes.status, 404);

  // 9. Profile update & avatar upload
  const patchProfile = await req('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: aliceReg.cookie },
    body: JSON.stringify({ displayName: 'Alice W.', bio: 'Telegram fan' })
  });
  assert.equal(patchProfile.status, 200);
  assert.equal(patchProfile.body.user.displayName, 'Alice W.');
  assert.equal(patchProfile.body.user.bio, 'Telegram fan');

  const avatarBoundary = '----AvatarBoundary123';
  const avatarBody = Buffer.concat([
    Buffer.from(`--${avatarBoundary}\r\nContent-Disposition: form-data; name="avatar"; filename="me.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.from(`\r\n--${avatarBoundary}--\r\n`)
  ]);
  const avatarRes = await req('/api/users/me/avatar', {
    method: 'POST',
    headers: { Cookie: aliceReg.cookie, 'Content-Type': `multipart/form-data; boundary=${avatarBoundary}` },
    body: avatarBody
  });
  assert.equal(avatarRes.status, 200);
  assert.ok(avatarRes.body.user.avatarUrl);

  // Avatars > 8 MB (common for phone camera images) should also succeed up to maxUploadBytes
  const largeAvatarBody = Buffer.concat([
    Buffer.from(`--${avatarBoundary}\r\nContent-Disposition: form-data; name="avatar"; filename="big.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    Buffer.alloc(9 * 1024 * 1024, 0xaa),
    Buffer.from(`\r\n--${avatarBoundary}--\r\n`)
  ]);
  const largeAvatarRes = await req('/api/users/me/avatar', {
    method: 'POST',
    headers: { Cookie: aliceReg.cookie, 'Content-Type': `multipart/form-data; boundary=${avatarBoundary}` },
    body: largeAvatarBody
  });
  assert.equal(largeAvatarRes.status, 200);
  assert.ok(largeAvatarRes.body.user.avatarUrl);

  // 10. List chats for Alice
  const chatsRes = await req('/api/chats', { headers: { Cookie: aliceReg.cookie } });
  assert.equal(chatsRes.status, 200);
  assert.equal(chatsRes.body.chats.length, 1);
  assert.equal(chatsRes.body.chats[0].peer.username, 'bob_dev');

  // 11. Mark read & react
  const readRes = await req(`/api/chats/${chatId}/read`, {
    method: 'POST',
    headers: { Cookie: aliceReg.cookie }
  });
  assert.equal(readRes.status, 200);
  assert.ok(readRes.body.newlyReadIds.includes(uploadRes.body.message.id));

  const reactRes = await req(`/api/chats/${chatId}/messages/${uploadRes.body.message.id}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: aliceReg.cookie },
    body: JSON.stringify({ emoji: '🔥' })
  });
  assert.equal(reactRes.status, 200);
  assert.deepEqual(reactRes.body.message.reactions['🔥'], ['alice_01']);

  // 12. Delete own message
  const delRes = await req(`/api/chats/${chatId}/messages/${msg1Res.body.message.id}`, {
    method: 'DELETE',
    headers: { Cookie: aliceReg.cookie }
  });
  assert.equal(delRes.status, 200);

  // 13. Remove avatar, change username + display name, verify chat & cookie migration
  const removeAvatarRes = await req('/api/users/me/avatar', {
    method: 'DELETE',
    headers: { Cookie: aliceReg.cookie }
  });
  assert.equal(removeAvatarRes.status, 200);
  assert.equal(removeAvatarRes.body.user.avatarUrl, null);
  const oldUploadsDir = path.join(config.usersDir, 'alice_01', 'uploads');
  assert.equal(fs.readdirSync(oldUploadsDir).length, 0);

  // Upload a small avatar again before renaming username so we test avatarUrl rewrite
  const reUploadAvatar = await req('/api/users/me/avatar', {
    method: 'POST',
    headers: { Cookie: aliceReg.cookie, 'Content-Type': `multipart/form-data; boundary=${avatarBoundary}` },
    body: avatarBody
  });
  assert.equal(reUploadAvatar.status, 200);
  assert.ok(reUploadAvatar.body.user.avatarUrl);

  // Reject taken username
  const takenRename = await req('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: aliceReg.cookie },
    body: JSON.stringify({ username: 'bob_dev', displayName: 'Alice Prime' })
  });
  assert.equal(takenRename.status, 409);

  // Reject invalid username
  const badRename = await req('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: aliceReg.cookie },
    body: JSON.stringify({ username: 'ab', displayName: 'Alice Prime' })
  });
  assert.equal(badRename.status, 400);

  // Successful username + display name change
  const renameRes = await req('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: aliceReg.cookie },
    body: JSON.stringify({ username: 'alice_prime', displayName: 'Alice Prime', bio: 'Renamed!' })
  });
  assert.equal(renameRes.status, 200);
  assert.equal(renameRes.body.user.username, 'alice_prime');
  assert.equal(renameRes.body.user.displayName, 'Alice Prime');
  assert.equal(renameRes.body.renamedFrom, 'alice_01');
  assert.match(renameRes.body.user.avatarUrl, /^\/api\/users\/alice_prime\/avatar\//);
  assert.ok(renameRes.cookie, 'Should return refreshed session cookie after username change');
  assert.equal(fs.existsSync(path.join(config.usersDir, 'alice_01')), false);
  assert.equal(fs.existsSync(path.join(config.usersDir, 'alice_prime', 'profile.json')), true);

  // Verify old chat migrated cleanly and file attachments remain accessible
  const renamedChatId = renameRes.body.chatRenames[0].newChatId;
  assert.equal(renamedChatId, 'dm_alice_prime__bob_dev');
  const migratedChatsRes = await req('/api/chats', { headers: { Cookie: renameRes.cookie } });
  assert.equal(migratedChatsRes.status, 200);
  assert.equal(migratedChatsRes.body.chats[0].id, renamedChatId);
  const openMigrated = await req('/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: renameRes.cookie },
    body: JSON.stringify({ targetUsername: 'bob_dev' })
  });
  assert.equal(openMigrated.status, 200);
  const migratedNotesUrl = openMigrated.body.messages[0].attachments[1].url;
  assert.ok(migratedNotesUrl.startsWith(`/api/chats/${renamedChatId}/files/`));
  const dlMigrated = await req(migratedNotesUrl, { headers: { Cookie: renameRes.cookie } });
  assert.equal(dlMigrated.status, 200);
  assert.equal(dlMigrated.body.toString('utf8'), 'hello file content');
});

test('frontend app.js boots cleanly and matches all HTML element IDs', async () => {
  const rootDir = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');

  const combined = `${html}\n${js}`;
  const missingIds = [];
  for (const m of js.matchAll(/\$\('([^']+)'\)/g)) {
    if (!combined.includes(`id="${m[1]}"`)) {
      missingIds.push(m[1]);
    }
  }
  assert.deepEqual(missingIds, []);

  let authScreenShown = false;
  const elements = new Map();
  function makeEl(id) {
    const el = {
      id,
      classList: {
        _set: new Set(['hidden']),
        add(c) { this._set.add(c); },
        remove(c) {
          this._set.delete(c);
          if (id === 'auth-screen' && c === 'hidden') authScreenShown = true;
        },
        toggle(c, force) {
          if (force === undefined) {
            if (this._set.has(c)) this._set.delete(c);
            else this._set.add(c);
          } else if (force) {
            this._set.add(c);
          } else {
            this._set.delete(c);
          }
        },
        contains(c) { return this._set.has(c); }
      },
      addEventListener() {},
      setAttribute() {},
      querySelectorAll() { return []; },
      style: { setProperty() {} },
      value: '',
      innerHTML: '',
      textContent: '',
      checked: false
    };
    return el;
  }

  const sandbox = {
    localStorage: { getItem() { return null; }, setItem() {} },
    document: {
      documentElement: makeEl('html'),
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeEl(id));
        return elements.get(id);
      },
      querySelectorAll() { return []; },
      addEventListener() {}
    },
    window: {
      innerHeight: 800,
      scrollX: 0,
      scrollY: 0,
      addEventListener() {},
      scrollTo() {}
    },
    fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL
  };

  vm.runInNewContext(js, sandbox);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(authScreenShown, true);
});

test('oversized avatar upload returns clean HTTP 413 without destroying socket', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telechat-limit-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null, maxUploadMb: 1 });
  const auth = createAuthHelpers(config);
  const storage = createStorage(config);
  const hub = createRealtimeHub();
  const mailer = createMailer(config);
  const handleRequest = createRouter({ config, auth, storage, hub, mailer });

  t.after(() => {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  });

  const reg = await invokeRouter(handleRequest, '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'limit_user', email: 'limit@gmail.com', password: 'secretPassword1' })
  });
  assert.equal(reg.status, 202);
  const ver = await invokeRouter(handleRequest, '/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId: reg.body.verificationId, code: reg.body.devCode })
  });
  assert.equal(ver.status, 201);

  const boundary = '----TooBigBoundary';
  const tooBigBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="huge.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    Buffer.alloc(2 * 1024 * 1024, 0xff),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const res = await invokeRouter(handleRequest, '/api/users/me/avatar', {
    method: 'POST',
    headers: { Cookie: ver.cookie, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: tooBigBody
  });
  assert.equal(res.status, 413);
  assert.equal(res.headers.connection, 'close');
  assert.match(res.body.error, /exceeds maximum allowed size of 1 MB/i);

  // Also verify readBodyBuffer drains cleanly instead of calling req.destroy()
  const { readBodyBuffer } = require('../src/multipart');
  const stream = new PassThrough();
  const bodyPromise = readBodyBuffer(stream, 1024);
  stream.write(Buffer.alloc(2048, 0xaa));
  stream.end();
  await assert.rejects(bodyPromise, (err) => err && err.statusCode === 413);
  assert.equal(stream.destroyed, false);
});
