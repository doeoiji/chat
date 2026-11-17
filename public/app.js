(() => {
  'use strict';

  const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👏'];
  const EMOJI_LIST = [
    '😀', '😂', '🥹', '😍', '🥰', '😎', '🤩',
    '🤔', '😅', '😭', '🥳', '🤯', '😴', '🙏',
    '👍', '👎', '👏', '🙌', '🤝', '💪', '🔥',
    '❤️', '💙', '💚', '✨', '🎉', '💯', '🚀',
    '👀', '💬', '📎', '📷', '🎵', '✅', '⚡'
  ];

  const TEMP_HINT_DOMAINS = [
    'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com',
    'temp-mail.org', 'yopmail.com', 'throwawaymail.com', 'getnada.com',
    'maildrop.cc', 'trashmail.com', 'dispostable.com', 'mohmal.com',
    'fakeinbox.com', 'sharklasers.com', 'burnermail.io', 'mail.tm', 'mail.gw'
  ];

  const DEFAULT_PREFS = {
    theme: 'dark',
    accent: 'blue',
    wallpaper: true,
    corners: 'classic',
    fontSize: 'md',
    sounds: true,
    animations: true,
    enterToSend: true,
    notifications: true
  };

  const state = {
    me: null,
    chats: [],
    activeChatId: null,
    activePeer: null,
    messages: [],
    pendingFiles: [],
    replyTo: null,
    searchQuery: '',
    browseMode: false,
    searchResults: [],
    typingPeers: new Map(), // chatId -> timeoutId
    onlineUsers: new Set(),
    infoOpen: false,
    infoTab: 'media',
    eventSource: null,
    theme: localStorage.getItem('telechat_theme') || 'dark',
    prefs: loadPrefs(),
    sending: false,
    chatSearch: {
      open: false,
      query: '',
      matches: [],
      index: -1
    },
    verification: {
      id: null,
      maskedEmail: '',
      expiresAt: 0,
      resendAvailableAt: 0,
      timerId: null
    }
  };

  // DOM helpers
  const $ = (id) => document.getElementById(id);

  const els = {
    authScreen: $('auth-screen'),
    appShell: $('app-shell'),
    authTabs: $('auth-tabs'),
    tabLogin: $('tab-login'),
    tabRegister: $('tab-register'),
    loginForm: $('login-form'),
    registerForm: $('register-form'),
    verifyForm: $('verify-form'),
    verifySubtitle: $('verify-subtitle'),
    verifyDevBanner: $('verify-dev-banner'),
    otpInputs: $('otp-inputs'),
    verifyCountdown: $('verify-countdown'),
    verifyError: $('verify-error'),
    verifySubmit: $('verify-submit'),
    verifyResendBtn: $('verify-resend-btn'),
    verifyBackBtn: $('verify-back-btn'),
    loginIdentifier: $('login-identifier'),
    loginPassword: $('login-password'),
    loginError: $('login-error'),
    loginSubmit: $('login-submit'),
    regUsername: $('reg-username'),
    regDisplayName: $('reg-displayname'),
    regEmail: $('reg-email'),
    regEmailHint: $('reg-email-hint'),
    regPassword: $('reg-password'),
    registerError: $('register-error'),
    registerSubmit: $('register-submit'),

    hamburgerBtn: $('hamburger-btn'),
    navDrawer: $('nav-drawer'),
    navDrawerBackdrop: $('nav-drawer-backdrop'),
    drawerAvatar: $('drawer-avatar'),
    drawerDisplayName: $('drawer-displayname'),
    drawerUsername: $('drawer-username'),
    drawerEmail: $('drawer-email'),
    drawerThemeBtn: $('drawer-theme-btn'),
    themeIcon: $('theme-icon'),
    drawerSettingsBtn: $('drawer-settings-btn'),
    menuFindUsers: $('menu-find-users'),
    menuEditProfile: $('menu-edit-profile'),
    menuSettings: $('menu-settings'),
    menuToggleTheme: $('menu-toggle-theme'),
    menuThemeLabel: $('menu-theme-label'),
    menuLogout: $('menu-logout'),

    sidebarSearch: $('sidebar-search'),
    clearSearchBtn: $('clear-search-btn'),
    browseUsersBtn: $('browse-users-btn'),
    notifBanner: $('notif-banner'),
    notifAllowBtn: $('notif-allow-btn'),
    notifDismissBtn: $('notif-dismiss-btn'),
    sidebarSectionTitle: $('sidebar-section-title'),
    sidebarList: $('sidebar-list'),

    chatEmptyState: $('chat-empty-state'),
    activeChat: $('active-chat'),
    mobileBackBtn: $('mobile-back-btn'),
    chatPeerTrigger: $('chat-peer-trigger'),
    chatPeerAvatar: $('chat-peer-avatar'),
    chatPeerDot: $('chat-peer-dot'),
    chatPeerName: $('chat-peer-name'),
    chatPeerStatus: $('chat-peer-status'),
    toggleChatSearchBtn: $('toggle-chat-search-btn'),
    toggleInfoBtn: $('toggle-info-btn'),

    chatSearchBar: $('chat-search-bar'),
    chatSearchInput: $('chat-search-input'),
    chatSearchCount: $('chat-search-count'),
    chatSearchPrev: $('chat-search-prev'),
    chatSearchNext: $('chat-search-next'),
    chatSearchClose: $('chat-search-close'),

    messagesViewport: $('messages-viewport'),
    messagesList: $('messages-list'),
    typingBubbleRow: $('typing-bubble-row'),
    scrollBottomBtn: $('scroll-bottom-btn'),
    dropOverlay: $('drop-overlay'),

    replyBanner: $('reply-banner'),
    replyBannerSender: $('reply-banner-sender'),
    replyBannerText: $('reply-banner-text'),
    cancelReplyBtn: $('cancel-reply-btn'),
    pendingFilesBar: $('pending-files-bar'),
    uploadProgressWrap: $('upload-progress-wrap'),
    uploadProgressBar: $('upload-progress-bar'),

    fileInput: $('file-input'),
    attachBtn: $('attach-btn'),
    messageInput: $('message-input'),
    emojiBtn: $('emoji-btn'),
    emojiPopover: $('emoji-popover'),
    sendBtn: $('send-btn'),

    infoDrawer: $('info-drawer'),
    closeInfoBtn: $('close-info-btn'),
    infoAvatar: $('info-avatar'),
    infoDisplayName: $('info-displayname'),
    infoStatus: $('info-status'),
    infoUsername: $('info-username'),
    infoEmail: $('info-email'),
    infoBioRow: $('info-bio-row'),
    infoBio: $('info-bio'),
    infoTabMedia: $('info-tab-media'),
    infoTabFiles: $('info-tab-files'),
    infoSharedContent: $('info-shared-content'),

    lightboxModal: $('lightbox-modal'),
    lightboxBackdrop: $('lightbox-backdrop'),
    lightboxImg: $('lightbox-img'),
    lightboxMeta: $('lightbox-meta'),
    lightboxDownload: $('lightbox-download'),
    lightboxClose: $('lightbox-close'),
    lightboxCaption: $('lightbox-caption'),

    profileModal: $('profile-modal'),
    profileModalBackdrop: $('profile-modal-backdrop'),
    profileModalClose: $('profile-modal-close'),
    profileCancelBtn: $('profile-cancel-btn'),
    profileForm: $('profile-form'),
    profileEditAvatar: $('profile-edit-avatar'),
    profileAvatarInput: $('profile-avatar-input'),
    profileDisplayName: $('profile-displayname'),
    profileBio: $('profile-bio'),

    settingsModal: $('settings-modal'),
    settingsModalBackdrop: $('settings-modal-backdrop'),
    settingsModalClose: $('settings-modal-close'),
    settingsModalTitle: $('settings-modal-title'),
    settingsBackBtn: $('settings-back-btn'),
    settingsNav: $('settings-nav'),
    settingsAvatar: $('settings-avatar'),
    settingsDisplayName: $('settings-displayname'),
    settingsUsername: $('settings-username'),
    settingsEmail: $('settings-email'),
    settingsOpenProfile: $('settings-open-profile'),
    settingsGotoThemes: $('settings-goto-themes'),
    themeCardsGrid: $('theme-cards-grid'),
    accentSwatches: $('accent-swatches'),
    prefWallpaper: $('pref-wallpaper'),
    prefCorners: $('pref-corners'),
    prefFontSize: $('pref-fontsize'),
    prefSounds: $('pref-sounds'),
    prefAnimations: $('pref-animations'),
    prefEnterSend: $('pref-enter-send'),
    prefNotifications: $('pref-notifications'),
    notifStatusHint: $('notif-status-hint'),
    testNotifBtn: $('test-notif-btn'),
    settingsResetBtn: $('settings-reset-btn'),

    toastContainer: $('toast-container')
  };

  // =========================================================================
  // Utilities
  // =========================================================================
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function linkifyText(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatSidebarTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return formatTime(iso);
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function formatDateSeparator(iso) {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function formatLastSeen(iso) {
    if (!iso) return 'offline';
    const d = new Date(iso);
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 60) return 'last seen just now';
    if (diffSec < 3600) return `last seen ${Math.floor(diffSec / 60)}m ago`;
    if (d.toDateString() === new Date().toDateString()) {
      return `last seen today at ${formatTime(iso)}`;
    }
    return `last seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  }

  function initialsFor(user) {
    const name = (user && (user.displayName || user.username)) || '?';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  function renderAvatar(el, user) {
    if (!el || !user) return;
    el.style.background = user.avatarColor || 'var(--accent)';
    if (user.avatarUrl) {
      el.innerHTML = `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.displayName || user.username)}" />`;
    } else {
      el.textContent = initialsFor(user);
    }
  }

  function fileExtBadge(filename) {
    const parts = String(filename || '').split('.');
    const ext = parts.length > 1 ? parts.pop().slice(0, 4) : 'FILE';
    return ext.toUpperCase();
  }

  function showToast(message, type = 'info') {
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = message;
    els.toastContainer.appendChild(div);
    setTimeout(() => {
      div.style.opacity = '0';
      div.style.transition = 'opacity 200ms ease';
      setTimeout(() => div.remove(), 220);
    }, 3200);
  }

  async function api(url, options = {}) {
    const opts = { ...options };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // =========================================================================
  // Preferences, Themes & Sound Effects
  // =========================================================================
  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem('telechat_prefs') || 'null');
      const legacyTheme = localStorage.getItem('telechat_theme');
      return {
        ...DEFAULT_PREFS,
        ...(legacyTheme ? { theme: legacyTheme } : {}),
        ...(raw && typeof raw === 'object' ? raw : {})
      };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  function savePrefs() {
    localStorage.setItem('telechat_prefs', JSON.stringify(state.prefs));
    localStorage.setItem('telechat_theme', state.prefs.theme);
  }

  function applyPrefs() {
    const p = state.prefs;
    state.theme = p.theme;
    const root = document.documentElement;
    root.setAttribute('data-theme', p.theme || 'dark');
    root.setAttribute('data-accent', p.accent || 'blue');
    root.setAttribute('data-wallpaper', p.wallpaper ? 'on' : 'off');
    root.setAttribute('data-corners', p.corners || 'classic');
    root.setAttribute('data-fontsize', p.fontSize || 'md');
    root.setAttribute('data-animations', p.animations ? 'on' : 'off');
    const isLight = p.theme === 'light';
    if (els.themeIcon) els.themeIcon.textContent = isLight ? '🌙' : '☀️';
    if (els.menuThemeLabel) els.menuThemeLabel.textContent = isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    syncSettingsUI();
  }

  function toggleDarkLightTheme() {
    if (state.prefs.theme === 'light') {
      const prevDark = state.prefs.lastDarkTheme && state.prefs.lastDarkTheme !== 'light'
        ? state.prefs.lastDarkTheme
        : 'dark';
      state.prefs.theme = prevDark;
    } else {
      state.prefs.lastDarkTheme = state.prefs.theme || 'dark';
      state.prefs.theme = 'light';
    }
    savePrefs();
    applyPrefs();
  }

  function syncSettingsUI() {
    const p = state.prefs;
    if (els.themeCardsGrid) {
      els.themeCardsGrid.querySelectorAll('[data-theme-choice]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.themeChoice === p.theme);
      });
    }
    if (els.accentSwatches) {
      els.accentSwatches.querySelectorAll('[data-accent]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.accent === p.accent);
      });
    }
    if (els.prefWallpaper) els.prefWallpaper.checked = Boolean(p.wallpaper);
    if (els.prefSounds) els.prefSounds.checked = Boolean(p.sounds);
    if (els.prefAnimations) els.prefAnimations.checked = Boolean(p.animations);
    if (els.prefEnterSend) els.prefEnterSend.checked = Boolean(p.enterToSend);
    if (els.prefNotifications) {
      const hasAndroidBridge = Boolean(window.AndroidBridge && typeof window.AndroidBridge.showNotification === 'function');
      const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
      els.prefNotifications.checked = hasAndroidBridge ? Boolean(p.notifications) : (Boolean(p.notifications) && perm === 'granted');
      if (els.notifStatusHint) {
        if (hasAndroidBridge) els.notifStatusHint.textContent = 'Handled by TeleChat Android app';
        else if (perm === 'granted') els.notifStatusHint.textContent = 'Permission granted';
        else if (perm === 'denied') els.notifStatusHint.textContent = 'Blocked in browser site settings';
        else if (perm === 'default') els.notifStatusHint.textContent = 'Toggle on to request permission';
        else els.notifStatusHint.textContent = 'Not supported in this browser';
      }
    }

    if (els.prefCorners) {
      els.prefCorners.querySelectorAll('[data-corner]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.corner === p.corners);
      });
    }
    if (els.prefFontSize) {
      els.prefFontSize.querySelectorAll('[data-size]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.size === p.fontSize);
      });
    }
  }

  let swRegistration = null;
  async function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      navigator.serviceWorker.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'open_chat') {
          openChatByIdOrSender(ev.data.chatId, ev.data.sender);
        }
      });
    } catch {
      // Ignore registration failure (e.g. insecure origin)
    }
  }

  function updateNotificationBanner() {
    if (!els.notifBanner) return;
    const hasAndroidBridge = Boolean(window.AndroidBridge && typeof window.AndroidBridge.showNotification === 'function');
    if (hasAndroidBridge || typeof Notification === 'undefined') {
      els.notifBanner.classList.add('hidden');
      return;
    }
    const dismissed = localStorage.getItem('telechat_notif_dismissed') === '1';
    const shouldShow = Notification.permission === 'default' && !dismissed && Boolean(state.me);
    els.notifBanner.classList.toggle('hidden', !shouldShow);
  }

  async function requestBrowserNotificationPermission() {
    if (typeof Notification === 'undefined') {
      showToast('Browser notifications are not supported here.', 'error');
      return false;
    }
    if (Notification.permission === 'granted') {
      state.prefs.notifications = true;
      savePrefs();
      syncSettingsUI();
      updateNotificationBanner();
      return true;
    }
    if (Notification.permission === 'denied') {
      showToast('Notifications are blocked in browser settings.', 'error');
      syncSettingsUI();
      return false;
    }
    const res = await Notification.requestPermission();
    if (res === 'granted') {
      state.prefs.notifications = true;
      savePrefs();
      showToast('Notifications enabled!', 'success');
    } else {
      state.prefs.notifications = false;
      savePrefs();
    }
    syncSettingsUI();
    updateNotificationBanner();
    return res === 'granted';
  }

  async function openChatByIdOrSender(chatId, senderUsername) {
    if (senderUsername && state.me && senderUsername !== state.me.username) {
      await openChatWithUser(senderUsername);
      return;
    }
    if (chatId && state.me) {
      const chat = state.chats.find((c) => c.id === chatId);
      if (chat && chat.peer) {
        await openChatWithUser(chat.peer.username);
        return;
      }
      const parts = String(chatId).replace(/^dm_/, '').split('__');
      const peer = parts.find((p) => p !== state.me.username);
      if (peer) await openChatWithUser(peer);
    }
  }

  function syncAndroidState(forceForeground) {
    if (!window.AndroidBridge || typeof window.AndroidBridge.setAppState !== 'function') return;
    const isFg = typeof forceForeground === 'boolean' ? forceForeground : !document.hidden;
    try {
      window.AndroidBridge.setAppState(
        state.me ? state.me.username : '',
        state.activeChatId || '',
        Boolean(isFg)
      );
    } catch {
      // Ignore bridge error
    }
  }

  async function notifyIncomingMessage({ chatId, messageId, senderUsername, senderName, senderAvatarUrl, senderAvatarColor, bodyText }) {
    if (!state.prefs.notifications) return;
    const appInBackground = document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus());
    const otherChat = chatId !== state.activeChatId;
    if (!appInBackground && !otherChat) return;

    // 1. Native Android WebView bridge (deduplicated with MessageService by messageId)
    if (window.AndroidBridge && typeof window.AndroidBridge.showNotification === 'function') {
      try {
        window.AndroidBridge.showNotification(
          senderName,
          bodyText,
          chatId || '',
          messageId || '',
          senderAvatarUrl || '',
          senderAvatarColor || ''
        );
        return;
      } catch {
        // Fallback to browser Notification API
      }
    }

    // 2. Browser Notification API (via Service Worker on Android Chrome, or direct Notification on desktop)
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const options = {
      body: bodyText,
      icon: senderAvatarUrl || '/icon-192.png',
      badge: '/icon-192.png',
      tag: `telechat-${chatId}`,
      renotify: true,
      data: { chatId, sender: senderUsername }
    };
    try {
      if (swRegistration && typeof swRegistration.showNotification === 'function') {
        await swRegistration.showNotification(senderName, options);
        return;
      }
      const n = new Notification(senderName, options);
      n.onclick = () => {
        window.focus();
        openChatByIdOrSender(chatId, senderUsername);
        n.close();
      };
    } catch {
      // Ignore notification permission errors
    }
  }

  let audioCtx = null;
  function playChime(kind) {
    if (!state.prefs.sounds) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { });

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      const now = audioCtx.currentTime;
      if (kind === 'send') {
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(760, now + 0.08);
        gain.gain.setValueAtTime(0.035, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      } else {
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.045, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      }
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.17);
    } catch {
      // Ignore Web Audio restrictions
    }
  }

  function openSettingsModal(initialTab = 'general') {
    if (state.me) {
      renderAvatar(els.settingsAvatar, state.me);
      els.settingsDisplayName.textContent = state.me.displayName || state.me.username;
      els.settingsUsername.textContent = `@${state.me.username}`;
      els.settingsEmail.textContent = state.me.email;
    }
    syncSettingsUI();
    switchSettingsTab(initialTab);
    els.settingsModal.classList.remove('hidden');
  }

  function closeSettingsModal() {
    els.settingsModal.classList.add('hidden');
  }

  function switchSettingsTab(tab) {
    const valid = ['general', 'themes', 'chat'].includes(tab) ? tab : 'general';
    els.settingsNav.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.settingsTab === valid);
    });
    ['general', 'themes', 'chat'].forEach((name) => {
      const panel = $(`settings-panel-${name}`);
      if (panel) panel.classList.toggle('hidden', name !== valid);
    });
    const titles = { general: 'Settings', themes: 'Settings — Themes', chat: 'Settings — Sounds & Behavior' };
    els.settingsModalTitle.textContent = titles[valid] || 'Settings';
    els.settingsBackBtn.classList.toggle('hidden', valid === 'general');
  }

  // =========================================================================
  // Auth UI
  // =========================================================================
  function clearVerificationTimers() {
    if (state.verification.timerId) {
      clearInterval(state.verification.timerId);
      state.verification.timerId = null;
    }
  }

  function getOtpDigits() {
    return Array.from(els.otpInputs.querySelectorAll('.otp-digit'));
  }

  function getOtpCode() {
    return getOtpDigits().map((inp) => inp.value.trim()).join('');
  }

  function clearOtpInputs() {
    for (const inp of getOtpDigits()) inp.value = '';
  }

  function formatCountdown(totalSec) {
    const min = Math.floor(totalSec / 60);
    const sec = String(totalSec % 60).padStart(2, '0');
    return `${min}:${sec}`;
  }

  function updateVerificationTimers() {
    const now = Date.now();
    const expSec = Math.max(0, Math.ceil((state.verification.expiresAt - now) / 1000));
    els.verifyCountdown.textContent = expSec > 0
      ? `Code expires in ${formatCountdown(expSec)}`
      : 'Code expired — click "Resend code" to get a new one.';

    const waitSec = Math.max(0, Math.ceil((state.verification.resendAvailableAt - now) / 1000));
    if (waitSec > 0) {
      els.verifyResendBtn.disabled = true;
      els.verifyResendBtn.textContent = `Resend code (${formatCountdown(waitSec)})`;
    } else {
      els.verifyResendBtn.disabled = false;
      els.verifyResendBtn.textContent = 'Resend code';
    }
  }

  function showVerificationStep(data) {
    state.verification.id = data.verificationId;
    state.verification.maskedEmail = data.maskedEmail || 'your email';
    state.verification.expiresAt = data.codeExpiresAt || data.expiresAt || (Date.now() + 5 * 60 * 1000);
    state.verification.resendAvailableAt = data.nextResendAt || (Date.now() + ((data.resendCooldownSeconds || 120) * 1000));

    els.authTabs.classList.add('hidden');
    els.loginForm.classList.add('hidden');
    els.registerForm.classList.add('hidden');
    els.verifyForm.classList.remove('hidden');
    els.verifyError.classList.add('hidden');

    els.verifySubtitle.innerHTML = `We sent a 6-digit verification code to <strong>${escapeHtml(state.verification.maskedEmail)}</strong>.`;

    if (data.deliveryMode === 'dev' && data.devCode) {
      els.verifyDevBanner.innerHTML = `Local Dev Preview (SMTP not configured in <code>.env</code>):<br/>Your verification code is <strong>${escapeHtml(data.devCode)}</strong>`;
      els.verifyDevBanner.classList.remove('hidden');
    } else {
      els.verifyDevBanner.classList.add('hidden');
      els.verifyDevBanner.innerHTML = '';
    }

    clearOtpInputs();
    clearVerificationTimers();
    updateVerificationTimers();
    state.verification.timerId = setInterval(updateVerificationTimers, 1000);
    const first = getOtpDigits()[0];
    if (first) first.focus();
  }

  function switchAuthTab(mode) {
    clearVerificationTimers();
    const isLogin = mode === 'login';
    els.authTabs.classList.remove('hidden');
    els.verifyForm.classList.add('hidden');
    els.tabLogin.classList.toggle('active', isLogin);
    els.tabRegister.classList.toggle('active', !isLogin);
    els.tabLogin.setAttribute('aria-selected', String(isLogin));
    els.tabRegister.setAttribute('aria-selected', String(!isLogin));
    els.loginForm.classList.toggle('hidden', !isLogin);
    els.registerForm.classList.toggle('hidden', isLogin);
    els.loginError.classList.add('hidden');
    els.registerError.classList.add('hidden');
    els.verifyError.classList.add('hidden');
  }

  function showAuthScreen() {
    els.appShell.classList.add('hidden');
    els.authScreen.classList.remove('hidden');
  }

  function showAppShell() {
    els.authScreen.classList.add('hidden');
    els.appShell.classList.remove('hidden');
    updateDrawerUserInfo();
  }

  function updateDrawerUserInfo() {
    if (!state.me) return;
    renderAvatar(els.drawerAvatar, state.me);
    els.drawerDisplayName.textContent = state.me.displayName || state.me.username;
    els.drawerUsername.textContent = `@${state.me.username}`;
    els.drawerEmail.textContent = state.me.email;
  }

  // =========================================================================
  // Drawer
  // =========================================================================
  function openDrawer() {
    els.navDrawerBackdrop.classList.remove('hidden');
    els.navDrawer.classList.add('open');
    els.navDrawer.setAttribute('aria-hidden', 'false');
  }

  function closeDrawer() {
    els.navDrawerBackdrop.classList.add('hidden');
    els.navDrawer.classList.remove('open');
    els.navDrawer.setAttribute('aria-hidden', 'true');
  }

  // =========================================================================
  // Sidebar Rendering (Chats & User Search)
  // =========================================================================
  function renderSidebar() {
    const isSearching = state.searchQuery.trim().length > 0 || state.browseMode;
    els.clearSearchBtn.classList.toggle('hidden', !state.searchQuery.trim() && !state.browseMode);

    if (isSearching) {
      els.sidebarSectionTitle.classList.remove('hidden');
      els.sidebarSectionTitle.textContent = state.searchQuery.trim()
        ? `Search Results (${state.searchResults.length})`
        : `Directory (${state.searchResults.length} users)`;

      if (state.searchResults.length === 0) {
        els.sidebarList.innerHTML = `
          <div class="sidebar-empty">
            No users found matching "<strong>${escapeHtml(state.searchQuery)}</strong>".<br/>
            Try searching by exact email or @username.
          </div>
        `;
        return;
      }

      els.sidebarList.innerHTML = state.searchResults.map((user) => {
        const isOnline = state.onlineUsers.has(user.username) || user.online;
        const isActive = state.activePeer && state.activePeer.username === user.username;
        return `
          <div class="chat-row ${isActive ? 'active' : ''}" data-open-user="${escapeHtml(user.username)}" role="listitem">
            <div class="avatar-wrap">
              <div class="avatar" style="background: ${escapeHtml(user.avatarColor || 'var(--accent)')}">
                ${user.avatarUrl ? `<img src="${escapeHtml(user.avatarUrl)}" alt=""/>` : escapeHtml(initialsFor(user))}
              </div>
              ${isOnline ? '<span class="online-dot"></span>' : ''}
            </div>
            <div class="chat-row-body">
              <div class="chat-row-top">
                <span class="chat-row-name">${escapeHtml(user.displayName || user.username)}</span>
                <span class="chat-row-time">${isOnline ? 'online' : ''}</span>
              </div>
              <div class="chat-row-bottom">
                <span class="chat-row-sub">@${escapeHtml(user.username)} • ${escapeHtml(user.email)}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
      return;
    }

    els.sidebarSectionTitle.classList.add('hidden');
    if (state.chats.length === 0) {
      els.sidebarList.innerHTML = `
        <div class="sidebar-empty">
          No conversations yet.<br/>
          Search for someone by <strong>username</strong> or <strong>email</strong> above to start chatting!
          <div>
            <button id="empty-browse-btn" class="secondary-btn" type="button">Browse Registered Users</button>
          </div>
        </div>
      `;
      const btn = $('empty-browse-btn');
      if (btn) btn.addEventListener('click', triggerBrowseUsers);
      return;
    }

    els.sidebarList.innerHTML = state.chats.map((chat) => {
      const peer = chat.peer;
      const isOnline = state.onlineUsers.has(peer.username) || peer.online;
      const isActive = state.activeChatId === chat.id;
      const isTyping = state.typingPeers.has(chat.id);
      const last = chat.lastMessage;
      let preview = 'Start chatting...';
      if (isTyping) {
        preview = 'typing...';
      } else if (last) {
        const prefix = last.sender === state.me.username ? 'You: ' : '';
        preview = `${prefix}${last.preview || ''}`;
      }
      const timeStr = last ? formatSidebarTime(last.createdAt) : '';
      const unread = chat.unreadCount || 0;

      return `
        <div class="chat-row ${isActive ? 'active' : ''}" data-open-user="${escapeHtml(peer.username)}" role="listitem">
          <div class="avatar-wrap">
            <div class="avatar" style="background: ${escapeHtml(peer.avatarColor || 'var(--accent)')}">
              ${peer.avatarUrl ? `<img src="${escapeHtml(peer.avatarUrl)}" alt=""/>` : escapeHtml(initialsFor(peer))}
            </div>
            ${isOnline ? '<span class="online-dot"></span>' : ''}
          </div>
          <div class="chat-row-body">
            <div class="chat-row-top">
              <span class="chat-row-name">${escapeHtml(peer.displayName || peer.username)}</span>
              <span class="chat-row-time">${escapeHtml(timeStr)}</span>
            </div>
            <div class="chat-row-bottom">
              <span class="chat-row-preview">${escapeHtml(preview)}</span>
              ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  let searchTimer = null;
  async function runUserSearch(query) {
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
      state.searchResults = data.users || [];
      for (const u of state.searchResults) {
        if (u.online) state.onlineUsers.add(u.username);
      }
      renderSidebar();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function triggerBrowseUsers() {
    state.browseMode = true;
    state.searchQuery = '';
    els.sidebarSearch.value = '';
    els.sidebarSearch.focus();
    runUserSearch('');
  }

  async function refreshChats() {
    try {
      const data = await api('/api/chats');
      state.chats = data.chats || [];
      for (const c of state.chats) {
        if (c.peer && c.peer.online) state.onlineUsers.add(c.peer.username);
      }
      renderSidebar();
    } catch {
      // Ignore transient errors
    }
  }

  // =========================================================================
  // Active Chat & Messages
  // =========================================================================
  function updateChatHeaderStatus() {
    if (!state.activePeer || !state.activeChatId) return;
    const isTyping = state.typingPeers.has(state.activeChatId);
    const isOnline = state.onlineUsers.has(state.activePeer.username) || state.activePeer.online;

    els.chatPeerDot.classList.toggle('hidden', !isOnline);
    els.chatPeerStatus.className = 'chat-peer-status';

    if (els.typingBubbleRow) {
      const wasHidden = els.typingBubbleRow.classList.contains('hidden');
      els.typingBubbleRow.classList.toggle('hidden', !isTyping);
      if (isTyping && wasHidden && isNearBottom()) {
        requestAnimationFrame(() => {
          els.messagesViewport.scrollTop = els.messagesViewport.scrollHeight;
        });
      }
    }

    if (isTyping) {
      els.chatPeerStatus.textContent = 'typing...';
      els.chatPeerStatus.classList.add('typing');
    } else if (isOnline) {
      els.chatPeerStatus.textContent = `online • @${state.activePeer.username}`;
      els.chatPeerStatus.classList.add('online');
    } else {
      els.chatPeerStatus.textContent = `${formatLastSeen(state.activePeer.lastSeen)} • @${state.activePeer.username}`;
    }

    if (state.infoOpen) {
      els.infoStatus.textContent = isOnline ? 'online' : formatLastSeen(state.activePeer.lastSeen);
    }
  }

  async function openChatWithUser(targetUsername) {
    try {
      const data = await api('/api/chats/open', {
        method: 'POST',
        body: { targetUsername }
      });

      state.activeChatId = data.chat.id;
      state.activePeer = data.chat.peer;
      state.messages = data.messages || [];
      state.replyTo = null;
      els.replyBanner.classList.add('hidden');
      state.chatSearch = { open: false, query: '', matches: [], index: -1 };
      els.chatSearchBar.classList.add('hidden');
      els.chatSearchInput.value = '';
      els.chatSearchCount.textContent = '0 / 0';

      if (state.activePeer.online) state.onlineUsers.add(state.activePeer.username);

      els.chatEmptyState.classList.add('hidden');
      els.activeChat.classList.remove('hidden');
      els.appShell.classList.add('mobile-chat-open');

      renderAvatar(els.chatPeerAvatar, state.activePeer);
      els.chatPeerName.textContent = state.activePeer.displayName || state.activePeer.username;
      updateChatHeaderStatus();

      renderMessages(true);
      if (state.infoOpen) renderInfoDrawer();
      renderSidebar();

      // Clear search after picking a user? Keep chats visible if they clicked from browse/search
      if (state.browseMode || state.searchQuery) {
        state.browseMode = false;
        state.searchQuery = '';
        els.sidebarSearch.value = '';
        renderSidebar();
      }

      await markActiveChatRead();
      syncAndroidState();
      const isMobileOrTouch = typeof window.matchMedia === 'function' &&
        window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
      if (isMobileOrTouch) {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
      } else {
        els.messageInput.focus();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function markActiveChatRead() {
    if (!state.activeChatId) return;
    const chatId = state.activeChatId;
    const chatObj = state.chats.find((c) => c.id === chatId);
    if (chatObj && chatObj.unreadCount > 0) {
      chatObj.unreadCount = 0;
      renderSidebar();
    }
    try {
      await api(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: 'POST' });
    } catch {
      // Ignore
    }
  }

  function renderAttachmentsHtml(msg) {
    if (!Array.isArray(msg.attachments) || msg.attachments.length === 0) return '';
    const items = msg.attachments.map((att) => {
      if (att.isImage) {
        return `
          <div class="msg-image-wrap" data-lightbox-url="${escapeHtml(att.url)}" data-lightbox-name="${escapeHtml(att.originalName)}" data-lightbox-sender="${escapeHtml(msg.sender)}" data-lightbox-caption="${escapeHtml(msg.text || '')}">
            <img src="${escapeHtml(att.url)}" alt="${escapeHtml(att.originalName)}" loading="lazy" />
          </div>
        `;
      }
      if (att.mimeType && att.mimeType.startsWith('video/')) {
        return `<video class="msg-media-player" controls preload="metadata" src="${escapeHtml(att.url)}"></video>`;
      }
      if (att.mimeType && att.mimeType.startsWith('audio/')) {
        return `<audio class="msg-media-player" controls preload="metadata" src="${escapeHtml(att.url)}"></audio>`;
      }
      return `
        <a class="msg-file-card" href="${escapeHtml(att.url)}?download=1" download="${escapeHtml(att.originalName)}">
          <div class="file-badge">${escapeHtml(fileExtBadge(att.originalName))}</div>
          <div class="file-card-info">
            <div class="file-card-name">${escapeHtml(att.originalName)}</div>
            <div class="file-card-size">${escapeHtml(formatBytes(att.size))}</div>
          </div>
          <span class="file-download-icon">⬇</span>
        </a>
      `;
    }).join('');
    return `<div class="msg-attachments">${items}</div>`;
  }

  function renderReactionsHtml(msg) {
    const reactions = msg.reactions || {};
    const entries = Object.entries(reactions).filter(([, users]) => Array.isArray(users) && users.length > 0);
    if (entries.length === 0) return '';
    return `
      <div class="msg-reactions">
        ${entries.map(([emoji, users]) => {
      const mine = users.includes(state.me.username);
      return `<button type="button" class="reaction-chip ${mine ? 'mine' : ''}" data-react-msg="${escapeHtml(msg.id)}" data-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)} <span>${users.length}</span></button>`;
    }).join('')}
      </div>
    `;
  }

  function renderMessages(scrollToBottom = false) {
    const msgs = state.messages;
    if (msgs.length === 0) {
      els.messagesList.innerHTML = `
        <div class="date-separator">No messages yet — say hi to ${escapeHtml(state.activePeer.displayName || state.activePeer.username)}! 👋</div>
      `;
      return;
    }

    let lastDateStr = '';
    const htmlParts = [];

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const prev = msgs[i - 1];
      const next = msgs[i + 1];

      const dateStr = new Date(msg.createdAt).toDateString();
      if (dateStr !== lastDateStr) {
        lastDateStr = dateStr;
        htmlParts.push(`<div class="date-separator">${escapeHtml(formatDateSeparator(msg.createdAt))}</div>`);
      }

      const isMine = msg.sender === state.me.username;
      const samePrev = prev && prev.sender === msg.sender && new Date(prev.createdAt).toDateString() === dateStr;
      const sameNext = next && next.sender === msg.sender && new Date(next.createdAt).toDateString() === dateStr;

      const groupClasses = [
        isMine ? 'outgoing' : 'incoming',
        !samePrev ? 'group-start' : '',
        !sameNext ? 'group-end' : ''
      ].filter(Boolean).join(' ');

      const replyHtml = msg.replyTo ? `
        <div class="msg-reply-quote" data-scroll-msg="${escapeHtml(msg.replyTo.id)}">
          <div class="msg-reply-sender">${escapeHtml(msg.replyTo.sender)}</div>
          <div class="msg-reply-text">${escapeHtml(msg.replyTo.text || '')}</div>
        </div>
      ` : '';

      const readByPeer = Array.isArray(msg.readBy) && state.activePeer && msg.readBy.includes(state.activePeer.username);
      const ticksHtml = isMine
        ? `<span class="read-ticks ${readByPeer ? 'read' : ''}" title="${readByPeer ? 'Read' : 'Sent'}">${readByPeer ? '✓✓' : '✓'}</span>`
        : '';

      const actionsHtml = `
        <div class="msg-actions">
          <button class="msg-action-btn" type="button" data-reply-msg="${escapeHtml(msg.id)}" title="Reply">↩</button>
          ${msg.text ? `<button class="msg-action-btn" type="button" data-copy-msg="${escapeHtml(msg.id)}" title="Copy">📋</button>` : ''}
          ${QUICK_REACTIONS.map((e) => `<button class="msg-action-btn" type="button" data-react-msg="${escapeHtml(msg.id)}" data-emoji="${e}" title="React ${e}">${e}</button>`).join('')}
          ${isMine ? `<button class="msg-action-btn" type="button" data-delete-msg="${escapeHtml(msg.id)}" title="Delete">🗑</button>` : ''}
        </div>
      `;

      const bubbleHtml = `
        <div class="msg-bubble">
          ${replyHtml}
          ${renderAttachmentsHtml(msg)}
          ${msg.text ? `<div class="msg-text">${linkifyText(msg.text)}</div>` : ''}
          ${renderReactionsHtml(msg)}
          <div class="msg-footer">
            <span>${escapeHtml(formatTime(msg.createdAt))}</span>
            ${ticksHtml}
          </div>
        </div>
      `;

      htmlParts.push(`
        <div class="msg-row ${groupClasses}" id="msg-${escapeHtml(msg.id)}">
          ${isMine ? actionsHtml + bubbleHtml : bubbleHtml + actionsHtml}
        </div>
      `);
    }

    els.messagesList.innerHTML = htmlParts.join('');

    if (scrollToBottom) {
      requestAnimationFrame(() => {
        els.messagesViewport.scrollTop = els.messagesViewport.scrollHeight;
      });
    }
  }

  function isNearBottom() {
    const vp = els.messagesViewport;
    return vp.scrollHeight - vp.scrollTop - vp.clientHeight < 140;
  }

  // =========================================================================
  // Pending Attachments & Sending Messages
  // =========================================================================
  function addPendingFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    for (const file of incoming) {
      if (state.pendingFiles.length >= 10) {
        showToast('Maximum 10 files per message.', 'error');
        break;
      }
      if (file.size > 25 * 1024 * 1024) {
        showToast(`"${file.name}" exceeds 25 MB limit.`, 'error');
        continue;
      }
      const previewUrl = file.type.startsWith('image/') && file.type !== 'image/svg+xml'
        ? URL.createObjectURL(file)
        : null;
      state.pendingFiles.push({ file, previewUrl });
    }
    renderPendingFiles();
  }

  function removePendingFile(index) {
    const item = state.pendingFiles[index];
    if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    state.pendingFiles.splice(index, 1);
    renderPendingFiles();
  }

  function clearPendingFiles() {
    for (const item of state.pendingFiles) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    state.pendingFiles = [];
    renderPendingFiles();
  }

  function renderPendingFiles() {
    if (state.pendingFiles.length === 0) {
      els.pendingFilesBar.classList.add('hidden');
      els.pendingFilesBar.innerHTML = '';
      return;
    }
    els.pendingFilesBar.classList.remove('hidden');
    els.pendingFilesBar.innerHTML = state.pendingFiles.map((item, idx) => `
      <div class="pending-chip">
        ${item.previewUrl
        ? `<img class="pending-thumb" src="${item.previewUrl}" alt="" />`
        : `<div class="pending-file-icon">${escapeHtml(fileExtBadge(item.file.name))}</div>`}
        <div class="pending-meta">
          <div class="pending-name">${escapeHtml(item.file.name)}</div>
          <div class="pending-size">${escapeHtml(formatBytes(item.file.size))}</div>
        </div>
        <button class="icon-btn-sm" type="button" data-remove-file="${idx}" aria-label="Remove file">✕</button>
      </div>
    `).join('');
  }

  function sendWithProgress(url, formData) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          els.uploadProgressWrap.classList.remove('hidden');
          els.uploadProgressBar.style.width = `${pct}%`;
        }
      };
      xhr.onload = () => {
        els.uploadProgressWrap.classList.add('hidden');
        els.uploadProgressBar.style.width = '0%';
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error('Invalid server response'));
        }
      };
      xhr.onerror = () => {
        els.uploadProgressWrap.classList.add('hidden');
        els.uploadProgressBar.style.width = '0%';
        reject(new Error('Network error while uploading'));
      };
      xhr.send(formData);
    });
  }

  async function sendMessage() {
    if (!state.activeChatId || state.sending) return;
    const text = els.messageInput.value.trim();
    const hasFiles = state.pendingFiles.length > 0;
    if (!text && !hasFiles) return;

    state.sending = true;
    const chatId = state.activeChatId;
    const replyToId = state.replyTo ? state.replyTo.id : null;

    try {
      sendTypingSignal(false);
      let data;
      if (hasFiles) {
        const fd = new FormData();
        fd.append('text', text);
        if (replyToId) fd.append('replyToId', replyToId);
        for (const item of state.pendingFiles) {
          fd.append('files', item.file, item.file.name);
        }
        data = await sendWithProgress(`/api/chats/${encodeURIComponent(chatId)}/messages`, fd);
      } else {
        data = await api(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
          method: 'POST',
          body: { text, replyToId }
        });
      }

      els.messageInput.value = '';
      autoResizeInput();
      clearPendingFiles();
      clearReply();

      // Add message optimistically if SSE hasn't delivered it yet
      if (data.message && !state.messages.some((m) => m.id === data.message.id)) {
        state.messages.push(data.message);
        renderMessages(true);
        if (state.infoOpen) renderInfoDrawer();
      }
      playChime('send');
      await refreshChats();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      state.sending = false;
    }
  }

  function autoResizeInput() {
    const el = els.messageInput;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function setReply(msgId) {
    const msg = state.messages.find((m) => m.id === msgId);
    if (!msg) return;
    state.replyTo = msg;
    els.replyBannerSender.textContent = msg.sender;
    els.replyBannerText.textContent = msg.text || (msg.attachments && msg.attachments[0] ? msg.attachments[0].originalName : '');
    els.replyBanner.classList.remove('hidden');
    els.messageInput.focus();
  }

  function clearReply() {
    state.replyTo = null;
    els.replyBanner.classList.add('hidden');
  }

  let lastTypingSentAt = 0;
  let typingStopTimer = null;
  function sendTypingSignal(isTyping) {
    if (!state.activeChatId) return;
    const now = Date.now();
    if (isTyping && now - lastTypingSentAt < 2200) {
      clearTimeout(typingStopTimer);
      typingStopTimer = setTimeout(() => sendTypingSignal(false), 2600);
      return;
    }
    if (isTyping) {
      lastTypingSentAt = now;
      clearTimeout(typingStopTimer);
      typingStopTimer = setTimeout(() => sendTypingSignal(false), 2600);
    } else {
      lastTypingSentAt = 0;
      clearTimeout(typingStopTimer);
    }
    fetch(`/api/chats/${encodeURIComponent(state.activeChatId)}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTyping })
    }).catch(() => { });
  }

  // =========================================================================
  // Info Drawer (Profile & Shared Media / Files)
  // =========================================================================
  function renderInfoDrawer() {
    if (!state.activePeer) return;
    const p = state.activePeer;
    renderAvatar(els.infoAvatar, p);
    els.infoDisplayName.textContent = p.displayName || p.username;
    els.infoUsername.textContent = `@${p.username}`;
    els.infoEmail.textContent = p.email;
    const isOnline = state.onlineUsers.has(p.username) || p.online;
    els.infoStatus.textContent = isOnline ? 'online' : formatLastSeen(p.lastSeen);
    if (p.bio) {
      els.infoBioRow.classList.remove('hidden');
      els.infoBio.textContent = p.bio;
    } else {
      els.infoBioRow.classList.add('hidden');
    }

    const allAttachments = [];
    for (const m of state.messages) {
      if (Array.isArray(m.attachments)) {
        for (const a of m.attachments) {
          allAttachments.push({ ...a, sender: m.sender, createdAt: m.createdAt });
        }
      }
    }

    if (state.infoTab === 'media') {
      const images = allAttachments.filter((a) => a.isImage).reverse();
      if (images.length === 0) {
        els.infoSharedContent.innerHTML = `<div class="shared-empty">No shared images yet</div>`;
        return;
      }
      els.infoSharedContent.innerHTML = `
        <div class="shared-media-grid">
          ${images.map((img) => `
            <div class="shared-media-tile" data-lightbox-url="${escapeHtml(img.url)}" data-lightbox-name="${escapeHtml(img.originalName)}" data-lightbox-sender="${escapeHtml(img.sender)}">
              <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.originalName)}" loading="lazy" />
            </div>
          `).join('')}
        </div>
      `;
    } else {
      const files = allAttachments.filter((a) => !a.isImage).reverse();
      if (files.length === 0) {
        els.infoSharedContent.innerHTML = `<div class="shared-empty">No shared files yet</div>`;
        return;
      }
      els.infoSharedContent.innerHTML = `
        <div class="shared-files-list">
          ${files.map((f) => `
            <a class="msg-file-card" href="${escapeHtml(f.url)}?download=1" download="${escapeHtml(f.originalName)}">
              <div class="file-badge">${escapeHtml(fileExtBadge(f.originalName))}</div>
              <div class="file-card-info">
                <div class="file-card-name">${escapeHtml(f.originalName)}</div>
                <div class="file-card-size">${escapeHtml(formatBytes(f.size))}</div>
              </div>
              <span class="file-download-icon">⬇</span>
            </a>
          `).join('')}
        </div>
      `;
    }
  }

  function toggleInfoDrawer(forceState) {
    state.infoOpen = typeof forceState === 'boolean' ? forceState : !state.infoOpen;
    els.infoDrawer.classList.toggle('hidden', !state.infoOpen);
    if (state.infoOpen) renderInfoDrawer();
  }

  // =========================================================================
  // Lightbox & Edit Profile Modals
  // =========================================================================
  function openLightbox(url, name, sender, caption = '') {
    els.lightboxImg.src = url;
    els.lightboxMeta.textContent = `${name || 'Image'}${sender ? ` • from @${sender}` : ''}`;
    els.lightboxDownload.href = `${url}?download=1`;
    els.lightboxDownload.download = name || 'image';
    if (caption) {
      els.lightboxCaption.textContent = caption;
      els.lightboxCaption.classList.remove('hidden');
    } else {
      els.lightboxCaption.classList.add('hidden');
    }
    els.lightboxModal.classList.remove('hidden');
  }

  function closeLightbox() {
    els.lightboxModal.classList.add('hidden');
    els.lightboxImg.src = '';
  }

  function openProfileModal() {
    if (!state.me) return;
    renderAvatar(els.profileEditAvatar, state.me);
    els.profileDisplayName.value = state.me.displayName || state.me.username;
    els.profileBio.value = state.me.bio || '';
    els.profileModal.classList.remove('hidden');
  }

  function closeProfileModal() {
    els.profileModal.classList.add('hidden');
  }

  // =========================================================================
  // Real-Time SSE Connection
  // =========================================================================
  function connectRealtime() {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }

    const es = new EventSource('/api/events');
    state.eventSource = es;

    es.addEventListener('connected', (ev) => {
      const data = JSON.parse(ev.data);
      state.onlineUsers = new Set(data.onlineUsers || []);
      renderSidebar();
      updateChatHeaderStatus();
    });

    es.addEventListener('presence', (ev) => {
      const data = JSON.parse(ev.data);
      if (data.online) state.onlineUsers.add(data.username);
      else state.onlineUsers.delete(data.username);

      for (const c of state.chats) {
        if (c.peer && c.peer.username === data.username) {
          c.peer.online = data.online;
          c.peer.lastSeen = data.lastSeen;
        }
      }
      if (state.activePeer && state.activePeer.username === data.username) {
        state.activePeer.online = data.online;
        state.activePeer.lastSeen = data.lastSeen;
        updateChatHeaderStatus();
      }
      renderSidebar();
    });

    es.addEventListener('typing', (ev) => {
      const data = JSON.parse(ev.data);
      if (state.typingPeers.has(data.chatId)) {
        clearTimeout(state.typingPeers.get(data.chatId));
        state.typingPeers.delete(data.chatId);
      }
      if (data.isTyping) {
        const timer = setTimeout(() => {
          state.typingPeers.delete(data.chatId);
          updateChatHeaderStatus();
          renderSidebar();
        }, 3500);
        state.typingPeers.set(data.chatId, timer);
      }
      updateChatHeaderStatus();
      renderSidebar();
    });

    es.addEventListener('new_message', async (ev) => {
      const data = JSON.parse(ev.data);
      const isIncoming = data.message.sender !== state.me.username;
      const senderName = (data.senderProfile && data.senderProfile.displayName) || data.message.sender;
      const senderAvatarUrl = (data.senderProfile && data.senderProfile.avatarUrl) || '';
      const senderAvatarColor = (data.senderProfile && data.senderProfile.avatarColor) || '';
      const bodyPreview = data.message.text
        ? data.message.text.slice(0, 120)
        : (data.message.attachments && data.message.attachments[0]
          ? (data.message.attachments[0].isImage ? '📷 Sent a photo' : `📎 ${data.message.attachments[0].originalName}`)
          : 'New message');

      if (data.chatId === state.activeChatId) {
        const wasNearBottom = isNearBottom();
        if (!state.messages.some((m) => m.id === data.message.id)) {
          state.messages.push(data.message);
          renderMessages(wasNearBottom);
          if (state.infoOpen) renderInfoDrawer();
        }
        if (isIncoming) {
          playChime('receive');
          notifyIncomingMessage({
            chatId: data.chatId,
            messageId: data.message.id,
            senderUsername: data.message.sender,
            senderName,
            senderAvatarUrl,
            senderAvatarColor,
            bodyText: bodyPreview
          });
          await markActiveChatRead();
        }
      } else if (isIncoming) {
        playChime('receive');
        showToast(`${senderName}: ${bodyPreview.slice(0, 60)}`);
        notifyIncomingMessage({
          chatId: data.chatId,
          messageId: data.message.id,
          senderUsername: data.message.sender,
          senderName,
          senderAvatarUrl,
          senderAvatarColor,
          bodyText: bodyPreview
        });
      }

      if (state.typingPeers.has(data.chatId)) {
        clearTimeout(state.typingPeers.get(data.chatId));
        state.typingPeers.delete(data.chatId);
        updateChatHeaderStatus();
      }
      await refreshChats();
    });

    es.addEventListener('read_receipt', (ev) => {
      const data = JSON.parse(ev.data);
      if (data.chatId !== state.activeChatId) return;
      const idSet = new Set(data.messageIds || []);
      let changed = false;
      for (const m of state.messages) {
        if (idSet.has(m.id)) {
          if (!Array.isArray(m.readBy)) m.readBy = [];
          if (!m.readBy.includes(data.reader)) {
            m.readBy.push(data.reader);
            changed = true;
          }
        }
      }
      if (changed) renderMessages(false);
    });

    es.addEventListener('message_updated', (ev) => {
      const data = JSON.parse(ev.data);
      if (data.chatId !== state.activeChatId) return;
      const idx = state.messages.findIndex((m) => m.id === data.message.id);
      if (idx >= 0) {
        state.messages[idx] = data.message;
        renderMessages(false);
      }
    });

    es.addEventListener('message_deleted', async (ev) => {
      const data = JSON.parse(ev.data);
      if (data.chatId === state.activeChatId) {
        state.messages = state.messages.filter((m) => m.id !== data.messageId);
        renderMessages(false);
        if (state.infoOpen) renderInfoDrawer();
      }
      await refreshChats();
    });

    es.addEventListener('profile_updated', (ev) => {
      const data = JSON.parse(ev.data);
      const updated = data.user;
      if (!updated) return;
      if (state.me && updated.username === state.me.username) {
        state.me = updated;
        updateDrawerUserInfo();
      }
      if (state.activePeer && updated.username === state.activePeer.username) {
        state.activePeer = { ...state.activePeer, ...updated };
        renderAvatar(els.chatPeerAvatar, state.activePeer);
        els.chatPeerName.textContent = state.activePeer.displayName || state.activePeer.username;
        if (state.infoOpen) renderInfoDrawer();
      }
      refreshChats();
    });
  }

  // =========================================================================
  // Boot & Event Listeners
  // =========================================================================
  function initEmojiPopover() {
    els.emojiPopover.innerHTML = EMOJI_LIST.map(
      (em) => `<button type="button" class="emoji-item" data-insert-emoji="${em}">${em}</button>`
    ).join('');
  }

  function wireEvents() {
    // Auth tabs
    els.tabLogin.addEventListener('click', () => switchAuthTab('login'));
    els.tabRegister.addEventListener('click', () => switchAuthTab('register'));

    // Password visibility toggle
    document.querySelectorAll('.toggle-pass-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = $(btn.dataset.target);
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // Live email hint on registration
    els.regEmail.addEventListener('input', () => {
      const val = els.regEmail.value.trim().toLowerCase();
      if (!val || !val.includes('@')) {
        els.regEmailHint.className = 'field-hint';
        els.regEmailHint.textContent = 'Use Gmail, Outlook, Yahoo, iCloud, Proton, etc. Temp mails are blocked.';
        return;
      }
      const domain = val.split('@')[1] || '';
      if (TEMP_HINT_DOMAINS.includes(domain) || /temp|trash|throwaway|mailinator|yopmail|guerrilla/.test(domain)) {
        els.regEmailHint.className = 'field-hint error';
        els.regEmailHint.textContent = 'Temporary/disposable email domains are not allowed.';
      } else {
        els.regEmailHint.className = 'field-hint';
        els.regEmailHint.textContent = 'Valid email platform will be verified on signup.';
      }
    });

    // Login submit
    els.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      els.loginError.classList.add('hidden');
      els.loginSubmit.disabled = true;
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: {
            identifier: els.loginIdentifier.value.trim(),
            password: els.loginPassword.value
          }
        });
        await onAuthenticated(data.user);
      } catch (err) {
        els.loginError.textContent = err.message;
        els.loginError.classList.remove('hidden');
      } finally {
        els.loginSubmit.disabled = false;
      }
    });

    // Register submit (Step 1 -> send verification email)
    els.registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      els.registerError.classList.add('hidden');
      els.registerSubmit.disabled = true;
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: {
            username: els.regUsername.value.trim(),
            displayName: els.regDisplayName.value.trim(),
            email: els.regEmail.value.trim(),
            password: els.regPassword.value
          }
        });
        if (data.verificationRequired) {
          showVerificationStep(data);
          showToast(`Verification code sent to ${data.maskedEmail}`, 'success');
        } else if (data.user) {
          await onAuthenticated(data.user);
        }
      } catch (err) {
        els.registerError.textContent = err.message;
        els.registerError.classList.remove('hidden');
      } finally {
        els.registerSubmit.disabled = false;
      }
    });

    // OTP 6-digit box navigation & paste support
    const otpDigits = getOtpDigits();
    otpDigits.forEach((input, idx) => {
      input.addEventListener('input', () => {
        const cleaned = input.value.replace(/\D/g, '');
        if (cleaned.length > 1) {
          cleaned.slice(0, 6).split('').forEach((ch, offset) => {
            if (otpDigits[idx + offset]) otpDigits[idx + offset].value = ch;
          });
          const nextFocus = otpDigits[Math.min(idx + cleaned.length, 5)];
          if (nextFocus) nextFocus.focus();
          return;
        }
        input.value = cleaned;
        if (cleaned && otpDigits[idx + 1]) {
          otpDigits[idx + 1].focus();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && otpDigits[idx - 1]) {
          otpDigits[idx - 1].focus();
        }
      });

      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
        const digits = text.replace(/\D/g, '').slice(0, 6);
        if (!digits) return;
        otpDigits.forEach((box, i) => {
          box.value = digits[i] || '';
        });
        const focusTarget = otpDigits[Math.min(digits.length, 5)];
        if (focusTarget) focusTarget.focus();
      });
    });

    // Verify email submit (Step 2)
    els.verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      els.verifyError.classList.add('hidden');
      const code = getOtpCode();
      if (!/^\d{6}$/.test(code)) {
        els.verifyError.textContent = 'Please enter all 6 digits of your verification code.';
        els.verifyError.classList.remove('hidden');
        return;
      }
      els.verifySubmit.disabled = true;
      try {
        const data = await api('/api/auth/verify-email', {
          method: 'POST',
          body: {
            verificationId: state.verification.id,
            code
          }
        });
        clearVerificationTimers();
        await onAuthenticated(data.user);
        showToast(`Email verified! Welcome to TeleChat, @${data.user.username}!`, 'success');
      } catch (err) {
        els.verifyError.textContent = err.message;
        els.verifyError.classList.remove('hidden');
      } finally {
        els.verifySubmit.disabled = false;
      }
    });

    // Resend verification code
    els.verifyResendBtn.addEventListener('click', async () => {
      if (!state.verification.id) return;
      els.verifyError.classList.add('hidden');
      els.verifyResendBtn.disabled = true;
      try {
        const data = await api('/api/auth/resend-verification', {
          method: 'POST',
          body: { verificationId: state.verification.id }
        });
        showVerificationStep(data);
        showToast(`New code sent to ${data.maskedEmail}`, 'success');
      } catch (err) {
        els.verifyError.textContent = err.message;
        els.verifyError.classList.remove('hidden');
        updateVerificationTimers();
      }
    });

    // Back to register form
    els.verifyBackBtn.addEventListener('click', () => {
      switchAuthTab('register');
    });

    // Drawer & Settings
    els.hamburgerBtn.addEventListener('click', openDrawer);
    els.navDrawerBackdrop.addEventListener('click', closeDrawer);
    els.drawerThemeBtn.addEventListener('click', toggleDarkLightTheme);
    els.menuToggleTheme.addEventListener('click', toggleDarkLightTheme);
    els.drawerSettingsBtn.addEventListener('click', () => {
      closeDrawer();
      openSettingsModal('general');
    });
    els.menuSettings.addEventListener('click', () => {
      closeDrawer();
      openSettingsModal('general');
    });
    els.menuFindUsers.addEventListener('click', () => {
      closeDrawer();
      triggerBrowseUsers();
    });
    els.menuEditProfile.addEventListener('click', () => {
      closeDrawer();
      openProfileModal();
    });
    els.menuLogout.addEventListener('click', async () => {
      closeDrawer();
      await api('/api/auth/logout', { method: 'POST' }).catch(() => { });
      if (state.eventSource) state.eventSource.close();
      state.me = null;
      state.chats = [];
      state.activeChatId = null;
      state.activePeer = null;
      state.messages = [];
      els.activeChat.classList.add('hidden');
      els.chatEmptyState.classList.remove('hidden');
      showAuthScreen();
    });

    // Settings Modal
    els.settingsModalClose.addEventListener('click', closeSettingsModal);
    els.settingsModalBackdrop.addEventListener('click', closeSettingsModal);
    els.settingsBackBtn.addEventListener('click', () => switchSettingsTab('general'));
    els.settingsNav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-settings-tab]');
      if (btn) switchSettingsTab(btn.dataset.settingsTab);
    });
    els.settingsOpenProfile.addEventListener('click', () => {
      closeSettingsModal();
      openProfileModal();
    });
    els.settingsGotoThemes.addEventListener('click', () => switchSettingsTab('themes'));

    els.themeCardsGrid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-theme-choice]');
      if (!card) return;
      state.prefs.theme = card.dataset.themeChoice;
      savePrefs();
      applyPrefs();
    });

    els.accentSwatches.addEventListener('click', (e) => {
      const dot = e.target.closest('[data-accent]');
      if (!dot) return;
      state.prefs.accent = dot.dataset.accent;
      savePrefs();
      applyPrefs();
    });

    els.prefWallpaper.addEventListener('change', () => {
      state.prefs.wallpaper = els.prefWallpaper.checked;
      savePrefs();
      applyPrefs();
    });

    els.prefCorners.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-corner]');
      if (!btn) return;
      state.prefs.corners = btn.dataset.corner;
      savePrefs();
      applyPrefs();
    });

    els.prefFontSize.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-size]');
      if (!btn) return;
      state.prefs.fontSize = btn.dataset.size;
      savePrefs();
      applyPrefs();
    });

    els.prefSounds.addEventListener('change', () => {
      state.prefs.sounds = els.prefSounds.checked;
      savePrefs();
      if (state.prefs.sounds) playChime('receive');
    });

    els.prefAnimations.addEventListener('change', () => {
      state.prefs.animations = els.prefAnimations.checked;
      savePrefs();
      applyPrefs();
    });

    els.prefEnterSend.addEventListener('change', () => {
      state.prefs.enterToSend = els.prefEnterSend.checked;
      savePrefs();
    });

    els.prefNotifications.addEventListener('change', async () => {
      const hasAndroidBridge = Boolean(window.AndroidBridge && typeof window.AndroidBridge.showNotification === 'function');
      if (els.prefNotifications.checked) {
        if (hasAndroidBridge) {
          state.prefs.notifications = true;
          savePrefs();
        } else {
          const granted = await requestBrowserNotificationPermission();
          if (!granted) els.prefNotifications.checked = false;
        }
      } else {
        state.prefs.notifications = false;
        savePrefs();
      }
      syncSettingsUI();
    });

    els.notifAllowBtn.addEventListener('click', () => requestBrowserNotificationPermission());
    els.notifDismissBtn.addEventListener('click', () => {
      localStorage.setItem('telechat_notif_dismissed', '1');
      updateNotificationBanner();
    });
    els.testNotifBtn.addEventListener('click', async () => {
      const hasAndroidBridge = Boolean(window.AndroidBridge && typeof window.AndroidBridge.showNotification === 'function');
      if (hasAndroidBridge) {
        window.AndroidBridge.showNotification(
          state.me ? (state.me.displayName || state.me.username) : 'TeleChat Test',
          'Android notifications with profile photo are working!',
          state.activeChatId || '',
          `test_${Date.now()}`,
          state.me ? (state.me.avatarUrl || '') : '',
          state.me ? (state.me.avatarColor || '') : ''
        );
        showToast('Sent Android test notification!', 'success');
        return;
      }
      const ok = await requestBrowserNotificationPermission();
      if (!ok) return;
      try {
        const opts = { body: 'Browser notifications are working!', icon: '/icon-192.png', tag: 'telechat-test' };
        if (swRegistration && typeof swRegistration.showNotification === 'function') {
          await swRegistration.showNotification('TeleChat Test', opts);
        } else {
          new Notification('TeleChat Test', opts);
        }
        showToast('Sent browser test notification!', 'success');
      } catch (err) {
        showToast(err.message || 'Could not display notification.', 'error');
      }
    });

    els.settingsResetBtn.addEventListener('click', () => {
      state.prefs = { ...DEFAULT_PREFS };
      savePrefs();
      applyPrefs();
      showToast('Appearance reset to defaults', 'success');
    });

    // Search & Browse
    els.sidebarSearch.addEventListener('input', () => {
      const q = els.sidebarSearch.value;
      state.searchQuery = q;
      if (!q.trim()) {
        state.browseMode = false;
        renderSidebar();
        return;
      }
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runUserSearch(q.trim()), 180);
    });

    els.clearSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.browseMode = false;
      els.sidebarSearch.value = '';
      renderSidebar();
    });

    els.browseUsersBtn.addEventListener('click', () => {
      if (state.browseMode) {
        state.browseMode = false;
        renderSidebar();
      } else {
        triggerBrowseUsers();
      }
    });

    // Sidebar click delegation
    els.sidebarList.addEventListener('click', (e) => {
      const row = e.target.closest('[data-open-user]');
      if (!row) return;
      openChatWithUser(row.dataset.openUser);
    });

    // Mobile back button
    els.mobileBackBtn.addEventListener('click', () => {
      els.appShell.classList.remove('mobile-chat-open');
      state.activeChatId = null;
      syncAndroidState();
      renderSidebar();
    });

    // In-Chat Search
    function clearChatSearchHighlights() {
      els.messagesList.querySelectorAll('.msg-row.search-match').forEach((el) => el.classList.remove('search-match'));
    }

    function jumpToChatSearchMatch(index) {
      const matches = state.chatSearch.matches;
      if (matches.length === 0) {
        els.chatSearchCount.textContent = '0 / 0';
        return;
      }
      state.chatSearch.index = ((index % matches.length) + matches.length) % matches.length;
      const msgId = matches[state.chatSearch.index];
      els.chatSearchCount.textContent = `${state.chatSearch.index + 1} / ${matches.length}`;
      const el = $(`msg-${msgId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('highlight-pulse');
        void el.offsetWidth;
        el.classList.add('highlight-pulse');
      }
    }

    function runChatSearch(query) {
      clearChatSearchHighlights();
      const q = String(query || '').trim().toLowerCase();
      state.chatSearch.query = q;
      if (!q) {
        state.chatSearch.matches = [];
        state.chatSearch.index = -1;
        els.chatSearchCount.textContent = '0 / 0';
        return;
      }
      const matches = [];
      for (const m of state.messages) {
        const textHit = (m.text || '').toLowerCase().includes(q);
        const fileHit = Array.isArray(m.attachments) && m.attachments.some((a) => (a.originalName || '').toLowerCase().includes(q));
        if (textHit || fileHit) {
          matches.push(m.id);
          const el = $(`msg-${m.id}`);
          if (el) el.classList.add('search-match');
        }
      }
      state.chatSearch.matches = matches;
      jumpToChatSearchMatch(matches.length - 1);
    }

    function openChatSearch() {
      if (!state.activeChatId) return;
      state.chatSearch.open = true;
      els.chatSearchBar.classList.remove('hidden');
      els.chatSearchInput.focus();
      els.chatSearchInput.select();
    }

    function closeChatSearch() {
      state.chatSearch.open = false;
      state.chatSearch.query = '';
      state.chatSearch.matches = [];
      state.chatSearch.index = -1;
      els.chatSearchInput.value = '';
      els.chatSearchCount.textContent = '0 / 0';
      els.chatSearchBar.classList.add('hidden');
      clearChatSearchHighlights();
    }

    els.toggleChatSearchBtn.addEventListener('click', () => {
      if (state.chatSearch.open) closeChatSearch();
      else openChatSearch();
    });
    els.chatSearchClose.addEventListener('click', closeChatSearch);
    els.chatSearchInput.addEventListener('input', () => runChatSearch(els.chatSearchInput.value));
    els.chatSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        jumpToChatSearchMatch(state.chatSearch.index + (e.shiftKey ? -1 : 1));
      }
    });
    els.chatSearchPrev.addEventListener('click', () => jumpToChatSearchMatch(state.chatSearch.index - 1));
    els.chatSearchNext.addEventListener('click', () => jumpToChatSearchMatch(state.chatSearch.index + 1));

    // Info Drawer
    els.toggleInfoBtn.addEventListener('click', () => toggleInfoDrawer());
    els.chatPeerTrigger.addEventListener('click', () => toggleInfoDrawer());
    els.closeInfoBtn.addEventListener('click', () => toggleInfoDrawer(false));
    els.infoTabMedia.addEventListener('click', () => {
      state.infoTab = 'media';
      els.infoTabMedia.classList.add('active');
      els.infoTabFiles.classList.remove('active');
      renderInfoDrawer();
    });
    els.infoTabFiles.addEventListener('click', () => {
      state.infoTab = 'files';
      els.infoTabFiles.classList.add('active');
      els.infoTabMedia.classList.remove('active');
      renderInfoDrawer();
    });

    // Scroll to bottom button
    els.messagesViewport.addEventListener('scroll', () => {
      els.scrollBottomBtn.classList.toggle('hidden', isNearBottom());
    });
    els.scrollBottomBtn.addEventListener('click', () => {
      els.messagesViewport.scrollTo({ top: els.messagesViewport.scrollHeight, behavior: 'smooth' });
    });

    // Message list click delegation (Lightbox, Reply, React, Delete, Reply jump)
    const handleMediaOrActionClick = async (e) => {
      const lightboxTrigger = e.target.closest('[data-lightbox-url]');
      if (lightboxTrigger) {
        openLightbox(
          lightboxTrigger.dataset.lightboxUrl,
          lightboxTrigger.dataset.lightboxName,
          lightboxTrigger.dataset.lightboxSender,
          lightboxTrigger.dataset.lightboxCaption || ''
        );
        return;
      }

      const replyBtn = e.target.closest('[data-reply-msg]');
      if (replyBtn) {
        setReply(replyBtn.dataset.replyMsg);
        return;
      }

      const copyBtn = e.target.closest('[data-copy-msg]');
      if (copyBtn) {
        const target = state.messages.find((m) => m.id === copyBtn.dataset.copyMsg);
        if (target && target.text && navigator.clipboard) {
          await navigator.clipboard.writeText(target.text).catch(() => { });
          showToast('Message copied to clipboard', 'success');
        }
        return;
      }

      const jumpReply = e.target.closest('[data-scroll-msg]');
      if (jumpReply) {
        const targetEl = $(`msg-${jumpReply.dataset.scrollMsg}`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetEl.classList.remove('highlight-pulse');
          void targetEl.offsetWidth;
          targetEl.classList.add('highlight-pulse');
        }
        return;
      }

      const reactBtn = e.target.closest('[data-react-msg]');
      if (reactBtn && state.activeChatId) {
        try {
          await api(`/api/chats/${encodeURIComponent(state.activeChatId)}/messages/${encodeURIComponent(reactBtn.dataset.reactMsg)}/react`, {
            method: 'POST',
            body: { emoji: reactBtn.dataset.emoji }
          });
        } catch (err) {
          showToast(err.message, 'error');
        }
        return;
      }

      const delBtn = e.target.closest('[data-delete-msg]');
      if (delBtn && state.activeChatId) {
        try {
          await api(`/api/chats/${encodeURIComponent(state.activeChatId)}/messages/${encodeURIComponent(delBtn.dataset.deleteMsg)}`, {
            method: 'DELETE'
          });
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    };

    els.messagesList.addEventListener('click', handleMediaOrActionClick);
    els.infoSharedContent.addEventListener('click', handleMediaOrActionClick);

    // Composer & File Attachments
    els.attachBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      addPendingFiles(els.fileInput.files);
      els.fileInput.value = '';
    });
    els.pendingFilesBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-file]');
      if (btn) removePendingFile(Number(btn.dataset.removeFile));
    });

    els.cancelReplyBtn.addEventListener('click', clearReply);
    els.sendBtn.addEventListener('click', sendMessage);

    els.messageInput.addEventListener('input', () => {
      autoResizeInput();
      if (els.messageInput.value.trim()) sendTypingSignal(true);
      else sendTypingSignal(false);
    });

    els.messageInput.addEventListener('keydown', (e) => {
      const sendOnEnter = state.prefs.enterToSend !== false;
      if (sendOnEnter && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      } else if (!sendOnEnter && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Paste images directly from clipboard
    els.messageInput.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const pastedFiles = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) pastedFiles.push(f);
        }
      }
      if (pastedFiles.length > 0) {
        addPendingFiles(pastedFiles);
      }
    });

    // Drag & Drop files onto chat pane
    let dragCounter = 0;
    els.activeChat.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      els.dropOverlay.classList.remove('hidden');
    });
    els.activeChat.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        els.dropOverlay.classList.add('hidden');
      }
    });
    els.activeChat.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    els.activeChat.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      els.dropOverlay.classList.add('hidden');
      if (e.dataTransfer && e.dataTransfer.files) {
        addPendingFiles(e.dataTransfer.files);
      }
    });

    // Emoji Picker
    els.emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.emojiPopover.classList.toggle('hidden');
    });
    els.emojiPopover.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-insert-emoji]');
      if (!btn) return;
      const emoji = btn.dataset.insertEmoji;
      const input = els.messageInput;
      const start = input.selectionStart || input.value.length;
      const end = input.selectionEnd || input.value.length;
      input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + emoji.length;
      input.focus();
      autoResizeInput();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.emoji-picker-anchor')) {
        els.emojiPopover.classList.add('hidden');
      }
    });

    // Lightbox
    els.lightboxClose.addEventListener('click', closeLightbox);
    els.lightboxBackdrop.addEventListener('click', (e) => {
      if (e.target === els.lightboxBackdrop) closeLightbox();
    });

    // Profile Modal
    els.profileModalClose.addEventListener('click', closeProfileModal);
    els.profileCancelBtn.addEventListener('click', closeProfileModal);
    els.profileModalBackdrop.addEventListener('click', closeProfileModal);

    els.profileAvatarInput.addEventListener('change', async () => {
      const file = els.profileAvatarInput.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('avatar', file, file.name);
      try {
        const data = await api('/api/users/me/avatar', { method: 'POST', body: fd });
        state.me = data.user;
        renderAvatar(els.profileEditAvatar, state.me);
        updateDrawerUserInfo();
        showToast('Avatar updated!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    els.profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await api('/api/users/me', {
          method: 'PATCH',
          body: {
            displayName: els.profileDisplayName.value.trim(),
            bio: els.profileBio.value.trim()
          }
        });
        state.me = data.user;
        updateDrawerUserInfo();
        closeProfileModal();
        showToast('Profile saved!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.me) {
        e.preventDefault();
        els.sidebarSearch.focus();
        els.sidebarSearch.select();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && state.me && state.activeChatId) {
        e.preventDefault();
        openChatSearch();
        return;
      }
      if (e.key === 'Escape') {
        closeLightbox();
        closeProfileModal();
        closeSettingsModal();
        closeDrawer();
        closeChatSearch();
        els.emojiPopover.classList.add('hidden');
      }
    });
  }

  async function onAuthenticated(user) {
    state.me = user;
    showAppShell();
    updateNotificationBanner();
    syncAndroidState(true);
    connectRealtime();
    await refreshChats();
  }

  function setupMobileViewportSync() {
    const root = document.documentElement;
    const syncViewport = () => {
      const vv = window.visualViewport;
      const height = vv ? vv.height : (window.innerHeight || 0);
      const offsetTop = vv ? vv.offsetTop : 0;
      if (height) {
        root.style.setProperty('--app-height', `${Math.round(height)}px`);
      }
      root.style.setProperty('--app-offset-top', `${Math.round(offsetTop)}px`);
      if ((window.scrollY || window.scrollX) && typeof window.scrollTo === 'function') {
        window.scrollTo(0, 0);
      }
    };

    syncViewport();
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', syncViewport);
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        const wasBottom = isNearBottom();
        syncViewport();
        if (wasBottom && state.activeChatId) {
          requestAnimationFrame(() => {
            els.messagesViewport.scrollTop = els.messagesViewport.scrollHeight;
          });
        }
      });
      window.visualViewport.addEventListener('scroll', syncViewport);
    }

    els.messageInput.addEventListener('focus', () => {
      const wasBottom = isNearBottom();
      setTimeout(() => {
        syncViewport();
        if (wasBottom) {
          els.messagesViewport.scrollTop = els.messagesViewport.scrollHeight;
        }
      }, 120);
      setTimeout(syncViewport, 320);
    });
  }

  // Expose clean hooks for the Android WebView wrapper
  window.__telechatSyncState = (isFg) => syncAndroidState(isFg);
  window.__telechatOpenChat = (chatId) => openChatByIdOrSender(chatId, null);
  window.__telechatHandleBack = () => {
    if (!els.lightboxModal.classList.contains('hidden')) { closeLightbox(); return true; }
    if (!els.settingsModal.classList.contains('hidden')) { closeSettingsModal(); return true; }
    if (!els.profileModal.classList.contains('hidden')) { closeProfileModal(); return true; }
    if (els.navDrawer.classList.contains('open')) { closeDrawer(); return true; }
    if (state.infoOpen) { toggleInfoDrawer(false); return true; }
    if (els.appShell.classList.contains('mobile-chat-open')) {
      els.appShell.classList.remove('mobile-chat-open');
      state.activeChatId = null;
      syncAndroidState();
      renderSidebar();
      return true;
    }
    return false;
  };

  document.addEventListener('visibilitychange', () => syncAndroidState(!document.hidden));

  async function boot() {
    applyPrefs();
    setupMobileViewportSync();
    registerServiceWorker();
    initEmojiPopover();
    wireEvents();

    try {
      const data = await api('/api/auth/me');
      await onAuthenticated(data.user);
    } catch {
      showAuthScreen();
    }
  }

  boot();
})();
