const net = require('node:net');
const tls = require('node:tls');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Zero-dependency SMTP + Local Outbox mailer for account verification codes.
 */

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildVerificationEmail({ to, username, code, expiresMinutes }) {
  const subject = `TeleChat Verification Code: ${code}`;
  const text = [
    `Hello @${username},`,
    '',
    `Your TeleChat account verification code is: ${code}`,
    '',
    `This code expires in ${expiresMinutes} minutes.`,
    'If you did not request this signup, you can safely ignore this email.',
    '',
    '— TeleChat'
  ].join('\r\n');

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#0E1621;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#F5F5F5;">
  <div style="max-width:460px;margin:0 auto;background:#17212B;border-radius:16px;padding:28px;border:1px solid rgba(255,255,255,0.08);">
    <div style="font-size:20px;font-weight:700;color:#64B5F6;margin-bottom:8px;">TeleChat</div>
    <h2 style="margin:0 0 12px;font-size:18px;color:#FFFFFF;">Verify your email address</h2>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#B8C7D4;">
      Hi <strong>@${escapeHtml(username)}</strong>, enter the 6-digit code below to finish creating your TeleChat account:
    </p>
    <div style="background:#242F3D;border-radius:12px;padding:16px;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#FFFFFF;margin-bottom:18px;">
      ${escapeHtml(code)}
    </div>
    <p style="margin:0;font-size:12.5px;color:#8A9BA8;line-height:1.45;">
      This code expires in ${expiresMinutes} minutes. If you didn't request this, ignore this email.
    </p>
  </div>
</body>
</html>`;

  return { to, subject, text, html };
}

function extractAddress(fromHeader) {
  const match = /<([^>]+)>/.exec(fromHeader || '');
  return (match ? match[1] : fromHeader || '').trim();
}

function createSmtpSession(smtp) {
  return new Promise((resolve, reject) => {
    const onConnect = (socket) => {
      socket.setTimeout(15000);
      socket.setEncoding('utf8');

      let buffer = '';
      let currentWaiter = null;

      function processLines() {
        while (true) {
          const idx = buffer.indexOf('\r\n');
          if (idx < 0) break;
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!currentWaiter) continue;
          currentWaiter.lines.push(line);
          // Multi-line SMTP responses have '-' at index 3; final line has ' '
          if (line.length >= 4 && line[3] === ' ') {
            const waiter = currentWaiter;
            currentWaiter = null;
            const code = parseInt(line.slice(0, 3), 10);
            waiter.resolve({ code, lines: waiter.lines });
          } else if (line.length === 3 && /^\d{3}$/.test(line)) {
            const waiter = currentWaiter;
            currentWaiter = null;
            waiter.resolve({ code: parseInt(line, 10), lines: waiter.lines });
          }
        }
      }

      const attachListeners = (sock) => {
        sock.on('data', (chunk) => {
          buffer += chunk;
          processLines();
        });
        sock.on('error', (err) => {
          if (currentWaiter) {
            const w = currentWaiter;
            currentWaiter = null;
            w.reject(err);
          } else {
            reject(err);
          }
        });
        sock.on('timeout', () => {
          sock.destroy(new Error('SMTP connection timed out.'));
        });
      };

      let activeSock = socket;
      attachListeners(activeSock);

      const readResponse = () => new Promise((res, rej) => {
        currentWaiter = { lines: [], resolve: res, reject: rej };
        processLines();
      });

      const sendCmd = async (cmd, expectedCodes) => {
        activeSock.write(`${cmd}\r\n`);
        const resp = await readResponse();
        if (expectedCodes && !expectedCodes.includes(resp.code)) {
          throw new Error(`SMTP error (${resp.code}): ${resp.lines.join(' ')}`);
        }
        return resp;
      };

      const upgradeTls = () => new Promise((res, rej) => {
        activeSock.removeAllListeners('data');
        activeSock.removeAllListeners('error');
        activeSock.removeAllListeners('timeout');
        const tlsSock = tls.connect(
          { socket: activeSock, servername: smtp.host, rejectUnauthorized: true },
          () => {
            activeSock = tlsSock;
            activeSock.setTimeout(15000);
            activeSock.setEncoding('utf8');
            attachListeners(activeSock);
            res();
          }
        );
        tlsSock.on('error', rej);
      });

      resolve({
        readResponse,
        sendCmd,
        upgradeTls,
        sendRaw: (data) => activeSock.write(data),
        close: () => activeSock.end()
      });
    };

    if (smtp.secure) {
      const sock = tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host }, () => onConnect(sock));
      sock.on('error', reject);
    } else {
      const sock = net.connect({ host: smtp.host, port: smtp.port }, () => onConnect(sock));
      sock.on('error', reject);
    }
  });
}

async function sendViaSmtp(smtp, mail) {
  const session = await createSmtpSession(smtp);
  try {
    const greeting = await session.readResponse();
    if (greeting.code !== 220) {
      throw new Error(`Unexpected SMTP greeting: ${greeting.code}`);
    }

    let ehlo = await session.sendCmd('EHLO telechat.local', [250]);
    const supportsStartTls = ehlo.lines.some((l) => /STARTTLS/i.test(l));

    if (!smtp.secure && supportsStartTls) {
      await session.sendCmd('STARTTLS', [220]);
      await session.upgradeTls();
      ehlo = await session.sendCmd('EHLO telechat.local', [250]);
    }

    const authLine = ehlo.lines.find((l) => /AUTH/i.test(l)) || '';
    if (/PLAIN/i.test(authLine)) {
      const token = Buffer.from(`\0${smtp.user}\0${smtp.pass}`).toString('base64');
      await session.sendCmd(`AUTH PLAIN ${token}`, [235]);
    } else {
      await session.sendCmd('AUTH LOGIN', [334]);
      await session.sendCmd(Buffer.from(smtp.user).toString('base64'), [334]);
      await session.sendCmd(Buffer.from(smtp.pass).toString('base64'), [235]);
    }

    const fromAddr = extractAddress(smtp.from);
    await session.sendCmd(`MAIL FROM:<${fromAddr}>`, [250]);
    await session.sendCmd(`RCPT TO:<${mail.to}>`, [250, 251]);
    await session.sendCmd('DATA', [354]);

    const boundary = `----TeleChatMail${Date.now().toString(16)}`;
    const mimeMsg = [
      `From: ${smtp.from}`,
      `To: <${mail.to}>`,
      `Subject: ${mail.subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      mail.text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      mail.html,
      '',
      `--${boundary}--`,
      '.',
      ''
    ].join('\r\n');

    // Dot-stuff lines beginning with '.' inside body (excluding final '.')
    const lines = mimeMsg.split('\r\n');
    const stuffed = lines.slice(0, -2).map((l) => (l.startsWith('.') ? `.${l}` : l));
    stuffed.push('.', '');

    session.sendRaw(stuffed.join('\r\n'));
    const dataResp = await session.readResponse();
    if (dataResp.code !== 250) {
      throw new Error(`SMTP DATA rejected (${dataResp.code}): ${dataResp.lines.join(' ')}`);
    }

    await session.sendCmd('QUIT', [221, 250]).catch(() => {});
  } finally {
    session.close();
  }
}

function createMailer(config) {
  async function sendVerificationCode({ to, username, code, expiresMinutes }) {
    const mail = buildVerificationEmail({ to, username, code, expiresMinutes });

    if (config.smtp) {
      await sendViaSmtp(config.smtp, mail);
      return { deliveryMode: 'smtp' };
    }

    // Local / Dev Outbox fallback when SMTP is not configured
    await fsp.mkdir(config.outboxDir, { recursive: true });
    const safeEmail = to.replace(/[^a-z0-9._@-]/gi, '_');
    const logPath = path.join(config.outboxDir, `${safeEmail}.log`);
    const entry = [
      '========================================',
      `Time: ${new Date().toISOString()}`,
      `To: ${to}`,
      `Username: @${username}`,
      `Subject: ${mail.subject}`,
      `Verification Code: ${code}`,
      `Expires In: ${expiresMinutes} minutes`,
      '========================================',
      ''
    ].join('\n');
    await fsp.appendFile(logPath, entry, 'utf8');

    if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) {
      console.log(`[TeleChat Mailer - Dev Outbox] Verification code for ${to} (@${username}): ${code}`);
    }

    return {
      deliveryMode: 'dev',
      devCode: config.allowDevEmailCode ? code : undefined
    };
  }

  return { sendVerificationCode };
}

module.exports = { createMailer, buildVerificationEmail };
