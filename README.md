# TeleChat

A smooth, zero-dependency, Telegram-inspired real-time messaging web application built with Node.js and vanilla HTML/CSS/JS.

## Features

- **Telegram-Inspired Interface**: Clean Dark & Light themes, geometric chat wallpaper, grouped message bubbles, reply quotes, emoji picker, quick reactions, image lightbox viewer, drag-and-drop & clipboard paste uploads, and responsive mobile navigation.
- **Account Creation with Email Verification & Valid Email Platform Check**: Users sign up with **username**, **email**, and **password** (`scrypt` salted hashing). Temporary/disposable email domains (e.g., `mailinator.com`, `10minutemail.com`, `yopmail.com`, `temp-mail.org`) and unrecognized fake domains are rejected; major valid email platforms (Gmail, Outlook, Yahoo, iCloud, Proton, Zoho, Fastmail, `.edu`, etc.) are supported. Signup sends a 6-digit OTP verification code via built-in SMTP (when configured in `.env`) or logs it to `data/outbox/` in local dev mode before creating the verified user folder.
- **File-System User & Chat Log Folders**:
  - Each registered user gets a folder under `data/users/<username>/` storing `profile.json` and `uploads/`.
  - Each active conversation between two users automatically creates a folder under `data/chats/dm_<user1>__<user2>/` containing `meta.json`, `messages.json`, human-readable `chat.log`, and `files/` for shared images and files.
- **Search by Username or Email**: Instant live search lets users find each other by `@username`, email address, or display name.
- **Real-Time Messaging**: Powered by Server-Sent Events (SSE) for instant message delivery, live typing indicators, online/last-seen presence, and read receipts (`✓` / `✓✓`).
- **Image & File Sharing**: Upload multiple images or files (up to 25 MB by default), preview images inline and in a full-screen lightbox, play audio/video inline, or download any file.

## Folder Structure

```text
├── server.js               # HTTP server entry point
├── src/
│   ├── config.js           # Configuration & .env loader
│   ├── emailValidator.js   # Valid email platform & temp-mail blocker
│   ├── auth.js             # Password hashing & signed session cookies
│   ├── storage.js          # User folders & chat log folder persistence
│   ├── multipart.js        # Multipart/form-data parser for uploads
│   ├── realtime.js         # SSE hub (messages, typing, presence, receipts)
│   ├── mailer.js           # Zero-dependency SMTP + local outbox verification mailer
│   └── router.js           # REST API & static file router
├── public/                 # Telegram-style frontend (HTML, CSS, JS)
├── data/
│   ├── users/              # Per-user folders (<username>/profile.json)
│   └── chats/              # Per-chat folders (dm_a__b/messages.json, chat.log, files/)
└── tests/
    └── app.test.js         # Automated unit & integration tests
```

## Quick Start

Requires **Node.js 18+**. No external dependencies required.

```bash
# 1. Clone the repository
git clone https://github.com/your-username/telechat.git
cd telechat

# 2. (Optional) Copy environment config
cp .env.example .env

# 3. Start the server
npm start
```

Open `http://127.0.0.1:3000` in your browser.

## Running Tests

```bash
npm test
```

## Configuration

Copy `.env.example` to `.env` to customize settings:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Host interface to bind |
| `MAX_UPLOAD_MB` | `25` | Maximum upload size in megabytes |
| `SESSION_SECRET` | Auto-generated | Custom secret for signing session cookies |
| `SMTP_HOST` | Empty | SMTP server host (e.g. `smtp.gmail.com`) for real email delivery |
| `SMTP_PORT` | `587` | SMTP port (`587` for STARTTLS, `465` for implicit TLS) |
| `SMTP_USER` | Empty | SMTP login username / email |
| `SMTP_PASS` | Empty | SMTP password or app password |
| `SMTP_FROM` | `SMTP_USER` | Sender header (e.g. `TeleChat <you@gmail.com>`) |
| `ALLOW_DEV_EMAIL_CODE` | `true` | Shows dev preview code when SMTP is not configured; set `false` in production |

## License

[MIT](LICENSE)
