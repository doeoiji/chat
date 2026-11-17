# VibeRoom

**VibeRoom** is an open, zero-dependency real-time messaging, media-sharing, and social hangout platform (Web, PWA, and Android) designed to grow into a multipurpose space for chatting with friends, connecting with new people, voice/video calls, and multiplayer mini-games.

## Features

- **Clean Messaging Interface**: Dark/Light/AMOLED/Ocean/Sunset themes, custom accent colors, bubble styles, reply quotes, emoji picker, quick reactions, in-chat message search, lightbox image viewer, and drag-and-drop or clipboard-paste uploads.
- **Email Verification & Valid Platform Enforcement**: Accounts require username, valid email platform (temp/disposable mail blocked), and 6-digit OTP email verification (5-minute code expiration, progressive `2m → +2m` resend cooldown) via built-in SMTP or local dev outbox.
- **Folder-Based Storage**:
  - User profiles & avatars under `data/users/<username>/`
  - Direct chat logs (`meta.json`, `messages.json`, `chat.log`, `files/`) under `data/chats/dm_<user1>__<user2>/`
- **Real-Time Presence & Notifications**: Powered by Server-Sent Events (`/api/events`) with typing indicators, online status, read receipts, desktop/mobile browser notifications, and PWA installability.
- **Android App (`android/`) with In-App Self-Updater**:
  - Wraps the live website so UI and feature updates apply automatically.
  - Shows Messenger-style conversation notifications with sender profile pictures.
  - Checks GitHub Releases for native APK updates (`Settings → App Update`) and auto-cleans downloaded APKs after install.

## Roadmap

- Anonymous random chat matching
- Peer-to-peer WebRTC audio & video calling
- Multiplayer mini-games inside chat rooms

## Quick Start

Requires **Node.js 18+**. No external npm dependencies required.

```bash
git clone https://github.com/doeoiji/chat.git
cd chat
cp .env.example .env   # Optional: configure PORT and SMTP credentials
npm start
```

Open `http://127.0.0.1:3000` in your browser.

## Running Tests

```bash
npm test
```

## License

[MIT](LICENSE)
