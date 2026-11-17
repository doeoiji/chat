<div align="center">

# VibeRoom — Chat, Calls & Mini-Games

**A fast, zero-dependency real-time messaging, media-sharing, voice/video calling, and social gaming platform for Web, PWA, and Android.**

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518.0-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/Dependencies-Zero-blue?style=flat-square)
![Transport](https://img.shields.io/badge/Real--Time-SSE%20%2B%20WebRTC-0088cc?style=flat-square)
![Android](https://img.shields.io/badge/Android-Standard%20%26%20Legacy%20APKs-3DDC84?style=flat-square&logo=android&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square)

</div>

---

## ✨ Key Features

### 💬 Everyday Messaging & Conveniences
- **Real-Time Delivery (SSE)**: Typing indicators, online presence, read receipts (`✓` / `✓✓`), desktop/mobile notifications, and unread counters powered by Server-Sent Events (`/api/events`).
- **Edit, Reply, Pin & React**: Left-click (desktop) or long-press (mobile) any message to **Edit** (with `edited` badge), **Reply**, **Pin** to top (tap banner to jump), **React** with quick/expanded emojis, **Copy**, or **Forward**.
- **Saved Messages (`Saved Messages`)**: A pinned personal cloud self-chat to save notes, links, voice memos, and files between your phone and PC.
- **Multi-Select & Forward**: Select multiple messages at once to copy, forward to Saved Messages / friends / groups / channels, or bulk delete.
- **Delete for Me vs. Also Delete for Other User**: Choosing **Delete** on messages or chats opens a confirmation prompt with an optional **"Also delete for `<user>`"** toggle — delete only from your view (`deletedFor`) or remove for both/everyone.
- **Desktop Right-Click & Mobile Long-Press Chat Management**:
  - **Desktop**: Right-click any chat row in the sidebar to **Select Chats**, **Pin / Unpin**, **Mute / Unmute Notifications**, or **Delete Chat**.
  - **Mobile / Android**: Long-press a chat row to enter multi-select mode and batch-apply **Pin**, **Mute / Unmute**, or **Delete**.
- **Voice Messages**: Microphone button inside empty composer supports hold-to-record release-to-send or tap-to-record with a live timer, cancel, and send controls.
- **Markdown, Spoilers & Rich Link Previews**: Supports `**bold**`, `*italic*`, `` `inline code` ``, ```` ```code blocks``` ````, click-to-reveal `||spoiler||` text, and SSRF-protected OpenGraph link preview cards.
- **Rich Media & File Sharing**: Drag-and-drop, clipboard paste, photo lightbox viewer, audio/video playback, customizable max upload size (`MAX_UPLOAD_MB=25`), and Shared Media/Files drawer.

### 🎭 Anonymous Chat, Voice/Video Calls & Mini-Games
- **Stranger Lounge (Anonymous Random Chat)**:
  - 1-tap **"Meet Someone New"** matching queue with optional interest/topic tags and language filters.
  - Ephemeral anonymous identities (`Ghost #...`) with **Skip / Next**, **Report**, and mutual **"Reveal Profile & Add Friend"**.
- **Peer-to-Peer WebRTC Audio & Video Calls**:
  - Direct voice and video calling from DM headers with incoming-call ring screen, audio/video/camera-flip controls, floating mini-player (text while on call), and persistent call history entries in chat.
- **Playable Chat Mini-Games**:
  - Challenge friends directly inside any chat to **Tic-Tac-Toe**, **Chess**, **Connect 4**, or **Word Duel**, synced live via SSE with invite-sender cancel controls.
- **Groups & Broadcast Channels**:
  - Create multi-user groups and admin-only broadcast channels with shareable invite links, `@mentions`, member lists, and admin management.

### 🔒 Privacy, Safety & Account Essentials
- **Exact-Only User Search & Friends System**: All accounts are hidden from open directory browsing; search requires an exact `@username` or email. Send, cancel, accept, or decline friend requests, and unfriend from the Friends tab or user info panel.
- **Granular Privacy Settings**: Independently control who can see your **Email**, **Birthday**, **Last Seen / Online Status**, and **Profile Photo** (*Everyone / Contacts / Nobody*).
- **Block & Report Controls**: Block/unblock users from chat info, banners, or Settings (prevents DMs, calls, friend requests, and hides presence/photos) and file user reports (`data/reports.jsonl`).
- **Forgot Password, Change Password & Safe Account Deletion**:
  - **Forgot Password**: Reset via 6-digit Email OTP right from the login screen.
  - **Change Password**: Update password inside **Settings → Account & Profile**.
  - **Account Deletion**: Located at the bottom of the Settings menu; requires a 6-digit Email OTP plus typing `DELETE`. Removes the account from active users (releasing both username and email for re-registration) while preserving all stored audit logs and historical records with a `"deleted": true` flag.
- **Shareable Profile Link & Scannable QR Code**: Share `https://<your-host>/?user=<username>` or let friends scan your built-in QR code (zero-dependency SVG encoder in [`public/qrcode.js`](public/qrcode.js)) inside Settings.
- **3-Tier Audit Logging**: Tracks authentication, IP addresses, parsed client devices, chats, calls, reports, and moderation events across `data/users/<username>/activity.log`, `data/users/<username>/universal.log`, and global `data/universal.log`.

### 🎨 Themes, PWA & Android Dual-APK Support
- **5 Built-In Themes & Customizations**: *Telegram Night*, *Daylight*, *Midnight AMOLED*, *Oceanic Teal*, and *Sunset Plum*, plus 6 accent colors, bubble corner styles, font sizes, and doodle wallpaper toggle.
- **Progressive Web App (PWA)**: Installable on desktop and mobile with Service Worker offline notification support.
- **Dual-Flavor Android App (`android/`)** (`v1.0.9`):
  - **Standard (`fun.bitdev.telechat`)** — `minSdk 24`, `targetSdk 35` (`VibeRoom-v<version>.apk`, Android 7.0+)
  - **Legacy Compat (`fun.bitdev.telechat.legacy`)** — `minSdk 21`, `targetSdk 29` (`VibeRoomCompat-v<version>.apk`, Android 5.0–10 / older devices)
  - Built-in GitHub Releases self-updater (`Settings → App Updates`), native profile-avatar notifications, share-target support, and runtime camera/microphone WebRTC permissions.

---

## 📁 Project Structure

```text
├── server.js                 # HTTP server entry point & graceful shutdown
├── .env.example              # Environment variable template
├── package.json              # Scripts & Node engine config (zero external deps)
├── src/
│   ├── audit.js              # 3-tier activity.log & universal.log audit logger
│   ├── auth.js               # Salted scrypt password hashing & HMAC session cookies
│   ├── calls.js              # WebRTC call signaling & persistent call history
│   ├── config.js             # Env/port/SMTP/upload configuration loader
│   ├── emailValidator.js     # Email format & disposable/temp mail blocker
│   ├── friends.js            # Friends & friend request lifecycle
│   ├── games.js              # Tic-Tac-Toe, Chess, Connect 4 & Word Duel engines
│   ├── groups.js             # Groups, broadcast channels & invite links
│   ├── linkPreview.js        # SSRF-safe OpenGraph/meta link preview fetcher
│   ├── mailer.js             # Zero-dependency SMTP + TLS + local dev outbox mailer
│   ├── multipart.js          # Streaming multipart/form-data file upload parser
│   ├── realtime.js           # SSE pub/sub hub & online presence tracker
│   ├── router.js             # REST API & SSE HTTP router
│   ├── storage.js            # Folder-based JSON + log storage engine
│   └── stranger.js           # Anonymous Stranger Lounge matchmaking & reveal
├── public/
│   ├── index.html            # Single-page workspace shell & modals
│   ├── app.js                # Core messaging, auth, privacy, media & UI logic
│   ├── features.js           # Stranger Lounge, Calls, Mini-Games & Groups/Channels
│   ├── qrcode.js             # Zero-dependency ISO/IEC 18004 QR SVG encoder
│   ├── styles.css            # Responsive theming & Telegram-inspired UI styles
│   ├── sw.js                 # PWA Service Worker for notifications
│   └── manifest.webmanifest  # PWA manifest
├── android/                  # Native Android WebView wrapper (Standard & Legacy flavors)
└── tests/
    └── app.test.js           # Node built-in test suite
```

---

## 🚀 Quick Start

Requires **Node.js 18+** (zero `npm install` packages needed).

```bash
git clone https://github.com/doeoiji/chat.git
cd chat
cp .env.example .env   # Edit PORT, HOST, and optional SMTP settings
npm start
```

Open `http://127.0.0.1:3000` in your browser.

> **Local Dev Mode:** If SMTP credentials are omitted, 6-digit verification codes are saved to `data/outbox/<email>.log` (and shown in the UI preview banner when `ALLOW_DEV_EMAIL_CODE=true`).

---

## ⚙️ Environment Configuration (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Server listening port |
| `HOST` | `127.0.0.1` | Server bind address (`0.0.0.0` for LAN/public) |
| `MAX_UPLOAD_MB` | `25` | Max multipart upload size in MB |
| `SESSION_SECRET` | Auto-generated | HMAC secret for signing session cookies |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | — | SMTP server host, port (`587`/`465`), and TLS flag |
| `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | SMTP authentication credentials & sender header |
| `ALLOW_DEV_EMAIL_CODE` | `true` (dev) | Return OTP code in API response when SMTP is unset (set `false` in production) |

---

## 🧪 Running Tests

Run the full automated test suite (uses Node's built-in test runner):

```bash
npm test
```

On Windows PowerShell:

```powershell
npm.cmd test
```

---

## 📄 License

[MIT](LICENSE)
