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
const { extractFirstUrl, isPrivateIp, isSafePublicUrl } = require('../src/linkPreview');

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

  // 14. Profile birthday setting, validation, clearing, and unread counter check
  const badBirthdayRes = await req('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: renameRes.cookie },
    body: JSON.stringify({ birthday: '2099-02-30' })
  });
  assert.equal(badBirthdayRes.status, 400);

  const setBirthdayRes = await req('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: renameRes.cookie },
    body: JSON.stringify({ birthday: '2001-05-14' })
  });
  assert.equal(setBirthdayRes.status, 200);
  assert.equal(setBirthdayRes.body.user.birthday, '2001-05-14');

  const bobChatsBefore = await req('/api/chats', { headers: { Cookie: bobReg.cookie } });
  assert.equal(bobChatsBefore.status, 200);
  assert.equal(bobChatsBefore.body.chats[0].peer.birthday, '2001-05-14');

  const sendUnreadMsg = await req(`/api/chats/${renamedChatId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: renameRes.cookie },
    body: JSON.stringify({ text: 'Unread counter check!' })
  });
  assert.equal(sendUnreadMsg.status, 201);

  const bobChatsUnread = await req('/api/chats', { headers: { Cookie: bobReg.cookie } });
  assert.equal(bobChatsUnread.status, 200);
  assert.ok(bobChatsUnread.body.chats[0].unreadCount >= 1);

  const bobReadRes = await req(`/api/chats/${renamedChatId}/read`, {
    method: 'POST',
    headers: { Cookie: bobReg.cookie }
  });
  assert.equal(bobReadRes.status, 200);
  const bobChatsCleared = await req('/api/chats', { headers: { Cookie: bobReg.cookie } });
  assert.equal(bobChatsCleared.body.chats[0].unreadCount, 0);

  const clearBirthdayRes = await req('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: renameRes.cookie },
    body: JSON.stringify({ birthday: '' })
  });
  assert.equal(clearBirthdayRes.status, 200);
  assert.equal(clearBirthdayRes.body.user.birthday, null);
});

test('frontend app.js and features.js boot cleanly and match HTML element IDs', async () => {
  const rootDir = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');
  const featuresJs = fs.readFileSync(path.join(rootDir, 'public', 'features.js'), 'utf8');

  const combined = `${html}\n${js}`;
  const missingIds = [];
  for (const m of js.matchAll(/\$\('([^']+)'\)/g)) {
    if (!combined.includes(`id="${m[1]}"`)) {
      missingIds.push(m[1]);
    }
  }
  assert.deepEqual(missingIds, []);

  // Verify static HTML IDs referenced via el('...') in features.js exist in index.html or features.js template strings
  const combinedFeat = `${html}\n${featuresJs}`;
  const missingFeatureIds = [];
  for (const m of featuresJs.matchAll(/\bel\('([^']+)'\)/g)) {
    if (!combinedFeat.includes(`id="${m[1]}"`)) {
      missingFeatureIds.push(m[1]);
    }
  }
  assert.deepEqual(missingFeatureIds, []);

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
      querySelector() { return null; },
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
      body: makeEl('body'),
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeEl(id));
        return elements.get(id);
      },
      querySelector() { return null; },
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
    URL,
    URLSearchParams
  };

  vm.runInNewContext(js, sandbox);
  vm.runInNewContext(featuresJs, sandbox);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(authScreenShown, true);

  // Verify renderMessages & Android back gesture handler work without ReferenceError
  sandbox.window.VibeRoomCore.getState().activeChatId = 'sec_alice__bob';
  sandbox.window.VibeRoomCore.getState().me = { username: 'alice' };
  sandbox.document.getElementById('app-shell').classList.add('mobile-chat-open');
  assert.doesNotThrow(() => sandbox.window.VibeRoomCore.renderMessages(false));
  assert.equal(sandbox.document.body.classList.contains('privacy-screen-protected'), true);
  assert.equal(sandbox.window.__telechatHandleBack(), true);
  assert.equal(sandbox.document.getElementById('app-shell').classList.contains('mobile-chat-open'), false);
  assert.equal(sandbox.window.VibeRoomCore.getState().activeChatId, null);
  assert.equal(sandbox.document.body.classList.contains('privacy-screen-protected'), false);
  assert.equal(typeof sandbox.window.VibeRoomCore, 'object');
  assert.equal(typeof sandbox.window.VibeRoomFeatures, 'object');
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

async function registerTestUser(handleRequest, username, email) {
  const reg = await invokeRouter(handleRequest, '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password: 'Password123!' })
  });
  assert.equal(reg.status, 202);
  const ver = await invokeRouter(handleRequest, '/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId: reg.body.verificationId, code: reg.body.devCode })
  });
  assert.equal(ver.status, 201);
  return { user: ver.body.user, cookie: ver.cookie };
}

async function makeFriends(handleRequest, sender, recipient) {
  const reqRes = await invokeRouter(handleRequest, '/api/friends/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sender.cookie },
    body: JSON.stringify({ targetUsername: recipient.user.username })
  });
  assert.equal(reqRes.status, 200);
  const accRes = await invokeRouter(handleRequest, '/api/friends/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: recipient.cookie },
    body: JSON.stringify({ username: sender.user.username })
  });
  assert.equal(accRes.status, 200);
}

test('groups & channels lifecycle, invite links, @mentions, and admin controls', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-groups-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage: createStorage(config),
    hub: createRealtimeHub(),
    mailer: createMailer(config)
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_g', 'alice.g@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_g', 'bob.g@gmail.com');
  const carol = await registerTestUser(handleRequest, 'carol_g', 'carol.g@gmail.com');

  // Cannot directly add non-friend when creating group
  const nonFriendGrp = await invokeRouter(handleRequest, '/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ type: 'group', title: 'Gamers United', members: ['bob_g'] })
  });
  assert.equal(nonFriendGrp.status, 403);

  await makeFriends(handleRequest, alice, bob);

  // Create group with friend Bob
  const grpRes = await invokeRouter(handleRequest, '/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ type: 'group', title: 'Gamers United', description: 'Chill room', members: ['bob_g'] })
  });
  assert.equal(grpRes.status, 201);
  const group = grpRes.body.chat;
  assert.equal(group.type, 'group');
  assert.deepEqual(group.participants.slice().sort(), ['alice_g', 'bob_g']);

  // Non-friend Carol CAN still join freely via invite link!
  const joinRes = await invokeRouter(handleRequest, '/api/groups/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: carol.cookie },
    body: JSON.stringify({ inviteCode: group.inviteCode })
  });
  assert.equal(joinRes.status, 200);
  assert.ok(joinRes.body.chat.participants.includes('carol_g'));

  // Message with @mention
  const msgRes = await invokeRouter(handleRequest, `/api/chats/${group.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ text: 'Hey @carol_g and @alice_g ready?' })
  });
  assert.equal(msgRes.status, 201);
  assert.deepEqual(msgRes.body.message.mentions, ['carol_g', 'alice_g']);

  // Promote Bob, remove Carol
  const promoRes = await invokeRouter(handleRequest, `/api/groups/${group.id}/admins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ username: 'bob_g', isAdmin: true })
  });
  assert.equal(promoRes.status, 200);
  assert.ok(promoRes.body.chat.admins.includes('bob_g'));

  const kickRes = await invokeRouter(handleRequest, `/api/groups/${group.id}/members/carol_g`, {
    method: 'DELETE',
    headers: { Cookie: alice.cookie }
  });
  assert.equal(kickRes.status, 200);
  assert.equal(kickRes.body.chat.participants.includes('carol_g'), false);

  // Broadcast channel: non-admin cannot post
  const chnRes = await invokeRouter(handleRequest, '/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ type: 'channel', title: 'VibeRoom News', members: ['bob_g'] })
  });
  assert.equal(chnRes.status, 201);
  const channel = chnRes.body.chat;

  const bobPostRes = await invokeRouter(handleRequest, `/api/chats/${channel.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ text: 'Unauthorized post' })
  });
  assert.equal(bobPostRes.status, 403);

  const alicePostRes = await invokeRouter(handleRequest, `/api/chats/${channel.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Official announcement!' })
  });
  assert.equal(alicePostRes.status, 201);
});

test('stranger lounge matching, anonymity protection, and mutual reveal flow', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-stranger-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage: createStorage(config),
    hub: createRealtimeHub(),
    mailer: createMailer(config)
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_s', 'alice.s@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_s', 'bob.s@gmail.com');

  const q1 = await invokeRouter(handleRequest, '/api/stranger/meet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ interests: ['gaming', 'music'], language: 'en' })
  });
  assert.equal(q1.status, 200);
  assert.equal(q1.body.status, 'searching');

  const q2 = await invokeRouter(handleRequest, '/api/stranger/meet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ interests: ['gaming'], language: 'en' })
  });
  assert.equal(q2.status, 200);
  assert.equal(q2.body.status, 'matched');
  assert.match(q2.body.session.myAlias, /^Ghost #\d+$/);
  assert.match(q2.body.session.partnerAlias, /^Ghost #\d+$/);
  assert.deepEqual(q2.body.session.sharedInterests, ['gaming']);

  // Anonymity check: Alice checks status and sees only Ghost aliases, never bob_s
  const aliceStatus = await invokeRouter(handleRequest, '/api/stranger/status', {
    headers: { Cookie: alice.cookie }
  });
  assert.equal(aliceStatus.status, 200);
  assert.equal(aliceStatus.body.status, 'matched');
  assert.equal(JSON.stringify(aliceStatus.body).includes('bob_s'), false);

  // Send message inside stranger lounge
  const sendStr = await invokeRouter(handleRequest, '/api/stranger/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Hey Ghost!' })
  });
  assert.equal(sendStr.status, 201);
  assert.equal(sendStr.body.message.text, 'Hey Ghost!');
  assert.equal(sendStr.body.message.isMine, true);

  // Single reveal keeps revealed=false until mutual
  const r1 = await invokeRouter(handleRequest, '/api/stranger/reveal', {
    method: 'POST',
    headers: { Cookie: alice.cookie }
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.revealed, false);

  const r2 = await invokeRouter(handleRequest, '/api/stranger/reveal', {
    method: 'POST',
    headers: { Cookie: bob.cookie }
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.revealed, true);
  assert.equal(r2.body.friend.username, 'alice_s');
  assert.equal(r2.body.dmChatId, 'dm_alice_s__bob_s');
});

test('chat mini-games (TicTacToe, Connect4, Chess, WordDuel) and WebRTC call signaling', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-games-calls-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage: createStorage(config),
    hub: createRealtimeHub(),
    mailer: createMailer(config)
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_p', 'alice.p@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_p', 'bob.p@gmail.com');

  const dmOpen = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_p' })
  });
  assert.equal(dmOpen.status, 200);
  const chatId = dmOpen.body.chat.id;

  // Non-friends cannot start a mini-game
  const blockedTtt = await invokeRouter(handleRequest, `/api/chats/${chatId}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ gameType: 'tictactoe' })
  });
  assert.equal(blockedTtt.status, 403);

  await makeFriends(handleRequest, alice, bob);

  // 1. Tic-Tac-Toe win
  const tttStart = await invokeRouter(handleRequest, `/api/chats/${chatId}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ gameType: 'tictactoe' })
  });
  assert.equal(tttStart.status, 201);
  const tttId = tttStart.body.message.game.id;

  const tttMoves = [
    [alice.cookie, 0], [bob.cookie, 3],
    [alice.cookie, 1], [bob.cookie, 4],
    [alice.cookie, 2]
  ];
  let lastTtt;
  for (const [ck, index] of tttMoves) {
    lastTtt = await invokeRouter(handleRequest, `/api/chats/${chatId}/games/${tttId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ck },
      body: JSON.stringify({ move: { index } })
    });
    assert.equal(lastTtt.status, 200);
  }
  assert.equal(lastTtt.body.message.game.status, 'finished');
  assert.equal(lastTtt.body.message.game.winner, 'alice_p');

  // 2. Connect 4 win
  const c4Start = await invokeRouter(handleRequest, `/api/chats/${chatId}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ gameType: 'connect4' })
  });
  assert.equal(c4Start.status, 201);
  const c4Id = c4Start.body.message.game.id;

  let lastC4;
  for (const [ck, col] of [
    [alice.cookie, 0], [bob.cookie, 1],
    [alice.cookie, 0], [bob.cookie, 1],
    [alice.cookie, 0], [bob.cookie, 1],
    [alice.cookie, 0]
  ]) {
    lastC4 = await invokeRouter(handleRequest, `/api/chats/${chatId}/games/${c4Id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ck },
      body: JSON.stringify({ move: { col } })
    });
    assert.equal(lastC4.status, 200);
  }
  assert.equal(lastC4.body.message.game.status, 'finished');
  assert.equal(lastC4.body.message.game.winner, 'alice_p');

  // 3. Chess legal move + illegal rejection
  const chessStart = await invokeRouter(handleRequest, `/api/chats/${chatId}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ gameType: 'chess' })
  });
  assert.equal(chessStart.status, 201);
  const chessId = chessStart.body.message.game.id;

  // Illegal pawn jump 3 rows forward
  const badChess = await invokeRouter(handleRequest, `/api/chats/${chatId}/games/${chessId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ move: { from: 52, to: 28 } })
  });
  assert.equal(badChess.status, 400);

  // Legal e2 -> e4 (52 -> 36)
  const goodChess = await invokeRouter(handleRequest, `/api/chats/${chatId}/games/${chessId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ move: { from: 52, to: 36 } })
  });
  assert.equal(goodChess.status, 200);
  assert.equal(goodChess.body.message.game.state.board[36], 'P');
  assert.equal(goodChess.body.message.game.turn, 'bob_p');

  // 4. Word Duel hides secret while active and reveals after guesses/win
  const wgStart = await invokeRouter(handleRequest, `/api/chats/${chatId}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ gameType: 'wordguess' })
  });
  assert.equal(wgStart.status, 201);
  assert.equal(wgStart.body.message.game.state.revealedWord, null);
  const wgId = wgStart.body.message.game.id;

  const wgGuess = await invokeRouter(handleRequest, `/api/chats/${chatId}/games/${wgId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ move: { word: 'APPLE' } })
  });
  assert.equal(wgGuess.status, 200);
  assert.equal(wgGuess.body.message.game.state.guesses.length, 1);

  // Invitee (Bob) cannot cancel Alice's active game, only invite sender (Alice) can
  const bobCancelDenied = await invokeRouter(handleRequest, `/api/chats/${chatId}/games/${wgId}/cancel`, {
    method: 'POST',
    headers: { Cookie: bob.cookie }
  });
  assert.equal(bobCancelDenied.status, 403);

  const aliceCancelOk = await invokeRouter(handleRequest, `/api/chats/${chatId}/games/${wgId}/cancel`, {
    method: 'POST',
    headers: { Cookie: alice.cookie }
  });
  assert.equal(aliceCancelOk.status, 200);
  assert.equal(aliceCancelOk.body.message.game.status, 'cancelled');

  // 5. WebRTC Call Signaling & Call History persistence
  const cfgRes = await invokeRouter(handleRequest, '/api/calls/config', {
    headers: { Cookie: alice.cookie }
  });
  assert.equal(cfgRes.status, 200);
  assert.ok(Array.isArray(cfgRes.body.iceServers));

  const callStart = await invokeRouter(handleRequest, '/api/calls/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_p', mode: 'video', chatId })
  });
  assert.equal(callStart.status, 201);
  const callId = callStart.body.call.id;

  const callAccept = await invokeRouter(handleRequest, `/api/calls/${callId}/accept`, {
    method: 'POST',
    headers: { Cookie: bob.cookie }
  });
  assert.equal(callAccept.status, 200);

  const sigRes = await invokeRouter(handleRequest, `/api/calls/${callId}/signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ type: 'offer', data: { type: 'offer', sdp: 'v=0...' } })
  });
  assert.equal(sigRes.status, 200);

  const endRes = await invokeRouter(handleRequest, `/api/calls/${callId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ reason: 'hangup' })
  });
  assert.equal(endRes.status, 200);

  // Verify call history message was saved in chat & chat list preview
  const chatMessagesAfterCall = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_p' })
  });
  assert.equal(chatMessagesAfterCall.status, 200);
  const callLogMsg = chatMessagesAfterCall.body.messages.find((m) => m.kind === 'call' && m.call && m.call.callId === callId);
  assert.ok(callLogMsg, 'Expected completed call log message in DM history');
  assert.equal(callLogMsg.call.status, 'completed');
  assert.equal(callLogMsg.call.mode, 'video');

  const aliceChatList = await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } });
  assert.equal(aliceChatList.status, 200);
  assert.match(aliceChatList.body.chats[0].lastMessage.preview, /Video call/);
});

test('per-user activity.log and universal.log track logins, IPs, devices, logouts, chats, and stranger reports', async (t) => {
  const { createAuditLogger } = require('../src/audit');
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-audit-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const audit = createAuditLogger(config);
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage: createStorage(config),
    hub: createRealtimeHub(),
    mailer: createMailer(config),
    audit
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const headersAndroid = {
    'Content-Type': 'application/json',
    'x-forwarded-for': '203.0.113.45, 10.0.0.1',
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; SM-A505F; wv) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
  };
  const headersWin = {
    'Content-Type': 'application/json',
    'x-forwarded-for': '198.51.100.7',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36'
  };

  // Register two users
  const regA = await invokeRouter(handleRequest, '/api/auth/register', {
    method: 'POST',
    headers: headersAndroid,
    body: JSON.stringify({ username: 'audit_alice', email: 'audit.alice@gmail.com', password: 'Password123!' })
  });
  assert.equal(regA.status, 202);
  const verA = await invokeRouter(handleRequest, '/api/auth/verify-email', {
    method: 'POST',
    headers: headersAndroid,
    body: JSON.stringify({ verificationId: regA.body.verificationId, code: regA.body.devCode })
  });
  assert.equal(verA.status, 201);

  const bob = await registerTestUser(handleRequest, 'audit_bob', 'audit.bob@gmail.com');

  // Failed login attempt followed by successful login from Windows IP
  const badLogin = await invokeRouter(handleRequest, '/api/auth/login', {
    method: 'POST',
    headers: headersWin,
    body: JSON.stringify({ identifier: 'audit_alice', password: 'wrong-password' })
  });
  assert.equal(badLogin.status, 401);

  const okLogin = await invokeRouter(handleRequest, '/api/auth/login', {
    method: 'POST',
    headers: headersWin,
    body: JSON.stringify({ identifier: 'audit_alice', password: 'Password123!' })
  });
  assert.equal(okLogin.status, 200);

  // Send a DM message
  const msgRes = await invokeRouter(handleRequest, '/api/chats/dm_audit_alice__audit_bob/messages', {
    method: 'POST',
    headers: { ...headersAndroid, Cookie: verA.cookie },
    body: JSON.stringify({ text: 'Audited hello!' })
  });
  assert.equal(msgRes.status, 201);

  // Anonymous Stranger Lounge match + message + report (must log real usernames in server logs)
  await invokeRouter(handleRequest, '/api/stranger/meet', {
    method: 'POST',
    headers: { ...headersAndroid, Cookie: verA.cookie },
    body: JSON.stringify({ interests: ['gaming'], language: 'en' })
  });
  await invokeRouter(handleRequest, '/api/stranger/meet', {
    method: 'POST',
    headers: { ...headersWin, Cookie: bob.cookie },
    body: JSON.stringify({ interests: ['gaming'], language: 'en' })
  });
  await invokeRouter(handleRequest, '/api/stranger/message', {
    method: 'POST',
    headers: { ...headersWin, Cookie: bob.cookie },
    body: JSON.stringify({ text: 'Anonymous test line' })
  });
  await invokeRouter(handleRequest, '/api/stranger/report', {
    method: 'POST',
    headers: { ...headersAndroid, Cookie: verA.cookie },
    body: JSON.stringify({ reason: 'harassment' })
  });

  // Search users (logged in activity.log & global universal.log, omitted from concise per-user universal.log)
  await invokeRouter(handleRequest, '/api/users/search?q=audit_bob', {
    headers: { ...headersAndroid, Cookie: verA.cookie }
  });

  // Logout
  const outRes = await invokeRouter(handleRequest, '/api/auth/logout', {
    method: 'POST',
    headers: { ...headersAndroid, Cookie: verA.cookie }
  });
  assert.equal(outRes.status, 200);

  await audit.flush();

  const aliceLogPath = path.join(config.usersDir, 'audit_alice', 'activity.log');
  const aliceUserUniversalPath = path.join(config.usersDir, 'audit_alice', 'universal.log');
  const bobLogPath = path.join(config.usersDir, 'audit_bob', 'activity.log');
  const bobUserUniversalPath = path.join(config.usersDir, 'audit_bob', 'universal.log');
  const universalLogPath = config.universalLogPath;

  assert.equal(fs.existsSync(aliceLogPath), true);
  assert.equal(fs.existsSync(aliceUserUniversalPath), true);
  assert.equal(fs.existsSync(bobLogPath), true);
  assert.equal(fs.existsSync(bobUserUniversalPath), true);
  assert.equal(fs.existsSync(universalLogPath), true);

  const aliceLog = fs.readFileSync(aliceLogPath, 'utf8');
  const aliceUserUniversal = fs.readFileSync(aliceUserUniversalPath, 'utf8');
  const bobLog = fs.readFileSync(bobLogPath, 'utf8');
  const bobUserUniversal = fs.readFileSync(bobUserUniversalPath, 'utf8');
  const universalLog = fs.readFileSync(universalLogPath, 'utf8');

  assert.match(aliceLog, /ACTION=EMAIL_VERIFIED_REGISTER/);
  assert.match(aliceLog, /ACTION=LOGIN_FAILED.*ip=198\.51\.100\.7.*device="Chrome/);
  assert.match(aliceLog, /ACTION=LOGIN_SUCCESS.*ip=198\.51\.100\.7/);
  assert.match(aliceLog, /ACTION=USER_SEARCH/);
  assert.match(aliceLog, /ACTION=MESSAGE_SENT.*ip=203\.0\.113\.45.*device="Android App \(WebView\) \(Android 10; SM-A505F\)"/);
  assert.match(aliceLog, /ACTION=LOGOUT.*user=@audit_alice.*ip=203\.0\.113\.45/);

  // Per-user universal.log keeps necessary events cleanly (logins, logouts, messages, reports) and excludes search/queue noise
  assert.match(aliceUserUniversal, /LOGIN_FAILED ip=198\.51\.100\.7/);
  assert.match(aliceUserUniversal, /LOGIN_SUCCESS ip=198\.51\.100\.7/);
  assert.match(aliceUserUniversal, /MESSAGE_SENT .*Audited hello!/);
  assert.match(aliceUserUniversal, /STRANGER_REPORTED .*reason="harassment"/);
  assert.match(aliceUserUniversal, /LOGOUT .*ip=203\.0\.113\.45/);
  assert.equal(aliceUserUniversal.includes('USER_SEARCH'), false);
  assert.equal(aliceUserUniversal.includes('STRANGER_QUEUE_JOIN'), false);

  assert.match(bobLog, /ACTION=STRANGER_MESSAGE.*user=@audit_bob.*Anonymous test line/);
  assert.match(bobUserUniversal, /STRANGER_REPORTED .*reportedUser="audit_bob"/);

  // Global universal log includes events from BOTH users + pre-verification registration requests
  assert.match(universalLog, /ACTION=REGISTER_REQUEST user=@audit_alice ip=203\.0\.113\.45/);
  assert.match(universalLog, /ACTION=LOGIN_SUCCESS user=@audit_alice/);
  assert.match(universalLog, /ACTION=STRANGER_REPORTED/);
  assert.match(universalLog, /ACTION=LOGOUT user=@audit_alice/);
});

test('exact-only search privacy and full friend request lifecycle (send, cancel, accept, unfriend)', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-friends-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage: createStorage(config),
    hub: createRealtimeHub(),
    mailer: createMailer(config)
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_f', 'alice.f@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_f', 'bob.f@gmail.com');

  // Empty & partial searches MUST return zero users (hidden directory)
  const emptySearch = await invokeRouter(handleRequest, '/api/users/search?q=', { headers: { Cookie: alice.cookie } });
  assert.equal(emptySearch.status, 200);
  assert.equal(emptySearch.body.users.length, 0);

  const partialSearch = await invokeRouter(handleRequest, '/api/users/search?q=bob', { headers: { Cookie: alice.cookie } });
  assert.equal(partialSearch.status, 200);
  assert.equal(partialSearch.body.users.length, 0);

  const emailPartial = await invokeRouter(handleRequest, '/api/users/search?q=gmail.com', { headers: { Cookie: alice.cookie } });
  assert.equal(emailPartial.status, 200);
  assert.equal(emailPartial.body.users.length, 0);

  // Exact @username and exact email return the user
  const exactHandle = await invokeRouter(handleRequest, '/api/users/search?q=@bob_f', { headers: { Cookie: alice.cookie } });
  assert.equal(exactHandle.status, 200);
  assert.equal(exactHandle.body.users.length, 1);
  assert.equal(exactHandle.body.users[0].username, 'bob_f');
  assert.equal(exactHandle.body.users[0].relationship, 'none');

  const exactEmail = await invokeRouter(handleRequest, '/api/users/search?q=bob.f@gmail.com', { headers: { Cookie: alice.cookie } });
  assert.equal(exactEmail.status, 200);
  assert.equal(exactEmail.body.users.length, 1);

  // Send friend request -> shows in Alice's sent & Bob's received -> cancel removes both
  const req1 = await invokeRouter(handleRequest, '/api/friends/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_f' })
  });
  assert.equal(req1.status, 200);
  assert.equal(req1.body.status, 'outgoing_pending');

  const aliceList1 = await invokeRouter(handleRequest, '/api/friends', { headers: { Cookie: alice.cookie } });
  assert.equal(aliceList1.body.sent.length, 1);
  assert.equal(aliceList1.body.sent[0].user.username, 'bob_f');

  const cancelRes = await invokeRouter(handleRequest, '/api/friends/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ username: 'bob_f' })
  });
  assert.equal(cancelRes.status, 200);

  const aliceList2 = await invokeRouter(handleRequest, '/api/friends', { headers: { Cookie: alice.cookie } });
  assert.equal(aliceList2.body.sent.length, 0);

  // Re-send and Bob accepts -> mutual friends -> Unfriend removes both
  await makeFriends(handleRequest, alice, bob);

  const bobList = await invokeRouter(handleRequest, '/api/friends', { headers: { Cookie: bob.cookie } });
  assert.equal(bobList.body.friends.length, 1);
  assert.equal(bobList.body.friends[0].username, 'alice_f');

  const unfriendRes = await invokeRouter(handleRequest, '/api/friends/bob_f', {
    method: 'DELETE',
    headers: { Cookie: alice.cookie }
  });
  assert.equal(unfriendRes.status, 200);

  const bobListAfter = await invokeRouter(handleRequest, '/api/friends', { headers: { Cookie: bob.cookie } });
  assert.equal(bobListAfter.body.friends.length, 0);
});

test('everyday Telegram conveniences: edit messages, Saved Messages, pin messages/chats, mute chats, forward & bulk delete, and link preview SSRF guards', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-conv-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage: createStorage(config),
    hub: createRealtimeHub(),
    mailer: createMailer(config)
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_c', 'alice.c@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_c', 'bob.c@gmail.com');
  const carol = await registerTestUser(handleRequest, 'carol_c', 'carol.c@gmail.com');

  // Open DM chats with Bob and Carol
  const dmBobOpen = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_c' })
  });
  assert.equal(dmBobOpen.status, 200);
  const chatBobId = dmBobOpen.body.chat.id;

  const dmCarolOpen = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'carol_c' })
  });
  assert.equal(dmCarolOpen.status, 200);
  const chatCarolId = dmCarolOpen.body.chat.id;

  // 1. Send & Edit Sent Messages
  const send1 = await invokeRouter(handleRequest, `/api/chats/${chatBobId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Original typo mesage' })
  });
  assert.equal(send1.status, 201);
  const msg1Id = send1.body.message.id;

  // Bob cannot edit Alice's message
  const bobEditDenied = await invokeRouter(handleRequest, `/api/chats/${chatBobId}/messages/${msg1Id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ text: 'Hacked text' })
  });
  assert.equal(bobEditDenied.status, 403);

  const aliceEditOk = await invokeRouter(handleRequest, `/api/chats/${chatBobId}/messages/${msg1Id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Fixed **bold** and ||secret||' })
  });
  assert.equal(aliceEditOk.status, 200);
  assert.equal(aliceEditOk.body.message.text, 'Fixed **bold** and ||secret||');
  assert.ok(aliceEditOk.body.message.editedAt);

  // 2. Saved Messages personal cloud chat + isolation check
  const savedOpen = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ type: 'saved' })
  });
  assert.equal(savedOpen.status, 200);
  assert.equal(savedOpen.body.chat.id, 'saved_alice_c');
  assert.equal(savedOpen.body.chat.type, 'saved');

  // Bob cannot open Alice's Saved Messages
  const bobSavedDenied = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ chatId: 'saved_alice_c' })
  });
  assert.equal(bobSavedDenied.status, 403);

  const savedSend = await invokeRouter(handleRequest, '/api/chats/saved_alice_c/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Remember milk & SSH key note' })
  });
  assert.equal(savedSend.status, 201);

  // 3. Pin & Unpin Message
  const pinRes = await invokeRouter(handleRequest, `/api/chats/${chatBobId}/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ messageId: msg1Id })
  });
  assert.equal(pinRes.status, 200);
  assert.equal(pinRes.body.pinnedMessage.id, msg1Id);

  const reopenedBob = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ targetUsername: 'alice_c' })
  });
  assert.equal(reopenedBob.body.chat.pinnedMessage.id, msg1Id);

  const unpinRes = await invokeRouter(handleRequest, `/api/chats/${chatBobId}/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ unpin: true })
  });
  assert.equal(unpinRes.status, 200);
  assert.equal(unpinRes.body.pinnedMessage, null);

  // 4. Pin Chat & Mute Chat (pinned chat sorts first in GET /api/chats)
  await invokeRouter(handleRequest, `/api/chats/${chatCarolId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Newer message to Carol' })
  });

  const prefPinMute = await invokeRouter(handleRequest, `/api/chats/${chatBobId}/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ pinned: true, muted: true })
  });
  assert.equal(prefPinMute.status, 200);
  assert.equal(prefPinMute.body.isPinned, true);
  assert.equal(prefPinMute.body.isMuted, true);

  const chatList = await invokeRouter(handleRequest, '/api/chats', {
    headers: { Cookie: alice.cookie }
  });
  assert.equal(chatList.status, 200);
  assert.equal(chatList.body.chats[0].id, 'saved_alice_c');
  const bobIdx = chatList.body.chats.findIndex((c) => c.id === chatBobId);
  const carolIdx = chatList.body.chats.findIndex((c) => c.id === chatCarolId);
  assert.ok(bobIdx >= 0 && carolIdx > bobIdx);
  assert.equal(chatList.body.chats[bobIdx].isPinned, true);
  assert.equal(chatList.body.chats[bobIdx].isMuted, true);

  // 5. Forward messages & Bulk Delete own messages
  const send2 = await invokeRouter(handleRequest, `/api/chats/${chatBobId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Forwardable note #2' })
  });
  const msg2Id = send2.body.message.id;

  const fwdRes = await invokeRouter(handleRequest, `/api/chats/${chatBobId}/forward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetChatIds: ['saved', chatCarolId], messageIds: [msg1Id, msg2Id] })
  });
  assert.equal(fwdRes.status, 200);
  assert.equal(fwdRes.body.count, 4);

  const carolView = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: carol.cookie },
    body: JSON.stringify({ targetUsername: 'alice_c' })
  });
  const forwardedToCarol = carolView.body.messages.filter((m) => m.forwardedFrom && m.forwardedFrom.sender === 'alice_c');
  assert.equal(forwardedToCarol.length, 2);

  // Bulk delete both messages from chatBobId
  const bulkDelRes = await invokeRouter(handleRequest, `/api/chats/${chatBobId}/messages/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ messageIds: [msg1Id, msg2Id] })
  });
  assert.equal(bulkDelRes.status, 200);
  assert.equal(bulkDelRes.body.deletedIds.length, 2);

  const bobAfterBulkDel = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_c' })
  });
  assert.equal(bobAfterBulkDel.body.messages.length, 0);

  // 6. Link Preview SSRF & URL extractor guards
  assert.equal(extractFirstUrl('Check https://example.com/docs?a=1). right now'), 'https://example.com/docs?a=1');
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('192.168.1.50'), true);
  assert.equal(isPrivateIp('10.0.0.1'), true);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(await isSafePublicUrl('http://localhost:3000/secret'), false);
  assert.equal(await isSafePublicUrl('http://127.0.0.1:8080/admin'), false);
  assert.equal(await isSafePublicUrl('ftp://example.com/file'), false);
});

test('delete messages/chats for self vs everyone and bulk mute/pin chat prefs', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-del-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage: createStorage(config),
    hub: createRealtimeHub(),
    mailer: createMailer(config)
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_d', 'alice.d@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_d', 'bob.d@gmail.com');
  const carol = await registerTestUser(handleRequest, 'carol_d', 'carol.d@gmail.com');

  const dmBob = (await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_d' })
  })).body.chat.id;

  const dmCarol = (await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'carol_d' })
  })).body.chat.id;

  // Send messages in DM with Bob
  const aMsg = (await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Alice hello 1' })
  })).body.message.id;

  const bMsg = (await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ text: 'Bob reply 2' })
  })).body.message.id;

  // Alice deletes her own message AND Bob's message ONLY for herself (forEveryone: false)
  const delForMeRes = await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ messageIds: [aMsg, bMsg], forEveryone: false })
  });
  assert.equal(delForMeRes.status, 200);
  assert.equal(delForMeRes.body.deletedForMeIds.length, 2);
  assert.equal(delForMeRes.body.forEveryoneIds.length, 0);

  // Alice sees 0 messages, Bob STILL sees both messages
  const aliceBobOpen = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_d' })
  });
  assert.equal(aliceBobOpen.body.messages.length, 0);
  assert.equal(aliceBobOpen.body.chat.lastMessage, null);

  const bobAliceOpen = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ targetUsername: 'alice_d' })
  });
  assert.equal(bobAliceOpen.body.messages.length, 2);

  // Alice sends another message and deletes it WITH forEveryone: true
  const aMsg2 = (await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Alice unsend me' })
  })).body.message.id;

  const delForAllRes = await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages/${aMsg2}?forEveryone=1`, {
    method: 'DELETE',
    headers: { Cookie: alice.cookie }
  });
  assert.equal(delForAllRes.status, 200);
  assert.equal(delForAllRes.body.forEveryone, true);

  const bobAfterUnsend = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ targetUsername: 'alice_d' })
  });
  assert.equal(bobAfterUnsend.body.messages.some((m) => m.id === aMsg2), false);

  // Bulk mute/pin multiple chats at once
  await invokeRouter(handleRequest, `/api/chats/${dmCarol}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Hey Carol' })
  });
  const bulkPrefsRes = await invokeRouter(handleRequest, '/api/chats/bulk-prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ chatIds: [dmBob, dmCarol], muted: true, pinned: true })
  });
  assert.equal(bulkPrefsRes.status, 200);
  const aliceChats = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } })).body.chats;
  assert.equal(aliceChats.length, 2);
  assert.ok(aliceChats.every((c) => c.isMuted && c.isPinned));

  // Delete chat with Bob ONLY for Alice (forEveryone: false) -> disappears for Alice, stays for Bob!
  const delChatSelf = await invokeRouter(handleRequest, `/api/chats/${dmBob}?forEveryone=0`, {
    method: 'DELETE',
    headers: { Cookie: alice.cookie }
  });
  assert.equal(delChatSelf.status, 200);
  assert.equal(delChatSelf.body.forEveryone, false);

  const aliceAfterDelBobChat = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } })).body.chats;
  assert.equal(aliceAfterDelBobChat.some((c) => c.id === dmBob), false);

  const bobChatsStillHasDm = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: bob.cookie } })).body.chats;
  assert.equal(bobChatsStillHasDm.some((c) => c.id === dmBob), true);
  assert.equal(bobChatsStillHasDm.find((c) => c.id === dmBob).lastMessage.preview, 'Bob reply 2');

  // If Bob sends a fresh message after Alice deleted for herself, chat revives with ONLY the new message for Alice
  await new Promise((r) => setTimeout(r, 15));
  await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ text: 'Fresh message after clear' })
  });
  const aliceReopenedBob = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_d' })
  });
  assert.equal(aliceReopenedBob.body.messages.length, 1);
  assert.equal(aliceReopenedBob.body.messages[0].text, 'Fresh message after clear');

  // Bulk delete chat with Carol FOR EVERYONE (forEveryone: true) -> deleted for both Alice & Carol!
  const bulkDelChatAll = await invokeRouter(handleRequest, '/api/chats/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ chatIds: [dmCarol], forEveryone: true })
  });
  assert.equal(bulkDelChatAll.status, 200);
  assert.equal(bulkDelChatAll.body.forEveryone, true);

  const carolAfterDelAll = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: carol.cookie } })).body.chats;
  assert.equal(carolAfterDelAll.some((c) => c.id === dmCarol), false);
});

test('privacy, safety & account essentials: forgot/change password, account deletion keeping logs/data, block/report, privacy settings, and QR code', async (t) => {
  const { createAuditLogger } = require('../src/audit');
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-sec-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null, allowDevEmailCode: true });
  const audit = createAuditLogger(config);
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage: createStorage(config),
    hub: createRealtimeHub(),
    mailer: createMailer(config),
    audit
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_s', 'alice.s@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_s', 'bob.s@gmail.com');
  const carol = await registerTestUser(handleRequest, 'carol_s', 'carol.s@gmail.com');

  // 1. Forgot Password -> Reset via Email OTP
  const forgotReq = await invokeRouter(handleRequest, '/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'alice.s@gmail.com' })
  });
  assert.equal(forgotReq.status, 200);
  assert.ok(forgotReq.body.verificationId);
  assert.match(forgotReq.body.devCode, /^\d{6}$/);

  const resetRes = await invokeRouter(handleRequest, '/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      verificationId: forgotReq.body.verificationId,
      code: forgotReq.body.devCode,
      newPassword: 'new_reset_password_99'
    })
  });
  assert.equal(resetRes.status, 200);

  // Old password fails, reset password succeeds
  const oldLoginFail = await invokeRouter(handleRequest, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'alice_s', password: 'password123' })
  });
  assert.equal(oldLoginFail.status, 401);

  const newLoginOk = await invokeRouter(handleRequest, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'alice_s', password: 'new_reset_password_99' })
  });
  assert.equal(newLoginOk.status, 200);
  alice.cookie = newLoginOk.cookie;

  // 2. Change Password (authenticated)
  const wrongCurPass = await invokeRouter(handleRequest, '/api/users/me/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ currentPassword: 'wrong_password', newPassword: 'changed_pw_123' })
  });
  assert.equal(wrongCurPass.status, 403);

  const goodChangePass = await invokeRouter(handleRequest, '/api/users/me/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ currentPassword: 'new_reset_password_99', newPassword: 'changed_pw_123' })
  });
  assert.equal(goodChangePass.status, 200);

  // 3. Privacy Settings (Everyone / Contacts / Nobody) + Shareable profile lookup
  await makeFriends(handleRequest, alice, bob);
  await invokeRouter(handleRequest, '/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ birthday: '1999-05-15' })
  });

  // Upload tiny PNG avatar for Alice
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const avBoundary = '----VRPrivacyAvatarBoundary';
  const avBody = Buffer.concat([
    Buffer.from(`--${avBoundary}\r\nContent-Disposition: form-data; name="avatar"; filename="av.png"\r\nContent-Type: image/png\r\n\r\n`),
    pngBytes,
    Buffer.from(`\r\n--${avBoundary}--\r\n`)
  ]);
  const upAv = await invokeRouter(handleRequest, '/api/users/me/avatar', {
    method: 'POST',
    headers: { Cookie: alice.cookie, 'Content-Type': `multipart/form-data; boundary=${avBoundary}` },
    body: avBody
  });
  assert.equal(upAv.status, 200);
  const avatarUrl = upAv.body.user.avatarUrl;

  const privRes = await invokeRouter(handleRequest, '/api/users/me/privacy', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ email: 'nobody', birthday: 'contacts', lastSeen: 'nobody', avatar: 'contacts' })
  });
  assert.equal(privRes.status, 200);
  assert.equal(privRes.body.user.privacy.email, 'nobody');

  // Non-friend Carol cannot see email, birthday, lastSeen, or avatar
  const carolSeesAlice = await invokeRouter(handleRequest, '/api/users/profile/alice_s', {
    headers: { Cookie: carol.cookie }
  });
  assert.equal(carolSeesAlice.status, 200);
  assert.equal(carolSeesAlice.body.user.email, null);
  assert.equal(carolSeesAlice.body.user.birthday, null);
  assert.equal(carolSeesAlice.body.user.avatarUrl, null);
  assert.equal(carolSeesAlice.body.user.lastSeen, null);

  const carolAvFetch = await invokeRouter(handleRequest, avatarUrl, { headers: { Cookie: carol.cookie } });
  assert.equal(carolAvFetch.status, 403);

  // Friend Bob sees birthday & avatar, while nobody-fields (email, lastSeen) remain hidden
  const bobSeesAlice = await invokeRouter(handleRequest, '/api/users/profile/alice_s', {
    headers: { Cookie: bob.cookie }
  });
  assert.equal(bobSeesAlice.status, 200);
  assert.equal(bobSeesAlice.body.user.email, null);
  assert.equal(bobSeesAlice.body.user.birthday, '1999-05-15');
  assert.equal(bobSeesAlice.body.user.avatarUrl, avatarUrl);
  assert.equal(bobSeesAlice.body.user.lastSeen, null);

  const bobAvFetch = await invokeRouter(handleRequest, avatarUrl, { headers: { Cookie: bob.cookie } });
  assert.equal(bobAvFetch.status, 200);

  // 4. Block User & Report Controls
  const dmBobOpen = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ targetUsername: 'alice_s' })
  });
  const dmBobId = dmBobOpen.body.chat.id;

  const blkRes = await invokeRouter(handleRequest, '/api/users/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_s' })
  });
  assert.equal(blkRes.status, 200);

  // Bob cannot message or call Alice while blocked
  const bobMsgBlocked = await invokeRouter(handleRequest, `/api/chats/${dmBobId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ text: 'Can you see this?' })
  });
  assert.equal(bobMsgBlocked.status, 403);

  const bobCallBlocked = await invokeRouter(handleRequest, '/api/calls/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ targetUsername: 'alice_s', mode: 'audio' })
  });
  assert.equal(bobCallBlocked.status, 403);

  const blockedList = await invokeRouter(handleRequest, '/api/users/blocked', { headers: { Cookie: alice.cookie } });
  assert.equal(blockedList.body.blocked.length, 1);
  assert.equal(blockedList.body.blocked[0].username, 'bob_s');

  // Report user
  const reportRes = await invokeRouter(handleRequest, '/api/users/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: carol.cookie },
    body: JSON.stringify({ targetUsername: 'bob_s', reason: 'spam', details: 'Unwanted spam links' })
  });
  assert.equal(reportRes.status, 201);
  assert.equal(fs.existsSync(path.join(tempDataDir, 'reports.jsonl')), true);

  // Unblock restores messaging
  await invokeRouter(handleRequest, '/api/users/block/bob_s', {
    method: 'DELETE',
    headers: { Cookie: alice.cookie }
  });
  const bobMsgAfterUnblock = await invokeRouter(handleRequest, `/api/chats/${dmBobId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ text: 'Thanks for unblocking!' })
  });
  assert.equal(bobMsgAfterUnblock.status, 201);

  // 5. Account Deletion: OTP + "DELETE" confirmation, preserves logs & data, flags deleted, frees username & email!
  const delReq = await invokeRouter(handleRequest, '/api/users/me/delete-request', {
    method: 'POST',
    headers: { Cookie: alice.cookie }
  });
  assert.equal(delReq.status, 200);
  assert.match(delReq.body.devCode, /^\d{6}$/);

  const wrongConfirmPhrase = await invokeRouter(handleRequest, '/api/users/me/delete-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({
      verificationId: delReq.body.verificationId,
      code: delReq.body.devCode,
      confirmText: 'delete'
    })
  });
  assert.equal(wrongConfirmPhrase.status, 400);

  const delConfirmOk = await invokeRouter(handleRequest, '/api/users/me/delete-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({
      verificationId: delReq.body.verificationId,
      code: delReq.body.devCode,
      confirmText: 'DELETE'
    })
  });
  assert.equal(delConfirmOk.status, 200);
  assert.equal(delConfirmOk.body.deleted, true);

  await audit.flush();

  // Profile has deleted: true flag, while activity.log, universal.log, and global universal.log remain intact!
  const aliceFolder = path.join(config.usersDir, 'alice_s');
  const deletedProfile = JSON.parse(fs.readFileSync(path.join(aliceFolder, 'profile.json'), 'utf8'));
  assert.equal(deletedProfile.deleted, true);
  assert.ok(deletedProfile.deletedAt);
  assert.equal(fs.existsSync(path.join(aliceFolder, 'activity.log')), true);
  const aliceUnivLog = fs.readFileSync(path.join(aliceFolder, 'universal.log'), 'utf8');
  assert.ok(aliceUnivLog.includes('ACCOUNT_DELETED'));
  assert.equal(fs.existsSync(path.join(tempDataDir, 'universal.log')), true);

  // Deleted account cannot log in or use old cookie
  const deletedLoginFail = await invokeRouter(handleRequest, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'alice_s', password: 'changed_pw_123' })
  });
  assert.equal(deletedLoginFail.status, 401);

  const deletedSessionFail = await invokeRouter(handleRequest, '/api/auth/me', {
    headers: { Cookie: alice.cookie }
  });
  assert.equal(deletedSessionFail.status, 401);

  // Username AND Email are immediately available to re-register, and old deleted profile & logs are preserved!
  const reRegisteredAlice = await registerTestUser(handleRequest, 'alice_s', 'alice.s@gmail.com');
  assert.equal(reRegisteredAlice.user.username, 'alice_s');
  const archivedDeletedFiles = fs.readdirSync(aliceFolder).filter((f) => f.startsWith('deleted_profile_'));
  assert.equal(archivedDeletedFiles.length, 1);
  assert.ok(fs.readFileSync(path.join(aliceFolder, 'universal.log'), 'utf8').includes('ACCOUNT_DELETED'));

  // 6. Zero-dependency QR Code Encoder (public/qrcode.js)
  const qr = require('../public/qrcode');
  const qrUrl = 'https://chat.bitdev.fun/?user=alice_s';
  const matrixRes = qr.encodeMatrix(qrUrl);
  assert.ok(matrixRes.size >= 25);
  assert.equal(matrixRes.modules[0][0], 1);
  assert.equal(matrixRes.modules[3][3], 1);
  assert.equal(matrixRes.modules[1][1], 0);
  const svg = qr.renderSvg(qrUrl);
  assert.ok(svg.startsWith('<svg ') && svg.includes('<path d="M'));
});

test('stickers and GIFs: built-in packs, Gboard/keyboard rich media uploads, previews, and forwarding', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-stk-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage: createStorage(config),
    hub: createRealtimeHub(),
    mailer: createMailer(config)
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_k', 'alice.k@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_k', 'bob.k@gmail.com');

  const dmBob = (await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_k' })
  })).body.chat.id;

  // 1. Built-in Stickers & GIFs catalog
  const stkLib = require('../public/stickers');
  assert.ok(stkLib.STICKERS.length >= 12);
  assert.ok(stkLib.GIFS.length >= 10);
  const wave = stkLib.getById('stk_wave');
  assert.ok(wave && stkLib.renderBubbleHtml(wave).includes('vr-sticker-card'));
  const ggGif = stkLib.getById('gif_gg');
  assert.ok(ggGif && stkLib.renderBubbleHtml(ggGif).includes('GIF'));
  assert.ok(stkLib.searchItems('gif', 'gg').some((x) => x.id === 'gif_gg'));

  // 2. Send built-in Sticker & forward it to Saved Messages
  const sendStk = await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: '', kind: 'sticker', sticker: wave })
  });
  assert.equal(sendStk.status, 201);
  assert.equal(sendStk.body.message.kind, 'sticker');
  assert.equal(sendStk.body.message.sticker.id, 'stk_wave');

  const listAfterStk = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } })).body.chats;
  assert.equal(listAfterStk[0].lastMessage.preview, '👋 Sticker');

  const fwdStk = await invokeRouter(handleRequest, `/api/chats/${dmBob}/forward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetChatIds: ['saved'], messageIds: [sendStk.body.message.id] })
  });
  assert.equal(fwdStk.status, 200);
  assert.equal(fwdStk.body.count, 1);

  // 3. Keyboard (Gboard/SwiftKey) GIF upload via multipart (image/gif)
  const gifBytes = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');
  const boundaryGif = '----VRGboardGifBoundary';
  const bodyGif = Buffer.concat([
    Buffer.from(`--${boundaryGif}\r\nContent-Disposition: form-data; name="kind"\r\n\r\ngif\r\n`),
    Buffer.from(`--${boundaryGif}\r\nContent-Disposition: form-data; name="files"; filename="gboard.gif"\r\nContent-Type: image/gif\r\n\r\n`),
    gifBytes,
    Buffer.from(`\r\n--${boundaryGif}--\r\n`)
  ]);
  const uploadGif = await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages`, {
    method: 'POST',
    headers: { Cookie: bob.cookie, 'Content-Type': `multipart/form-data; boundary=${boundaryGif}` },
    body: bodyGif
  });
  assert.equal(uploadGif.status, 201);
  assert.equal(uploadGif.body.message.kind, 'gif');
  assert.equal(uploadGif.body.message.attachments[0].mimeType, 'image/gif');

  const listAfterGif = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } })).body.chats;
  assert.equal(listAfterGif.find((c) => c.id === dmBob).lastMessage.preview, '🎞️ GIF');

  // 4. Keyboard (Gboard) WebP Sticker upload
  const webpBytes = Buffer.from('RIFF\x1a\x00\x00\x00WEBPVP8L', 'binary');
  const boundaryWebp = '----VRGboardWebpBoundary';
  const bodyWebp = Buffer.concat([
    Buffer.from(`--${boundaryWebp}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nsticker\r\n`),
    Buffer.from(`--${boundaryWebp}\r\nContent-Disposition: form-data; name="files"; filename="sticker.webp"\r\nContent-Type: image/webp\r\n\r\n`),
    webpBytes,
    Buffer.from(`\r\n--${boundaryWebp}--\r\n`)
  ]);
  const uploadWebp = await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages`, {
    method: 'POST',
    headers: { Cookie: alice.cookie, 'Content-Type': `multipart/form-data; boundary=${boundaryWebp}` },
    body: bodyWebp
  });
  assert.equal(uploadWebp.status, 201);
  assert.equal(uploadWebp.body.message.kind, 'sticker');

  const listAfterWebp = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } })).body.chats;
  assert.equal(listAfterWebp.find((c) => c.id === dmBob).lastMessage.preview, '🎭 Sticker');
});

test('chat archive and unarchive lifecycle: single, bulk, Saved Messages protection, and delete cleanup', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-arch-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const storage = createStorage(config);
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage,
    hub: createRealtimeHub(),
    mailer: createMailer(config)
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_ar', 'alice.ar@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_ar', 'bob.ar@gmail.com');
  const carol = await registerTestUser(handleRequest, 'carol_ar', 'carol.ar@gmail.com');

  const dmBob = (await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_ar' })
  })).body.chat.id;
  const dmCarol = (await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'carol_ar' })
  })).body.chat.id;

  // Send initial messages so both DMs appear in /api/chats
  await invokeRouter(handleRequest, `/api/chats/${dmBob}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Hey Bob' })
  });
  await invokeRouter(handleRequest, `/api/chats/${dmCarol}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Hey Carol' })
  });
  const savedOpen = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ type: 'saved' })
  });
  const savedId = savedOpen.body.chat.id;

  // 1. Archive dmBob for Alice -> isArchived true for Alice, still false for Bob
  const archBob = await invokeRouter(handleRequest, `/api/chats/${dmBob}/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ archived: true })
  });
  assert.equal(archBob.status, 200);
  assert.equal(archBob.body.isArchived, true);

  const aliceChats1 = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } })).body.chats;
  assert.equal(aliceChats1.find((c) => c.id === dmBob).isArchived, true);
  assert.equal(aliceChats1.find((c) => c.id === dmCarol).isArchived, false);

  const bobChats1 = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: bob.cookie } })).body.chats;
  assert.equal(bobChats1.find((c) => c.id === dmBob).isArchived, false);

  const reopenBob = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_ar' })
  });
  assert.equal(reopenBob.body.chat.isArchived, true);

  // 2. Bulk archive including Saved Messages -> Saved Messages never archives
  const bulkArch = await invokeRouter(handleRequest, '/api/chats/bulk-prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ chatIds: [dmBob, dmCarol, savedId], archived: true })
  });
  assert.equal(bulkArch.status, 200);
  const aliceChats2 = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } })).body.chats;
  assert.equal(aliceChats2.find((c) => c.id === dmBob).isArchived, true);
  assert.equal(aliceChats2.find((c) => c.id === dmCarol).isArchived, true);
  assert.equal(aliceChats2.find((c) => c.id === savedId).isArchived, false);

  // 3. Unarchive dmBob via single prefs and dmCarol via bulk prefs
  const unarchBob = await invokeRouter(handleRequest, `/api/chats/${dmBob}/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ archived: false })
  });
  assert.equal(unarchBob.status, 200);
  assert.equal(unarchBob.body.isArchived, false);

  // Delete dmCarol while archived -> archivedChats preference cleans up
  const delCarol = await invokeRouter(handleRequest, `/api/chats/${dmCarol}?forEveryone=0`, {
    method: 'DELETE',
    headers: { Cookie: alice.cookie }
  });
  assert.equal(delCarol.status, 200);
  const prefsAfterDelete = await storage.getUserChatPrefs('alice_ar');
  assert.equal(prefsAfterDelete.archivedChats.includes(dmCarol), false);
});

test('push notifications: VAPID encryption, Web Push & FCM token lifecycle, and mute suppression', async (t) => {
  const crypto = require('node:crypto');
  const { createPushService, encryptWebPushPayload, toBase64Url } = require('../src/push');
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-push-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null, fcmServerKey: 'test-fcm-key' });
  const storage = createStorage(config);
  const pushCalls = [];
  let nextWebPushStatus = 201;
  const push = createPushService({
    config,
    storage,
    transportFetch: async (url, init) => {
      pushCalls.push({ url, init });
      if (url.includes('fcm.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ results: [{ message_id: 'fcm_1' }] }), text: async () => '{}' };
      }
      return { ok: nextWebPushStatus >= 200 && nextWebPushStatus < 300, status: nextWebPushStatus, text: async () => '' };
    }
  });
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage,
    hub: createRealtimeHub(),
    mailer: createMailer(config),
    push
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_ps', 'alice.ps@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_ps', 'bob.ps@gmail.com');

  const cfgRes = await invokeRouter(handleRequest, '/api/push/config', { headers: { Cookie: alice.cookie } });
  assert.equal(cfgRes.status, 200);
  assert.ok(cfgRes.body.vapidPublicKey && cfgRes.body.vapidPublicKey.length >= 80);
  assert.equal(cfgRes.body.fcmEnabled, true);

  // Real P-256 ECDH subscription keys -> verify RFC 8291 aes128gcm encryption
  const uaEcdh = crypto.createECDH('prime256v1');
  uaEcdh.generateKeys();
  const sub = {
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/mock-endpoint-1',
    keys: {
      p256dh: toBase64Url(uaEcdh.getPublicKey()),
      auth: toBase64Url(crypto.randomBytes(16))
    }
  };
  const encrypted = encryptWebPushPayload(sub, Buffer.from('{"title":"Hi"}'));
  assert.ok(Buffer.isBuffer(encrypted) && encrypted.length > 86);

  const subRes = await invokeRouter(handleRequest, '/api/push/web/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ subscription: sub })
  });
  assert.equal(subRes.status, 200);
  assert.equal(subRes.body.count, 1);

  const fcmRes = await invokeRouter(handleRequest, '/api/push/fcm/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ token: 'mock_fcm_device_token_123', platform: 'android' })
  });
  assert.equal(fcmRes.status, 200);
  assert.equal(fcmRes.body.count, 1);

  const testPushRes = await invokeRouter(handleRequest, '/api/push/test', {
    method: 'POST',
    headers: { Cookie: bob.cookie }
  });
  assert.equal(testPushRes.status, 200);
  assert.equal(testPushRes.body.webSent, 1);
  assert.equal(testPushRes.body.fcmSent, 1);
  assert.equal(pushCalls.length, 2);

  // Muted chat suppresses notifications; 410 prunes expired Web Push subscription
  const dmId = (await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ targetUsername: 'alice_ps' })
  })).body.chat.id;

  await invokeRouter(handleRequest, `/api/chats/${dmId}/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ muted: true })
  });
  const suppressed = await push.notifyUser('bob_ps', { title: 'Alice', body: 'Hidden' }, { chatId: dmId });
  assert.equal(suppressed.suppressed, true);

  nextWebPushStatus = 410;
  await push.notifyUser('bob_ps', { title: 'Test', body: 'Gone sub' }, { ignoreMute: true });
  const tokensAfterGone = await storage.getUserPushTokens('bob_ps');
  assert.equal(tokensAfterGone.webSubscriptions.length, 0);
});

test('polls, quizzes, game leaderboards, streaks, disappearing messages, view-once, and voice waveforms', async (t) => {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-eng-test-'));
  const config = createConfig({ dataDir: tempDataDir, skipDotEnv: true, smtp: null });
  const storage = createStorage(config);
  const handleRequest = createRouter({
    config,
    auth: createAuthHelpers(config),
    storage,
    hub: createRealtimeHub(),
    mailer: createMailer(config)
  });
  t.after(() => fs.rmSync(tempDataDir, { recursive: true, force: true }));

  const alice = await registerTestUser(handleRequest, 'alice_e', 'alice.e@gmail.com');
  const bob = await registerTestUser(handleRequest, 'bob_e', 'bob.e@gmail.com');

  // Friend Alice & Bob so games work
  await invokeRouter(handleRequest, '/api/friends/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_e' })
  });
  await invokeRouter(handleRequest, '/api/friends/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ username: 'alice_e' })
  });

  const dmId = (await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_e' })
  })).body.chat.id;

  // 1. In-Chat Quiz conceals correct answer before vote, reveals + explains after vote
  const quizCreate = await invokeRouter(handleRequest, `/api/chats/${dmId}/polls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({
      mode: 'quiz',
      question: '2 + 2 = ?',
      options: ['3', '4', '5'],
      correctOptionIndex: 1,
      explanation: 'Basic arithmetic!'
    })
  });
  assert.equal(quizCreate.status, 201);
  const quizId = quizCreate.body.message.poll.id;

  const bobViewBeforeVote = await invokeRouter(handleRequest, `/api/chats/${dmId}/messages`, { headers: { Cookie: bob.cookie } });
  const bobQuizMsg = bobViewBeforeVote.body.messages.find((m) => m.poll && m.poll.id === quizId);
  assert.equal(bobQuizMsg.poll.correctOptionIndex, null);
  assert.equal(bobQuizMsg.poll.explanation, '');

  const bobVoteRes = await invokeRouter(handleRequest, `/api/chats/${dmId}/polls/${quizId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({ optionIndex: 1 })
  });
  assert.equal(bobVoteRes.status, 200);
  assert.equal(bobVoteRes.body.message.poll.correctOptionIndex, 1);
  assert.equal(bobVoteRes.body.message.poll.explanation, 'Basic arithmetic!');

  // 2. Tic-Tac-Toe win -> records leaderboard stats & streak
  const gameCreate = await invokeRouter(handleRequest, `/api/chats/${dmId}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ gameType: 'tictactoe' })
  });
  assert.equal(gameCreate.status, 201);
  const gId = gameCreate.body.message.game.id;
  // Alice (X) plays 0, 1, 2; Bob (O) plays 3, 4
  const moves = [
    [alice.cookie, { index: 0 }],
    [bob.cookie, { index: 3 }],
    [alice.cookie, { index: 1 }],
    [bob.cookie, { index: 4 }],
    [alice.cookie, { index: 2 }]
  ];
  for (const [cookie, mv] of moves) {
    const mr = await invokeRouter(handleRequest, `/api/chats/${dmId}/games/${gId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ move: mv })
    });
    assert.equal(mr.status, 200);
  }
  const lbRes = await invokeRouter(handleRequest, '/api/games/leaderboard', { headers: { Cookie: alice.cookie } });
  assert.equal(lbRes.status, 200);
  assert.equal(lbRes.body.myStats.wins, 1);
  assert.equal(lbRes.body.myStats.currentStreak, 1);
  assert.equal(lbRes.body.myStats.bestStreak, 1);
  assert.equal(lbRes.body.myStats.vs.bob_e.wins, 1);
  assert.equal(lbRes.body.leaderboard[0].username, 'alice_e');

  // 3. View-Once message with attachment: sealed -> open once -> burn destroys file
  const voBoundary = '----VRViewOnceBoundary';
  const voPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const voBody = Buffer.concat([
    Buffer.from(`--${voBoundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nTop secret caption\r\n`),
    Buffer.from(`--${voBoundary}\r\nContent-Disposition: form-data; name="viewOnce"\r\n\r\n1\r\n`),
    Buffer.from(`--${voBoundary}\r\nContent-Disposition: form-data; name="files"; filename="secret.png"\r\nContent-Type: image/png\r\n\r\n`),
    voPng,
    Buffer.from(`\r\n--${voBoundary}--\r\n`)
  ]);
  const voSent = await invokeRouter(handleRequest, `/api/chats/${dmId}/messages`, {
    method: 'POST',
    headers: { Cookie: alice.cookie, 'Content-Type': `multipart/form-data; boundary=${voBoundary}` },
    body: voBody
  });
  assert.equal(voSent.status, 201);
  const voMsgId = voSent.body.message.id;
  const rawStoredUrl = voSent.body.message.attachments[0].url;

  const bobSealed = (await invokeRouter(handleRequest, `/api/chats/${dmId}/messages`, { headers: { Cookie: bob.cookie } })).body.messages.find((m) => m.id === voMsgId);
  assert.equal(bobSealed.viewOnceState, 'sealed');
  assert.equal(bobSealed.text, '');
  assert.equal(bobSealed.attachments.length, 0);

  // Direct file download blocked for Bob without viewToken
  const snoopRes = await invokeRouter(handleRequest, rawStoredUrl, { headers: { Cookie: bob.cookie } });
  assert.equal(snoopRes.status, 404);

  // Reveal once -> grants tokenized attachment URL
  const revealRes = await invokeRouter(handleRequest, `/api/chats/${dmId}/messages/${voMsgId}/view-once`, {
    method: 'POST',
    headers: { Cookie: bob.cookie }
  });
  assert.equal(revealRes.status, 200);
  assert.equal(revealRes.body.message.text, 'Top secret caption');
  assert.ok(revealRes.body.message.attachments[0].url.includes('viewToken='));

  const fetchedOnce = await invokeRouter(handleRequest, revealRes.body.message.attachments[0].url, { headers: { Cookie: bob.cookie } });
  assert.equal(fetchedOnce.status, 200);

  // Burn -> permanently wipes file and blocks second open
  const burnRes = await invokeRouter(handleRequest, `/api/chats/${dmId}/messages/${voMsgId}/view-once/burn`, {
    method: 'POST',
    headers: { Cookie: bob.cookie }
  });
  assert.equal(burnRes.status, 200);
  assert.equal(burnRes.body.message.viewOnceState, 'consumed');

  const secondReveal = await invokeRouter(handleRequest, `/api/chats/${dmId}/messages/${voMsgId}/view-once`, {
    method: 'POST',
    headers: { Cookie: bob.cookie }
  });
  assert.equal(secondReveal.status, 410);

  // 4. Voice waveform meta & disappearing timed message (countdown starts ONLY after opening)
  const vBoundary = '----VRVoiceBoundary';
  const voiceMetaJson = JSON.stringify({ durationSec: 7, peaks: [18, 45, 82, 60, 25] });
  const vBody = Buffer.concat([
    Buffer.from(`--${vBoundary}\r\nContent-Disposition: form-data; name="voiceMeta"\r\n\r\n${voiceMetaJson}\r\n`),
    Buffer.from(`--${vBoundary}\r\nContent-Disposition: form-data; name="ttlSeconds"\r\n\r\n1\r\n`),
    Buffer.from(`--${vBoundary}\r\nContent-Disposition: form-data; name="files"; filename="voice-1.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
    Buffer.from('OggS_fake_audio_bytes'),
    Buffer.from(`\r\n--${vBoundary}--\r\n`)
  ]);
  const voiceRes = await invokeRouter(handleRequest, `/api/chats/${dmId}/messages`, {
    method: 'POST',
    headers: { Cookie: alice.cookie, 'Content-Type': `multipart/form-data; boundary=${vBoundary}` },
    body: vBody
  });
  assert.equal(voiceRes.status, 201);
  assert.equal(voiceRes.body.message.timed, true);
  assert.equal(voiceRes.body.message.expiresAt, undefined);
  assert.equal(voiceRes.body.message.voiceMeta.durationSec, 7);
  assert.deepEqual(voiceRes.body.message.voiceMeta.peaks, [18, 45, 82, 60, 25]);
  const timedVoiceId = voiceRes.body.message.id;
  const timedRawUrl = voiceRes.body.message.attachments[0].url;

  // Before opening: recipient sees a sealed timed box, empty attachments, and direct file access is blocked
  const bobSealedTimed = (await invokeRouter(handleRequest, `/api/chats/${dmId}/messages`, { headers: { Cookie: bob.cookie } })).body.messages.find((m) => m.id === timedVoiceId);
  assert.equal(bobSealedTimed.timedState, 'sealed');
  assert.equal(bobSealedTimed.attachments.length, 0);
  const blockedTimedFile = await invokeRouter(handleRequest, timedRawUrl, { headers: { Cookie: bob.cookie } });
  assert.equal(blockedTimedFile.status, 404);

  // Opening timed message reveals content AND starts the countdown
  const openTimedRes = await invokeRouter(handleRequest, `/api/chats/${dmId}/messages/${timedVoiceId}/open-timed`, {
    method: 'POST',
    headers: { Cookie: bob.cookie }
  });
  assert.equal(openTimedRes.status, 200);
  assert.ok(openTimedRes.body.message.openedAt);
  assert.ok(openTimedRes.body.message.expiresAt);
  assert.equal(openTimedRes.body.message.attachments.length, 1);

  // Wait > 1.05s -> disappearing message expires and is purged cleanly
  await new Promise((r) => setTimeout(r, 1100));
  const afterExp = await invokeRouter(handleRequest, `/api/chats/${dmId}/messages`, { headers: { Cookie: bob.cookie } });
  assert.equal(afterExp.body.messages.some((m) => m.id === timedVoiceId), false);

  // 5. Sidebar lastMessage readBy (sent -> seen ticks outside chat)
  await invokeRouter(handleRequest, `/api/chats/${dmId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Check sidebar tick' })
  });
  const listSentOnly = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } })).body.chats;
  const dmSummaryBeforeRead = listSentOnly.find((c) => c.id === dmId);
  assert.deepEqual(dmSummaryBeforeRead.lastMessage.readBy, ['alice_e']);

  await invokeRouter(handleRequest, `/api/chats/${dmId}/read`, { method: 'POST', headers: { Cookie: bob.cookie } });
  const listSeen = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: alice.cookie } })).body.chats;
  const dmSummaryAfterRead = listSeen.find((c) => c.id === dmId);
  assert.equal(dmSummaryAfterRead.lastMessage.readBy.includes('bob_e'), true);

  // 6. Secret Chat mode: separate sec_ chat, configurable timer, masked sidebar & push previews, countdown starts on peer seen
  const openSecretRes = await invokeRouter(handleRequest, '/api/chats/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetUsername: 'bob_e', type: 'secret' })
  });
  assert.equal(openSecretRes.status, 200);
  assert.ok(openSecretRes.body.chat.id.startsWith('sec_'));
  assert.equal(openSecretRes.body.chat.type, 'secret');
  const secChatId = openSecretRes.body.chat.id;
  assert.notEqual(secChatId, dmId);

  const setTimerRes = await invokeRouter(handleRequest, `/api/chats/${secChatId}/secret-timer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ timerSec: 1 })
  });
  assert.equal(setTimerRes.status, 200);
  assert.equal(setTimerRes.body.secretTimerSec, 1);

  const secSendRes = await invokeRouter(handleRequest, `/api/chats/${secChatId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ text: 'Ultra confidential secret text' })
  });
  assert.equal(secSendRes.status, 201);
  const secMsgId = secSendRes.body.message.id;
  assert.equal(secSendRes.body.message.secretMsg, true);
  assert.equal(secSendRes.body.message.ttlSeconds, 1);
  assert.equal(secSendRes.body.message.expiresAt, undefined);

  // Sidebar summary & push formatter MUST NOT leak message content
  const secChatSummary = (await invokeRouter(handleRequest, '/api/chats', { headers: { Cookie: bob.cookie } })).body.chats.find((c) => c.id === secChatId);
  assert.equal(secChatSummary.isSecret, true);
  assert.equal(secChatSummary.lastMessage.preview, 'Sent a message');
  assert.equal(secChatSummary.lastMessage.preview.includes('Ultra confidential'), false);

  const pushSvc = require('../src/push').createPushService({ config, storage });
  const pushMask = pushSvc.formatMessagePreview(
    { id: secMsgId, chatId: secChatId, sender: 'alice_e', text: 'Ultra confidential secret text' },
    { displayName: 'Alice', username: 'alice_e' },
    { type: 'secret', title: '' }
  );
  assert.equal(pushMask.title, '🔒 Alice');
  assert.equal(pushMask.body, 'Sent a message');

  // Forwarding from Secret Chat must be blocked
  const fwdBlockRes = await invokeRouter(handleRequest, `/api/chats/${secChatId}/forward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: alice.cookie },
    body: JSON.stringify({ targetChatIds: [dmId], messageIds: [secMsgId] })
  });
  assert.equal(fwdBlockRes.status, 403);

  // Wait before Bob sees -> message does NOT expire yet
  await new Promise((r) => setTimeout(r, 1100));
  const secBeforeSeen = await invokeRouter(handleRequest, `/api/chats/${secChatId}/messages`, { headers: { Cookie: bob.cookie } });
  assert.equal(secBeforeSeen.body.messages.some((m) => m.id === secMsgId), true);

  // Bob marks read -> countdown starts now
  const secReadRes = await invokeRouter(handleRequest, `/api/chats/${secChatId}/read`, {
    method: 'POST',
    headers: { Cookie: bob.cookie }
  });
  assert.equal(secReadRes.status, 200);
  const secAfterSeenImmediate = await invokeRouter(handleRequest, `/api/chats/${secChatId}/messages`, { headers: { Cookie: bob.cookie } });
  const secMsgSeenObj = secAfterSeenImmediate.body.messages.find((m) => m.id === secMsgId);
  assert.ok(secMsgSeenObj && secMsgSeenObj.expiresAt);

  // Wait > 1.05s after seen -> message self-destructs
  await new Promise((r) => setTimeout(r, 1100));
  const secExpiredRes = await invokeRouter(handleRequest, `/api/chats/${secChatId}/messages`, { headers: { Cookie: alice.cookie } });
  assert.equal(secExpiredRes.body.messages.some((m) => m.id === secMsgId), false);
});






