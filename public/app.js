(() => {
  'use strict';

  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
  const MORE_REACTIONS = ['🙏', '🎉', '👏', '💯', '😍', '🤯', '👀', '⚡'];
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
    activeChatMeta: null,
    activePeer: null,
    activeRoom: null,
    pinnedMessage: null,
    messages: [],
    pendingFiles: [],
    replyTo: null,
    editingMessage: null,
    composeTimerMode: 'off',
    selectMode: false,
    selectedMsgIds: new Set(),
    chatSelectMode: false,
    selectedChatIds: new Set(),
    deleteConfirmState: null,
    forwardMsgIds: [],
    searchQuery: '',
    sidebarFilter: 'all',
    unreadBelowCount: 0,
    firstUnreadMsgId: null,
    friends: [],
    friendRequestsSent: [],
    friendRequestsReceived: [],
    friendsSubTab: 'friends',
    browseMode: false,
    searchResults: [],
    typingPeers: new Map(), // chatId -> timeoutId
    onlineUsers: new Set(),
    infoOpen: false,
    infoTab: 'media',
    eventSource: null,
    theme: localStorage.getItem('telechat_theme') || 'dark',
    prefs: loadPrefs(),
    drafts: loadDrafts(),
    scrollPositions: loadScrollPositions(),
    pinToBottomUntil: 0,
    userScrolledSinceOpen: false,
    pendingShare: null,
    queuedAndroidShare: null,
    sending: false,
    blockedUsers: [],
    pendingProfileLinkUser: null,
    forgotVerificationId: null,
    deleteAccountVerificationId: null,
    reportTargetUsername: null,
    previewedProfileUser: null,
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
    forgotPasswordBtn: $('forgot-password-btn'),
    forgotForm: $('forgot-form'),
    forgotSubtitle: $('forgot-subtitle'),
    forgotStepRequest: $('forgot-step-request'),
    forgotIdentifier: $('forgot-identifier'),
    forgotReqError: $('forgot-req-error'),
    forgotSendBtn: $('forgot-send-btn'),
    forgotStepReset: $('forgot-step-reset'),
    forgotDevBanner: $('forgot-dev-banner'),
    forgotCode: $('forgot-code'),
    forgotNewPassword: $('forgot-new-password'),
    forgotResetError: $('forgot-reset-error'),
    forgotResetSubmit: $('forgot-reset-submit'),
    forgotBackBtn: $('forgot-back-btn'),
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
    menuSavedMessages: $('menu-saved-messages'),
    menuFriends: $('menu-friends'),
    menuFindUsers: $('menu-find-users'),
    menuEditProfile: $('menu-edit-profile'),
    menuSettings: $('menu-settings'),
    menuAppUpdate: $('menu-app-update'),
    drawerUpdateBadge: $('drawer-update-badge'),
    menuToggleTheme: $('menu-toggle-theme'),
    menuThemeLabel: $('menu-theme-label'),
    menuLogout: $('menu-logout'),

    sidebarSearch: $('sidebar-search'),
    clearSearchBtn: $('clear-search-btn'),
    browseUsersBtn: $('browse-users-btn'),
    appUpdateBanner: $('app-update-banner'),
    appUpdateBannerTitle: $('app-update-banner-title'),
    appUpdateBannerSub: $('app-update-banner-sub'),
    notifBanner: $('notif-banner'),
    notifAllowBtn: $('notif-allow-btn'),
    notifDismissBtn: $('notif-dismiss-btn'),
    sidebarSectionTitle: $('sidebar-section-title'),
    sidebarTabs: $('sidebar-tabs'),
    unreadTabBadge: $('unread-tab-badge'),
    friendsTabBadge: $('friends-tab-badge'),
    chatSelectBar: $('chat-select-bar'),
    chatSelectCount: $('chat-select-count'),
    chatSelPinBtn: $('chat-sel-pin-btn'),
    chatSelMuteBtn: $('chat-sel-mute-btn'),
    chatSelArchiveBtn: $('chat-sel-archive-btn'),
    chatSelDeleteBtn: $('chat-sel-delete-btn'),
    chatSelCancelBtn: $('chat-sel-cancel-btn'),
    shareTargetBanner: $('share-target-banner'),
    shareTargetSummary: $('share-target-summary'),
    shareTargetCancel: $('share-target-cancel'),
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
    callAudioBtn: $('call-audio-btn'),
    callVideoBtn: $('call-video-btn'),
    openGamesBtn: $('open-games-btn'),
    openPollBtn: $('open-poll-btn'),

    chatSearchBar: $('chat-search-bar'),
    chatSearchInput: $('chat-search-input'),
    chatSearchCount: $('chat-search-count'),
    chatSearchPrev: $('chat-search-prev'),
    chatSearchNext: $('chat-search-next'),
    chatSearchClose: $('chat-search-close'),

    pinnedMsgBar: $('pinned-msg-bar'),
    pinnedMsgJump: $('pinned-msg-jump'),
    pinnedMsgPreview: $('pinned-msg-preview'),
    unpinMsgBtn: $('unpin-msg-btn'),

    messagesViewport: $('messages-viewport'),
    messagesList: $('messages-list'),
    typingBubbleRow: $('typing-bubble-row'),
    scrollBottomBtn: $('scroll-bottom-btn'),
    scrollUnreadBadge: $('scroll-unread-badge'),
    dropOverlay: $('drop-overlay'),

    multiSelectBar: $('multi-select-bar'),
    multiSelectCount: $('multi-select-count'),
    multiCopyBtn: $('multi-copy-btn'),
    multiForwardBtn: $('multi-forward-btn'),
    multiDeleteBtn: $('multi-delete-btn'),
    multiCancelBtn: $('multi-cancel-btn'),
    editBanner: $('edit-banner'),
    editBannerText: $('edit-banner-text'),
    cancelEditBtn: $('cancel-edit-btn'),
    voiceRecBar: $('voice-rec-bar'),
    voiceRecTimer: $('voice-rec-timer'),
    voiceRecWave: $('voice-rec-wave'),
    voiceCancelBtn: $('voice-cancel-btn'),
    voiceSendBtn: $('voice-send-btn'),
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
    msgTimerBtn: $('msg-timer-btn'),
    msgTimerPill: $('msg-timer-pill'),
    msgTimerPopover: $('msg-timer-popover'),
    emojiBtn: $('emoji-btn'),
    emojiPopover: $('emoji-popover'),
    pickerTabs: $('picker-tabs'),
    pickerSearchWrap: $('picker-search-wrap'),
    pickerSearchInput: $('picker-search-input'),
    pickerBody: $('picker-body'),
    mentionPopover: $('mention-popover'),
    channelReadonlyBar: $('channel-readonly-bar'),
    dmBlockedBar: $('dm-blocked-bar'),
    dmBlockedText: $('dm-blocked-text'),
    dmUnblockInlineBtn: $('dm-unblock-inline-btn'),
    voiceRecBtn: $('voice-rec-btn'),
    sendBtn: $('send-btn'),

    infoDrawer: $('info-drawer'),
    infoHeaderTitle: $('info-header-title'),
    closeInfoBtn: $('close-info-btn'),
    infoAvatar: $('info-avatar'),
    infoDisplayName: $('info-displayname'),
    infoStatus: $('info-status'),
    infoUsername: $('info-username'),
    infoEmailRow: $('info-email-row'),
    infoEmail: $('info-email'),
    infoBioRow: $('info-bio-row'),
    infoBio: $('info-bio'),
    infoBirthdayRow: $('info-birthday-row'),
    infoBirthday: $('info-birthday'),
    infoChatPrefs: $('info-chat-prefs'),
    infoPinChatBtn: $('info-pin-chat-btn'),
    infoMuteChatBtn: $('info-mute-chat-btn'),
    infoArchiveChatBtn: $('info-archive-chat-btn'),
    infoFriendControls: $('info-friend-controls'),
    infoSafetyControls: $('info-safety-controls'),
    infoBlockBtn: $('info-block-btn'),
    infoReportBtn: $('info-report-btn'),
    infoRoomControls: $('info-room-controls'),
    infoTabMedia: $('info-tab-media'),
    infoTabFiles: $('info-tab-files'),
    infoSharedContent: $('info-shared-content'),

    forwardModal: $('forward-modal'),
    forwardModalBackdrop: $('forward-modal-backdrop'),
    forwardModalClose: $('forward-modal-close'),
    forwardTargetsList: $('forward-targets-list'),

    chatContextOverlay: $('chat-context-overlay'),
    chatContextBackdrop: $('chat-context-backdrop'),
    chatContextCard: $('chat-context-card'),

    deleteConfirmModal: $('delete-confirm-modal'),
    deleteConfirmBackdrop: $('delete-confirm-backdrop'),
    deleteConfirmClose: $('delete-confirm-close'),
    deleteConfirmTitle: $('delete-confirm-title'),
    deleteConfirmDesc: $('delete-confirm-desc'),
    deleteEveryoneRow: $('delete-everyone-row'),
    deleteEveryoneCheckbox: $('delete-everyone-checkbox'),
    deleteEveryoneLabel: $('delete-everyone-label'),
    deleteConfirmCancel: $('delete-confirm-cancel'),
    deleteConfirmSubmit: $('delete-confirm-submit'),

    reportUserModal: $('report-user-modal'),
    reportModalBackdrop: $('report-modal-backdrop'),
    reportModalClose: $('report-modal-close'),
    reportUserForm: $('report-user-form'),
    reportTargetLabel: $('report-target-label'),
    reportReason: $('report-reason'),
    reportDetails: $('report-details'),
    reportCancelBtn: $('report-cancel-btn'),
    reportSubmitBtn: $('report-submit-btn'),

    userPreviewModal: $('user-preview-modal'),
    userPreviewBackdrop: $('user-preview-backdrop'),
    userPreviewClose: $('user-preview-close'),
    userPreviewAvatar: $('user-preview-avatar'),
    userPreviewName: $('user-preview-name'),
    userPreviewHandle: $('user-preview-handle'),
    userPreviewStatus: $('user-preview-status'),
    userPreviewBio: $('user-preview-bio'),
    userPreviewMeta: $('user-preview-meta'),
    userPreviewActions: $('user-preview-actions'),

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
    profileRemoveAvatarBtn: $('profile-remove-avatar-btn'),
    profileUsername: $('profile-username'),
    profileDisplayName: $('profile-displayname'),
    profileBio: $('profile-bio'),
    profileBirthday: $('profile-birthday'),
    profileClearBirthdayBtn: $('profile-clear-birthday-btn'),

    settingsModal: $('settings-modal'),
    settingsModalBackdrop: $('settings-modal-backdrop'),
    settingsCard: $('settings-card'),
    settingsModalClose: $('settings-modal-close'),
    settingsModalTitle: $('settings-modal-title'),
    settingsBackBtn: $('settings-back-btn'),
    settingsNav: $('settings-nav'),
    settingsMobileProfile: $('settings-mobile-profile'),
    settingsMobileAvatar: $('settings-mobile-avatar'),
    settingsMobileDisplayName: $('settings-mobile-displayname'),
    settingsMobileSub: $('settings-mobile-sub'),
    settingsAvatar: $('settings-avatar'),
    settingsDisplayName: $('settings-displayname'),
    settingsUsername: $('settings-username'),
    settingsEmail: $('settings-email'),
    settingsBirthdayRow: $('settings-birthday-row'),
    settingsBirthday: $('settings-birthday'),
    settingsOpenProfile: $('settings-open-profile'),
    settingsGotoThemes: $('settings-goto-themes'),
    settingsQrBox: $('settings-qr-box'),
    settingsProfileLink: $('settings-profile-link'),
    copyProfileLinkBtn: $('copy-profile-link-btn'),
    shareProfileLinkBtn: $('share-profile-link-btn'),
    changePasswordForm: $('change-password-form'),
    chgCurPassword: $('chg-cur-password'),
    chgNewPassword: $('chg-new-password'),
    chgConfirmPassword: $('chg-confirm-password'),
    chgPassError: $('chg-pass-error'),
    chgPassSubmit: $('chg-pass-submit'),
    privEmail: $('priv-email'),
    privBirthday: $('priv-birthday'),
    privLastSeen: $('priv-last-seen'),
    privAvatar: $('priv-avatar'),
    blockedUsersList: $('blocked-users-list'),
    deleteAccSendCodeBtn: $('delete-acc-send-code-btn'),
    deleteAccStepRequest: $('delete-acc-step-request'),
    deleteAccStepConfirm: $('delete-acc-step-confirm'),
    deleteAccDevBanner: $('delete-acc-dev-banner'),
    deleteAccMaskedSub: $('delete-acc-masked-sub'),
    deleteAccCode: $('delete-acc-code'),
    deleteAccPhrase: $('delete-acc-phrase'),
    deleteAccError: $('delete-acc-error'),
    deleteAccConfirmBtn: $('delete-acc-confirm-btn'),
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

    settingsTabUpdates: $('settings-tab-updates'),
    settingsNavUpdateSub: $('settings-nav-update-sub'),
    settingsNavUpdateDot: $('settings-nav-update-dot'),
    updateVersionMeta: $('update-version-meta'),
    updateStatusPill: $('update-status-pill'),
    updateNotesBox: $('update-notes-box'),
    updateProgressWrap: $('update-progress-wrap'),
    updateProgressBar: $('update-progress-bar'),
    updateProgressText: $('update-progress-text'),
    updateErrorMsg: $('update-error-msg'),
    updateInstallBtn: $('update-install-btn'),
    updateCheckBtn: $('update-check-btn'),

    msgContextOverlay: $('msg-context-overlay'),
    msgContextBackdrop: $('msg-context-backdrop'),
    msgContextPopup: $('msg-context-popup'),
    msgContextReactions: $('msg-context-reactions'),

    viewOnceModal: $('view-once-modal'),
    viewOnceBackdrop: $('view-once-backdrop'),
    viewOnceClose: $('view-once-close'),
    viewOnceBody: $('view-once-body'),
    viewOnceDoneBtn: $('view-once-done-btn'),
    msgContextCard: $('msg-context-card'),

    toastContainer: $('toast-container')
  };

  // =========================================================================
  // Utilities
  // =========================================================================
  function formatCompactCount(count) {
    const n = Number(count || 0);
    if (n <= 0) return '0';
    if (n < 1000) return String(Math.floor(n));
    if (n < 1000000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  function formatBirthdayLabel(yyyyMmDd) {
    if (!yyyyMmDd || typeof yyyyMmDd !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(utcDate.getTime())) return null;

    const now = new Date();
    const isToday = now.getMonth() + 1 === month && now.getDate() === day;
    let age = now.getFullYear() - year;
    if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) {
      age--;
    }
    const formattedDate = utcDate.toLocaleDateString([], {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const ageLabel = age >= 0 ? ` (${age} yrs)` : '';
    return {
      text: `${formattedDate}${ageLabel}${isToday ? ' • Birthday today! 🎉' : ''}`,
      isToday
    };
  }

  function updateGlobalUnreadCounters() {
    const totalUnread = state.chats.reduce((sum, c) => (c.isArchived ? sum : sum + Number(c.unreadCount || 0)), 0);
    if (els.unreadTabBadge) {
      els.unreadTabBadge.textContent = formatCompactCount(totalUnread);
      els.unreadTabBadge.classList.toggle('hidden', totalUnread <= 0);
    }
    if (els.friendsTabBadge) {
      const incomingCount = Array.isArray(state.friendRequestsReceived) ? state.friendRequestsReceived.length : 0;
      els.friendsTabBadge.textContent = formatCompactCount(incomingCount);
      els.friendsTabBadge.classList.toggle('hidden', incomingCount <= 0);
    }
    if (els.scrollUnreadBadge) {
      const below = Number(state.unreadBelowCount || 0);
      els.scrollUnreadBadge.textContent = formatCompactCount(below);
      els.scrollUnreadBadge.classList.toggle('hidden', below <= 0);
    }
    if (typeof document !== 'undefined') {
      const baseTitle = 'VibeRoom — Chat, Calls & Mini-Games';
      document.title = totalUnread > 0 ? `(${formatCompactCount(totalUnread)}) ${baseTitle}` : baseTitle;
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function linkifyText(text) {
    let out = escapeHtml(text);
    const tokens = [];
    const stash = (html) => {
      const idx = tokens.length;
      tokens.push(html);
      return `\u0000T${idx}\u0000`;
    };

    // Fenced code blocks ```code``` and inline `code`
    out = out.replace(/```(?:\w+\n)?([\s\S]+?)```/g, (_, code) => {
      return stash(`<pre class="msg-code-block"><code>${code.replace(/^\n+|\n+$/g, '')}</code></pre>`);
    });
    out = out.replace(/`([^\n`]+)`/g, (_, code) => {
      return stash(`<code class="msg-inline-code">${code}</code>`);
    });

    // URLs
    out = out.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      return stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    });

    // @mentions
    out = out.replace(/(^|[^a-zA-Z0-9_./])@([a-zA-Z0-9_]{2,24})\b/g, (full, pre, uname) => {
      return `${pre}${stash(`<span class="mention-tag" data-mention="${uname}">@${uname}</span>`)}`;
    });

    // Spoilers ||secret||
    out = out.replace(/\|\|([^\n]+?)\|\|/g, '<span class="msg-spoiler" role="button" tabindex="0" title="Click to reveal">$1</span>');
    // Bold **text**
    out = out.replace(/\*\*([^\s*](?:[^\n*]*?[^\s*])?)\*\*/g, '<strong>$1</strong>');
    // Italic *text* and boundary-safe _text_
    out = out.replace(/\*([^\s*](?:[^\n*]*?[^\s*])?)\*/g, '<em>$1</em>');
    out = out.replace(/(^|[\s(>])_([^\s_](?:[^\n_]*?[^\s_])?)_(?=$|[\s).,!?:;<])/g, '$1<em>$2</em>');

    return out.replace(/\u0000T(\d+)\u0000/g, (_, idx) => tokens[Number(idx)] || '');
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
    if (!iso) return 'last seen recently';
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

  function loadDrafts() {
    try {
      const raw = JSON.parse(localStorage.getItem('viberoom_drafts') || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  function loadScrollPositions() {
    try {
      const raw = JSON.parse(localStorage.getItem('viberoom_scroll') || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  function saveCurrentChatScroll() {
    const chatId = state.activeChatId;
    const vp = els.messagesViewport;
    if (!chatId || !vp) return;

    if (isNearBottom(60)) {
      state.scrollPositions[chatId] = { atBottom: true, updatedAt: Date.now() };
    } else {
      const vpRect = typeof vp.getBoundingClientRect === 'function' ? vp.getBoundingClientRect() : null;
      let anchorMsgId = null;
      let offsetPx = 0;
      if (vpRect && els.messagesList) {
        const rows = els.messagesList.querySelectorAll('.msg-row[data-msg-id]');
        for (const row of rows) {
          const r = row.getBoundingClientRect();
          if (r.bottom >= vpRect.top + 8) {
            anchorMsgId = row.dataset.msgId;
            offsetPx = Math.round(r.top - vpRect.top);
            break;
          }
        }
      }
      if (anchorMsgId) {
        state.scrollPositions[chatId] = { atBottom: false, anchorMsgId, offsetPx, updatedAt: Date.now() };
      } else {
        state.scrollPositions[chatId] = { atBottom: true, updatedAt: Date.now() };
      }
    }

    try {
      localStorage.setItem('viberoom_scroll', JSON.stringify(state.scrollPositions));
    } catch {
      // Ignore storage quota errors
    }
  }

  function instantScrollToBottom() {
    const vp = els.messagesViewport;
    if (!vp) return;
    const prevBehavior = vp.style.scrollBehavior;
    vp.style.scrollBehavior = 'auto';
    vp.scrollTop = vp.scrollHeight;
    vp.style.scrollBehavior = prevBehavior;
  }

  function restoreChatScrollPosition(chatId) {
    const vp = els.messagesViewport;
    if (!vp) return;
    const saved = state.scrollPositions[chatId];

    // If user explicitly left scrolled up to an older message (and no unread divider supersedes it),
    // restore to that exact message; otherwise pin cleanly at the bottom.
    if (saved && saved.atBottom === false && saved.anchorMsgId && !state.firstUnreadMsgId) {
      const anchorEl = $(`msg-${saved.anchorMsgId}`);
      if (anchorEl && typeof vp.getBoundingClientRect === 'function') {
        state.pinToBottomUntil = 0;
        const applyAnchor = () => {
          const vpRect = vp.getBoundingClientRect();
          const rowRect = anchorEl.getBoundingClientRect();
          const prevBehavior = vp.style.scrollBehavior;
          vp.style.scrollBehavior = 'auto';
          vp.scrollTop += (rowRect.top - vpRect.top) - (saved.offsetPx || 0);
          vp.style.scrollBehavior = prevBehavior;
        };
        requestAnimationFrame(applyAnchor);
        setTimeout(() => {
          if (!state.userScrolledSinceOpen && state.activeChatId === chatId) applyAnchor();
        }, 120);
        return;
      }
    }

    // Default / was at bottom when leaving: snap cleanly to bottom and keep pinned while images load
    state.pinToBottomUntil = Date.now() + 2600;
    state.userScrolledSinceOpen = false;
    instantScrollToBottom();
    requestAnimationFrame(() => {
      if (!state.userScrolledSinceOpen && state.activeChatId === chatId) instantScrollToBottom();
    });
    setTimeout(() => {
      if (!state.userScrolledSinceOpen && state.activeChatId === chatId) instantScrollToBottom();
    }, 120);
    setTimeout(() => {
      if (!state.userScrolledSinceOpen && state.activeChatId === chatId) instantScrollToBottom();
    }, 340);
  }

  function saveChatDraft(chatId, rawText) {
    if (!chatId) return;
    const text = typeof rawText === 'string' ? rawText : '';
    const hadDraft = Boolean(state.drafts[chatId] && state.drafts[chatId].text);
    const hasDraft = text.trim().length > 0;
    if (hasDraft) {
      state.drafts[chatId] = { text, updatedAt: Date.now() };
    } else {
      delete state.drafts[chatId];
    }
    try {
      localStorage.setItem('viberoom_drafts', JSON.stringify(state.drafts));
    } catch {
      // Ignore storage quota errors
    }
    if (hadDraft !== hasDraft) {
      renderSidebar();
    }
  }

  function clearPendingShare(clearNative = true) {
    state.pendingShare = null;
    if (els.shareTargetBanner) els.shareTargetBanner.classList.add('hidden');
    if (clearNative && window.AndroidBridge && typeof window.AndroidBridge.clearSharedFiles === 'function') {
      try { window.AndroidBridge.clearSharedFiles(); } catch { }
    }
  }

  function handleIncomingAndroidShare(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (!state.me) {
      state.queuedAndroidShare = payload;
      return;
    }
    const text = typeof payload.text === 'string' ? payload.text : '';
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!text && files.length === 0) return;

    state.pendingShare = { text, files };
    closeMessageContextMenu();
    closeLightbox();
    closeProfileModal();
    closeSettingsModal();
    closeDrawer();
    els.appShell.classList.remove('mobile-chat-open');

    const parts = [];
    if (files.length > 0) parts.push(`${files.length} file${files.length > 1 ? 's' : ''}`);
    if (text) parts.push('text');
    if (els.shareTargetSummary) {
      els.shareTargetSummary.textContent = `Sharing ${parts.join(' + ')} — tap any chat to attach`;
    }
    if (els.shareTargetBanner) {
      els.shareTargetBanner.classList.remove('hidden');
    }
  }

  async function applyPendingShareToActiveChat() {
    if (!state.pendingShare || !state.activeChatId) return;
    const share = state.pendingShare;
    state.pendingShare = null;
    if (els.shareTargetBanner) els.shareTargetBanner.classList.add('hidden');

    if (share.text) {
      const existing = els.messageInput.value.trim();
      els.messageInput.value = existing ? `${existing}\n${share.text}` : share.text;
      saveChatDraft(state.activeChatId, els.messageInput.value);
      autoResizeInput();
    }

    if (Array.isArray(share.files) && share.files.length > 0) {
      const fetchedFiles = [];
      for (const f of share.files) {
        try {
          const resp = await fetch(f.url);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          fetchedFiles.push(new File([blob], f.name || 'shared', { type: f.mime || blob.type || 'application/octet-stream' }));
        } catch {
          // Ignore single file read failure
        }
      }
      if (fetchedFiles.length > 0) {
        addPendingFiles(fetchedFiles);
      }
    }

    if (window.AndroidBridge && typeof window.AndroidBridge.clearSharedFiles === 'function') {
      try { window.AndroidBridge.clearSharedFiles(); } catch { }
    }
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
    if (els.menuThemeLabel) els.menuThemeLabel.textContent = isLight ? 'Night Mode' : 'Light Mode';
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
        if (hasAndroidBridge) els.notifStatusHint.textContent = 'Handled by VibeRoom Android app';
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
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function ensureWebPushSubscribed() {
    if (!state.me || !state.prefs.notifications) return false;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    try {
      const reg = swRegistration || (await navigator.serviceWorker.ready);
      if (!reg || !reg.pushManager) return false;
      const cfg = await api('/api/push/config');
      if (!cfg || !cfg.vapidPublicKey) return false;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey)
        });
      }
      if (sub) {
        await api('/api/push/web/subscribe', {
          method: 'POST',
          body: { subscription: sub.toJSON ? sub.toJSON() : sub }
        });
        return true;
      }
    } catch {
      // PushManager may be unsupported (e.g. HTTP non-localhost or older WebView)
    }
    return false;
  }

  async function unsubscribeWebPush() {
    try {
      const reg = swRegistration || (navigator.serviceWorker ? await navigator.serviceWorker.ready : null);
      if (!reg || !reg.pushManager) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await api('/api/push/web/unsubscribe', { method: 'POST', body: { endpoint } }).catch(() => {});
      }
    } catch {
      // Ignore unsubscribe failure
    }
  }

  async function syncAndroidFcmToken(explicitToken = '') {
    if (!state.me) return;
    let token = String(explicitToken || '').trim();
    if (!token && window.AndroidBridge && typeof window.AndroidBridge.getFcmToken === 'function') {
      try { token = String(window.AndroidBridge.getFcmToken() || '').trim(); } catch { }
    }
    if (!token) return;
    try {
      await api('/api/push/fcm/register', {
        method: 'POST',
        body: { token, platform: 'android' }
      });
    } catch {
      // Ignore transient FCM sync failures
    }
  }

  async function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      navigator.serviceWorker.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'open_chat') {
          openChatByIdOrSender(ev.data.chatId, ev.data.sender);
        }
      });
      if (state.me && typeof Notification !== 'undefined' && Notification.permission === 'granted' && state.prefs.notifications) {
        ensureWebPushSubscribed();
      }
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
      ensureWebPushSubscribed();
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
      await ensureWebPushSubscribed();
      showToast('Background & desktop notifications enabled!', 'success');
    } else {
      state.prefs.notifications = false;
      savePrefs();
    }
    syncSettingsUI();
    updateNotificationBanner();
    return res === 'granted';
  }

  async function openChatByIdOrSender(chatId, senderUsername) {
    if (chatId && String(chatId).startsWith('saved_')) {
      await openSavedMessages();
      return;
    }
    if (chatId && (String(chatId).startsWith('grp_') || String(chatId).startsWith('chn_'))) {
      await openRoomById(chatId);
      return;
    }
    if (senderUsername && state.me && senderUsername !== state.me.username) {
      await openChatWithUser(senderUsername);
      return;
    }
    if (chatId && state.me) {
      const chat = state.chats.find((c) => c.id === chatId);
      if (chat && chat.type === 'saved') {
        await openSavedMessages();
        return;
      }
      if (chat && (chat.type === 'group' || chat.type === 'channel')) {
        await openRoomById(chat.id);
        return;
      }
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

  let settingsMobileView = 'menu';

  function isMobileSettingsViewport() {
    return typeof window !== 'undefined' && window.innerWidth <= 680;
  }

  function showSettingsMobileMenu() {
    settingsMobileView = 'menu';
    if (els.settingsCard) els.settingsCard.setAttribute('data-mobile-view', 'menu');
    els.settingsModalTitle.textContent = 'Settings';
    els.settingsBackBtn.classList.toggle('hidden', !isMobileSettingsViewport());
  }

  function renderSettingsQrAndLink() {
    if (!state.me) return;
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null')
      ? window.location.origin
      : 'https://chat.bitdev.fun';
    const profileUrl = `${origin}/?user=${encodeURIComponent(state.me.username)}`;
    if (els.settingsProfileLink) {
      els.settingsProfileLink.value = profileUrl;
    }
    if (els.settingsQrBox) {
      if (window.VibeRoomQR && typeof window.VibeRoomQR.renderSvg === 'function') {
        try {
          els.settingsQrBox.innerHTML = window.VibeRoomQR.renderSvg(profileUrl, { margin: 3 });
        } catch {
          els.settingsQrBox.textContent = 'QR unavailable';
        }
      }
    }
  }

  function renderBlockedUsersList() {
    if (!els.blockedUsersList) return;
    const list = state.blockedUsers || [];
    if (list.length === 0) {
      els.blockedUsersList.innerHTML = '<div class="blocked-empty">No blocked users.</div>';
      return;
    }
    els.blockedUsersList.innerHTML = list.map((u) => `
      <div class="blocked-user-row">
        <div class="avatar" style="background: ${escapeHtml(u.avatarColor || 'var(--accent)')}">${escapeHtml(initialsFor(u))}</div>
        <div class="blocked-user-meta">
          <div class="blocked-user-name">${escapeHtml(u.displayName || u.username)}</div>
          <div class="blocked-user-sub">@${escapeHtml(u.username)}</div>
        </div>
        <button type="button" class="secondary-btn sm" data-unblock-user="${escapeHtml(u.username)}">Unblock</button>
      </div>
    `).join('');
  }

  async function refreshBlockedUsers() {
    if (!state.me) return;
    try {
      const data = await api('/api/users/blocked');
      state.blockedUsers = data.blocked || [];
      renderBlockedUsersList();
    } catch {
      // Ignore transient errors
    }
  }

  function syncPrivacyUI() {
    const priv = (state.me && state.me.privacy) || { email: 'everyone', birthday: 'everyone', lastSeen: 'everyone', avatar: 'everyone' };
    if (els.privEmail) els.privEmail.value = priv.email || 'everyone';
    if (els.privBirthday) els.privBirthday.value = priv.birthday || 'everyone';
    if (els.privLastSeen) els.privLastSeen.value = priv.lastSeen || 'everyone';
    if (els.privAvatar) els.privAvatar.value = priv.avatar || 'everyone';
  }

  function resetDeleteAccountPanel() {
    state.deleteAccountVerificationId = null;
    if (els.deleteAccStepRequest) els.deleteAccStepRequest.classList.remove('hidden');
    if (els.deleteAccStepConfirm) els.deleteAccStepConfirm.classList.add('hidden');
    if (els.deleteAccDevBanner) els.deleteAccDevBanner.classList.add('hidden');
    if (els.deleteAccCode) els.deleteAccCode.value = '';
    if (els.deleteAccPhrase) els.deleteAccPhrase.value = '';
    if (els.deleteAccError) els.deleteAccError.classList.add('hidden');
  }

  function openReportModal(targetUsername) {
    if (!els.reportUserModal || !targetUsername) return;
    state.reportTargetUsername = targetUsername;
    if (els.reportTargetLabel) {
      els.reportTargetLabel.textContent = `Report @${targetUsername} for inappropriate behavior or spam. Reports are recorded for moderation review.`;
    }
    if (els.reportReason) els.reportReason.value = 'spam';
    if (els.reportDetails) els.reportDetails.value = '';
    els.reportUserModal.classList.remove('hidden');
  }

  function closeReportModal() {
    state.reportTargetUsername = null;
    if (els.reportUserModal) els.reportUserModal.classList.add('hidden');
  }

  async function performBlockToggle(targetUsername, shouldBlock) {
    const clean = String(targetUsername || '').trim().toLowerCase();
    if (!clean) return;
    try {
      if (shouldBlock) {
        await api('/api/users/block', { method: 'POST', body: { targetUsername: clean } });
        showToast(`Blocked @${clean}`, 'success');
      } else {
        await api(`/api/users/block/${encodeURIComponent(clean)}`, { method: 'DELETE' });
        showToast(`Unblocked @${clean}`, 'success');
      }
      if (state.activePeer && state.activePeer.username === clean) {
        state.activePeer.blockedByMe = shouldBlock;
        syncComposerAccessForActiveChat();
        if (state.infoOpen) renderInfoDrawer();
      }
      await refreshBlockedUsers();
      await refreshChats();
      if (state.previewedProfileUser && state.previewedProfileUser.username === clean) {
        await openUserProfilePreviewModal(clean);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function closeUserPreviewModal() {
    state.previewedProfileUser = null;
    if (els.userPreviewModal) els.userPreviewModal.classList.add('hidden');
  }

  async function openUserProfilePreviewModal(username) {
    if (!els.userPreviewModal || !username) return;
    const clean = String(username).trim().replace(/^@+/, '').toLowerCase();
    if (!clean) return;
    if (state.me && clean === state.me.username) {
      openSettingsModal('general');
      return;
    }
    try {
      const data = await api(`/api/users/profile/${encodeURIComponent(clean)}`);
      const u = data.user;
      if (!u) return;
      state.previewedProfileUser = u;
      renderAvatar(els.userPreviewAvatar, u);
      if (els.userPreviewName) els.userPreviewName.textContent = u.displayName || u.username;
      if (els.userPreviewHandle) els.userPreviewHandle.textContent = `@${u.username}`;
      if (els.userPreviewStatus) {
        els.userPreviewStatus.textContent = u.online ? 'online' : formatLastSeen(u.lastSeen);
      }
      if (els.userPreviewBio) {
        if (u.bio) {
          els.userPreviewBio.textContent = u.bio;
          els.userPreviewBio.classList.remove('hidden');
        } else {
          els.userPreviewBio.classList.add('hidden');
        }
      }
      if (els.userPreviewMeta) {
        const metaLines = [];
        if (u.email) metaLines.push(`<div><strong>Email:</strong> ${escapeHtml(u.email)}</div>`);
        const bday = formatBirthdayLabel(u.birthday);
        if (bday) metaLines.push(`<div><strong>Birthday:</strong> ${escapeHtml(bday.text)}</div>`);
        els.userPreviewMeta.innerHTML = metaLines.join('');
      }
      if (els.userPreviewActions) {
        const uname = escapeHtml(u.username);
        const friendBtns = renderFriendActionBtnHtml(u.username, u.relationship || 'none');
        const blockLabel = u.blockedByMe ? 'Unblock' : 'Block';
        const blockAct = u.blockedByMe ? 'unblock' : 'block';
        els.userPreviewActions.innerHTML = `
          <button type="button" class="primary-btn sm" data-preview-message="${uname}">Message</button>
          ${friendBtns}
          <button type="button" class="secondary-btn sm" data-preview-block="${blockAct}" data-preview-user="${uname}">${blockLabel}</button>
          <button type="button" class="danger-btn sm" data-preview-report="${uname}">Report</button>
        `;
      }
      els.userPreviewModal.classList.remove('hidden');
    } catch (err) {
      showToast(err.message || 'User not found.', 'error');
    }
  }

  function openSettingsModal(initialTab = 'general') {
    if (state.me) {
      const displayName = state.me.displayName || state.me.username;
      renderAvatar(els.settingsAvatar, state.me);
      els.settingsDisplayName.textContent = displayName;
      els.settingsUsername.textContent = `@${state.me.username}`;
      els.settingsEmail.textContent = state.me.email;

      if (els.settingsBirthdayRow && els.settingsBirthday) {
        const bdayInfo = formatBirthdayLabel(state.me.birthday);
        if (bdayInfo) {
          els.settingsBirthdayRow.classList.remove('hidden');
          els.settingsBirthday.textContent = bdayInfo.text;
          els.settingsBirthday.classList.toggle('birthday-today', bdayInfo.isToday);
        } else {
          els.settingsBirthdayRow.classList.add('hidden');
        }
      }

      if (els.settingsMobileAvatar) renderAvatar(els.settingsMobileAvatar, state.me);
      if (els.settingsMobileDisplayName) els.settingsMobileDisplayName.textContent = displayName;
      if (els.settingsMobileSub) els.settingsMobileSub.textContent = `@${state.me.username} • ${state.me.email}`;

      renderSettingsQrAndLink();
      syncPrivacyUI();
      refreshBlockedUsers();
      resetDeleteAccountPanel();
      if (els.chgPassError) els.chgPassError.classList.add('hidden');
      if (els.changePasswordForm) els.changePasswordForm.reset();
    }
    syncSettingsUI();
    if (isMobileSettingsViewport() && (!initialTab || initialTab === 'menu' || initialTab === 'general')) {
      showSettingsMobileMenu();
    } else {
      switchSettingsTab(initialTab || 'general');
    }
    els.settingsModal.classList.remove('hidden');
  }

  function closeSettingsModal() {
    els.settingsModal.classList.add('hidden');
  }

  function switchSettingsTab(tab) {
    const valid = ['general', 'themes', 'chat', 'privacy', 'updates', 'delete'].includes(tab) ? tab : 'general';
    settingsMobileView = 'detail';
    if (els.settingsCard) els.settingsCard.setAttribute('data-mobile-view', 'detail');
    els.settingsNav.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.settingsTab === valid);
    });
    ['general', 'themes', 'chat', 'privacy', 'updates', 'delete'].forEach((name) => {
      const panel = $(`settings-panel-${name}`);
      if (panel) panel.classList.toggle('hidden', name !== valid);
    });
    const titles = {
      general: 'Account & Profile',
      themes: 'Appearance',
      chat: 'Notifications & Sounds',
      privacy: 'Privacy & Safety',
      updates: 'App Updates',
      delete: 'Delete Account'
    };
    if (valid === 'privacy') refreshBlockedUsers();
    els.settingsModalTitle.textContent = isMobileSettingsViewport()
      ? (titles[valid] || 'Settings')
      : (valid === 'general' ? 'Settings' : (titles[valid] || 'Settings'));
    els.settingsBackBtn.classList.toggle('hidden', !isMobileSettingsViewport() && valid === 'general');
  }

  let appUpdateState = null;
  function hasAndroidUpdater() {
    return Boolean(window.AndroidBridge && typeof window.AndroidBridge.checkForAppUpdate === 'function');
  }

  function updateAppUpdateUI(info) {
    const hasUpdater = hasAndroidUpdater();
    if (els.menuAppUpdate) els.menuAppUpdate.classList.toggle('hidden', !hasUpdater);
    if (els.settingsTabUpdates) els.settingsTabUpdates.classList.toggle('hidden', !hasUpdater);
    if (!hasUpdater) {
      if (els.appUpdateBanner) els.appUpdateBanner.classList.add('hidden');
      return;
    }

    if (info && typeof info === 'object') {
      appUpdateState = info;
    } else if (!appUpdateState && typeof window.AndroidBridge.getUpdateStateJson === 'function') {
      try {
        appUpdateState = JSON.parse(window.AndroidBridge.getUpdateStateJson() || '{}');
      } catch {
        appUpdateState = {};
      }
    }

    const st = appUpdateState || {};
    const curVer = st.currentVersion || (typeof window.AndroidBridge.getAppVersionName === 'function' ? window.AndroidBridge.getAppVersionName() : '1.0.0');
    const latestVer = st.latestVersion || curVer;
    const available = Boolean(st.available);
    const status = st.status || (available ? 'available' : 'up_to_date');
    const progress = Number(st.progress || 0);
    const sizeLabel = st.sizeBytes ? ` (${formatBytes(st.sizeBytes)})` : '';

    if (els.drawerUpdateBadge) els.drawerUpdateBadge.classList.toggle('hidden', !available);
    if (els.settingsNavUpdateDot) els.settingsNavUpdateDot.classList.toggle('hidden', !available);
    if (els.settingsNavUpdateSub) {
      els.settingsNavUpdateSub.textContent = available ? `v${latestVer} available` : `Installed: v${curVer}`;
    }

    if (els.appUpdateBanner) {
      els.appUpdateBanner.classList.toggle('hidden', !available || status === 'downloading' || status === 'installing');
      if (available) {
        if (els.appUpdateBannerTitle) els.appUpdateBannerTitle.textContent = `App update v${latestVer} available`;
        if (els.appUpdateBannerSub) els.appUpdateBannerSub.textContent = `Current: v${curVer} • Tap to update`;
      }
    }

    if (els.updateVersionMeta) {
      els.updateVersionMeta.textContent = available
        ? `Installed: v${curVer} → New: v${latestVer}${sizeLabel}`
        : `Installed: v${curVer}${latestVer ? ` • Latest: v${latestVer}` : ''}`;
    }

    if (els.updateStatusPill) {
      els.updateStatusPill.className = 'update-status-pill';
      if (status === 'downloading') {
        els.updateStatusPill.textContent = `Downloading ${progress}%`;
        els.updateStatusPill.classList.add('available');
      } else if (status === 'installing') {
        els.updateStatusPill.textContent = 'Ready to install';
        els.updateStatusPill.classList.add('available');
      } else if (status === 'permission_needed') {
        els.updateStatusPill.textContent = 'Permission needed';
        els.updateStatusPill.classList.add('available');
      } else if (status === 'checking') {
        els.updateStatusPill.textContent = 'Checking...';
      } else if (available) {
        els.updateStatusPill.textContent = `v${latestVer} available`;
        els.updateStatusPill.classList.add('available');
      } else {
        els.updateStatusPill.textContent = 'Up to date';
      }
    }

    if (els.updateNotesBox) {
      if (st.notes && available) {
        els.updateNotesBox.textContent = st.notes;
        els.updateNotesBox.classList.remove('hidden');
      } else {
        els.updateNotesBox.classList.add('hidden');
      }
    }

    if (els.updateProgressWrap) {
      const showProg = status === 'downloading' || status === 'installing';
      els.updateProgressWrap.classList.toggle('hidden', !showProg);
      if (els.updateProgressBar) els.updateProgressBar.style.width = `${progress}%`;
      if (els.updateProgressText) {
        els.updateProgressText.textContent = status === 'installing'
          ? 'Opening Android installer...'
          : `Downloading APK from GitHub... ${progress}%`;
      }
    }

    if (els.updateErrorMsg) {
      if (status === 'error' && st.error) {
        els.updateErrorMsg.textContent = st.error;
        els.updateErrorMsg.classList.remove('hidden');
      } else {
        els.updateErrorMsg.classList.add('hidden');
      }
    }

    if (els.updateInstallBtn) {
      els.updateInstallBtn.classList.toggle('hidden', !available);
      els.updateInstallBtn.disabled = status === 'downloading' || status === 'installing';
      els.updateInstallBtn.textContent = status === 'permission_needed'
        ? 'Allow App Installs & Continue'
        : (status === 'downloading' ? `Downloading (${progress}%)...` : 'Download & Install Update');
    }

    if (els.updateCheckBtn) {
      els.updateCheckBtn.disabled = status === 'checking' || status === 'downloading';
      els.updateCheckBtn.textContent = status === 'checking' ? 'Checking...' : 'Check for Updates';
    }
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

  function showForgotPasswordStep() {
    clearVerificationTimers();
    state.forgotVerificationId = null;
    if (els.authTabs) els.authTabs.classList.add('hidden');
    if (els.loginForm) els.loginForm.classList.add('hidden');
    if (els.registerForm) els.registerForm.classList.add('hidden');
    if (els.verifyForm) els.verifyForm.classList.add('hidden');
    if (els.forgotForm) els.forgotForm.classList.remove('hidden');
    if (els.forgotStepRequest) els.forgotStepRequest.classList.remove('hidden');
    if (els.forgotStepReset) els.forgotStepReset.classList.add('hidden');
    if (els.forgotReqError) els.forgotReqError.classList.add('hidden');
    if (els.forgotResetError) els.forgotResetError.classList.add('hidden');
    if (els.forgotDevBanner) els.forgotDevBanner.classList.add('hidden');
    if (els.forgotSubtitle) {
      els.forgotSubtitle.textContent = 'Enter your username or email to get a 6-digit verification code.';
    }
    if (els.forgotIdentifier) {
      els.forgotIdentifier.value = els.loginIdentifier ? els.loginIdentifier.value.trim() : '';
      els.forgotIdentifier.focus();
    }
  }

  function switchAuthTab(mode) {
    clearVerificationTimers();
    const isLogin = mode === 'login';
    els.authTabs.classList.remove('hidden');
    els.verifyForm.classList.add('hidden');
    if (els.forgotForm) els.forgotForm.classList.add('hidden');
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
  function getRelationshipForUser(username) {
    const target = String(username || '').trim().toLowerCase();
    if (!target) return 'none';
    if (state.me && state.me.username === target) return 'self';
    if (state.friends.some((f) => f.username === target)) return 'friends';
    if (state.friendRequestsSent.some((r) => r.user && r.user.username === target)) return 'outgoing_pending';
    if (state.friendRequestsReceived.some((r) => r.user && r.user.username === target)) return 'incoming_pending';
    return 'none';
  }

  function renderFriendActionBtnHtml(username, rel) {
    const u = escapeHtml(username);
    if (rel === 'friends') {
      return `<button type="button" class="friend-action-btn danger" data-friend-action="unfriend" data-friend-user="${u}">Unfriend</button>`;
    }
    if (rel === 'outgoing_pending') {
      return `<button type="button" class="friend-action-btn secondary" data-friend-action="cancel" data-friend-user="${u}">Cancel Req</button>`;
    }
    if (rel === 'incoming_pending') {
      return `
        <button type="button" class="friend-action-btn primary" data-friend-action="accept" data-friend-user="${u}">Accept</button>
        <button type="button" class="friend-action-btn secondary" data-friend-action="decline" data-friend-user="${u}">Decline</button>
      `;
    }
    return `<button type="button" class="friend-action-btn primary" data-friend-action="request" data-friend-user="${u}">+ Add Friend</button>`;
  }

  function renderFriendsSidebarPanel() {
    els.sidebarSectionTitle.classList.add('hidden');
    const friendsList = state.friends || [];
    const sentList = state.friendRequestsSent || [];
    const recList = state.friendRequestsReceived || [];
    const sub = state.friendsSubTab || 'friends';

    const subTabsHtml = `
      <div class="friends-subtabs">
        <button type="button" class="friends-subtab ${sub === 'friends' ? 'active' : ''}" data-friends-subtab="friends">
          Friends (${friendsList.length})
        </button>
        <button type="button" class="friends-subtab ${sub === 'requests' ? 'active' : ''}" data-friends-subtab="requests">
          Requests (${recList.length})
        </button>
        <button type="button" class="friends-subtab ${sub === 'sent' ? 'active' : ''}" data-friends-subtab="sent">
          Sent (${sentList.length})
        </button>
      </div>
    `;

    let bodyHtml = '';
    if (sub === 'sent') {
      if (sentList.length === 0) {
        bodyHtml = `
          <div class="sidebar-empty">
            No pending sent friend requests.<br/>
            Search by exact <strong>@username</strong> or <strong>email</strong> above to add friends!
          </div>
        `;
      } else {
        bodyHtml = sentList.map((item) => {
          const u = item.user;
          return `
            <div class="chat-row" data-open-user="${escapeHtml(u.username)}" role="listitem">
              <div class="avatar-wrap">
                <div class="avatar" style="background: ${escapeHtml(u.avatarColor || 'var(--accent)')}">
                  ${u.avatarUrl ? `<img src="${escapeHtml(u.avatarUrl)}" alt=""/>` : escapeHtml(initialsFor(u))}
                </div>
              </div>
              <div class="chat-row-body">
                <div class="chat-row-top">
                  <span class="chat-row-name">${escapeHtml(u.displayName || u.username)}</span>
                </div>
                <div class="chat-row-bottom">
                  <span class="chat-row-sub">@${escapeHtml(u.username)} • Pending</span>
                  <button type="button" class="friend-action-btn secondary" data-friend-action="cancel" data-friend-user="${escapeHtml(u.username)}">Cancel</button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    } else if (sub === 'requests') {
      if (recList.length === 0) {
        bodyHtml = `<div class="sidebar-empty">No incoming friend requests right now.</div>`;
      } else {
        bodyHtml = recList.map((item) => {
          const u = item.user;
          return `
            <div class="chat-row" data-open-user="${escapeHtml(u.username)}" role="listitem">
              <div class="avatar-wrap">
                <div class="avatar" style="background: ${escapeHtml(u.avatarColor || 'var(--accent)')}">
                  ${u.avatarUrl ? `<img src="${escapeHtml(u.avatarUrl)}" alt=""/>` : escapeHtml(initialsFor(u))}
                </div>
              </div>
              <div class="chat-row-body">
                <div class="chat-row-top">
                  <span class="chat-row-name">${escapeHtml(u.displayName || u.username)}</span>
                </div>
                <div class="chat-row-bottom">
                  <span class="chat-row-sub">@${escapeHtml(u.username)} wants to be friends</span>
                  <div class="friend-row-btns">
                    <button type="button" class="friend-action-btn primary" data-friend-action="accept" data-friend-user="${escapeHtml(u.username)}">Accept</button>
                    <button type="button" class="friend-action-btn secondary" data-friend-action="decline" data-friend-user="${escapeHtml(u.username)}">Decline</button>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    } else {
      if (friendsList.length === 0) {
        bodyHtml = `
          <div class="sidebar-empty">
            No friends added yet.<br/>
            Search a person's exact <strong>@username</strong> or <strong>email</strong> above and send a friend request!
          </div>
        `;
      } else {
        bodyHtml = friendsList.map((u) => {
          const isOnline = state.onlineUsers.has(u.username) || u.online;
          return `
            <div class="chat-row" data-open-user="${escapeHtml(u.username)}" role="listitem">
              <div class="avatar-wrap">
                <div class="avatar" style="background: ${escapeHtml(u.avatarColor || 'var(--accent)')}">
                  ${u.avatarUrl ? `<img src="${escapeHtml(u.avatarUrl)}" alt=""/>` : escapeHtml(initialsFor(u))}
                </div>
                ${isOnline ? '<span class="online-dot"></span>' : ''}
              </div>
              <div class="chat-row-body">
                <div class="chat-row-top">
                  <span class="chat-row-name">${escapeHtml(u.displayName || u.username)}</span>
                  <span class="chat-row-time">${isOnline ? 'online' : ''}</span>
                </div>
                <div class="chat-row-bottom">
                  <span class="chat-row-sub">@${escapeHtml(u.username)}</span>
                  <button type="button" class="friend-action-btn danger" data-friend-action="unfriend" data-friend-user="${escapeHtml(u.username)}">Unfriend</button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    els.sidebarList.innerHTML = `${subTabsHtml}${bodyHtml}`;
  }

  function renderSidebar() {
    const trimmedQuery = state.searchQuery.trim();
    const isSearching = trimmedQuery.length > 0 || state.browseMode;
    els.clearSearchBtn.classList.toggle('hidden', !trimmedQuery && !state.browseMode);

    if (els.sidebarTabs) {
      els.sidebarTabs.classList.toggle('hidden', isSearching);
      els.sidebarTabs.querySelectorAll('[data-chat-filter]').forEach((tabBtn) => {
        tabBtn.classList.toggle('active', tabBtn.dataset.chatFilter === state.sidebarFilter);
      });
    }
    updateGlobalUnreadCounters();

    if (isSearching) {
      els.sidebarSectionTitle.classList.remove('hidden');
      els.sidebarSectionTitle.textContent = trimmedQuery
        ? `Exact Match (${state.searchResults.length})`
        : 'Find Someone';

      if (!trimmedQuery) {
        els.sidebarList.innerHTML = `
          <div class="sidebar-empty">
            Type an <strong>exact @username</strong> or <strong>exact email</strong> in the search box above.<br/>
            User directories are hidden for privacy.
          </div>
        `;
        return;
      }

      if (state.searchResults.length === 0) {
        els.sidebarList.innerHTML = `
          <div class="sidebar-empty">
            No user found with exact username or email "<strong>${escapeHtml(trimmedQuery)}</strong>".<br/>
            Make sure you entered the full @username or email address.
          </div>
        `;
        return;
      }

      els.sidebarList.innerHTML = state.searchResults.map((user) => {
        const isOnline = state.onlineUsers.has(user.username) || user.online;
        const isActive = state.activePeer && state.activePeer.username === user.username;
        const rel = user.relationship || getRelationshipForUser(user.username);
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
                <span class="chat-row-sub">@${escapeHtml(user.username)}</span>
                <div class="friend-row-btns">
                  ${renderFriendActionBtnHtml(user.username, rel)}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
      return;
    }

    if (state.sidebarFilter === 'friends') {
      renderFriendsSidebarPanel();
      return;
    }

    els.sidebarSectionTitle.classList.add('hidden');
    const archivedChats = state.chats.filter((c) => c.isArchived);
    const unarchivedChats = state.chats.filter((c) => !c.isArchived);
    const isArchivedView = state.sidebarFilter === 'archived';
    const visibleChats = isArchivedView
      ? archivedChats
      : (state.sidebarFilter === 'unread'
        ? unarchivedChats.filter((c) => Number(c.unreadCount || 0) > 0)
        : unarchivedChats);

    if (state.chats.length === 0 && !isArchivedView) {
      els.sidebarList.innerHTML = `
        <div class="sidebar-empty">
          No conversations yet.<br/>
          Search someone by exact <strong>@username</strong> or <strong>email</strong> above to add friends and chat!
          <div>
            <button id="empty-browse-btn" class="secondary-btn" type="button">Find by Username / Email</button>
          </div>
        </div>
      `;
      const btn = $('empty-browse-btn');
      if (btn) btn.addEventListener('click', triggerBrowseUsers);
      return;
    }

    if (visibleChats.length === 0 && state.sidebarFilter === 'unread') {
      els.sidebarList.innerHTML = `
        <div class="sidebar-empty">
          All caught up! No unread messages.<br/>
          <div>
            <button id="empty-all-chats-btn" class="secondary-btn" type="button">Show All Chats</button>
          </div>
        </div>
      `;
      const showAllBtn = $('empty-all-chats-btn');
      if (showAllBtn) {
        showAllBtn.addEventListener('click', () => {
          state.sidebarFilter = 'all';
          renderSidebar();
        });
      }
      return;
    }

    let headerBannerHtml = '';
    if (isArchivedView) {
      headerBannerHtml = `
        <div class="archived-nav-bar" data-archived-back="1" role="button" tabindex="0">
          <span class="archived-nav-back">← All Chats</span>
          <span class="archived-nav-title">📦 Archived (${archivedChats.length})</span>
        </div>
      `;
      if (archivedChats.length === 0) {
        els.sidebarList.innerHTML = `${headerBannerHtml}
          <div class="sidebar-empty">
            No archived chats.<br/>
            Right-click or long-press a chat to archive it.
            <div>
              <button id="empty-all-chats-btn" class="secondary-btn" type="button">Back to All Chats</button>
            </div>
          </div>
        `;
        const showAllBtn = $('empty-all-chats-btn');
        if (showAllBtn) {
          showAllBtn.addEventListener('click', () => {
            state.sidebarFilter = 'all';
            renderSidebar();
          });
        }
        return;
      }
    } else if (state.sidebarFilter === 'all' && archivedChats.length > 0) {
      const archivedUnread = archivedChats.reduce((sum, c) => sum + Number(c.unreadCount || 0), 0);
      const previewNames = archivedChats
        .slice(0, 3)
        .map((c) => {
          if (c.type === 'group' || c.type === 'channel') return c.title || 'Group';
          return (c.peer && (c.peer.displayName || c.peer.username)) || 'Chat';
        })
        .join(', ');
      const extraCount = archivedChats.length > 3 ? ` +${archivedChats.length - 3}` : '';
      headerBannerHtml = `
        <div class="chat-row archived-folder-row" data-open-archived="1" role="button" tabindex="0">
          <div class="avatar-wrap">
            <div class="avatar archived-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"/>
                <rect x="1" y="3" width="22" height="5"/>
                <line x1="10" y1="12" x2="14" y2="12"/>
              </svg>
            </div>
          </div>
          <div class="chat-row-body">
            <div class="chat-row-top">
              <span class="chat-row-name">Archived Chats</span>
              <span class="chat-row-time">${archivedChats.length} chat${archivedChats.length === 1 ? '' : 's'}</span>
            </div>
            <div class="chat-row-bottom">
              <span class="chat-row-preview">${escapeHtml(previewNames + extraCount)}</span>
              ${archivedUnread > 0 ? `<span class="unread-badge muted">${escapeHtml(formatCompactCount(archivedUnread))}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }

    const rowsHtml = visibleChats.map((chat) => {
      const isSaved = chat.type === 'saved';
      const isRoom = chat.type === 'group' || chat.type === 'channel';
      const peer = chat.peer;
      const isOnline = !isRoom && !isSaved && peer && (state.onlineUsers.has(peer.username) || peer.online);
      const isActive = state.activeChatId === chat.id;
      const isTyping = state.typingPeers.has(chat.id);
      const last = chat.lastMessage;
      const draftObj = state.drafts[chat.id];
      const draftText = draftObj && draftObj.text ? draftObj.text.trim() : '';
      let previewHtml = escapeHtml(isSaved ? 'Personal cloud notes & files' : (isRoom ? (chat.description || 'No messages yet') : 'Start chatting...'));
      if (isTyping) {
        previewHtml = escapeHtml('typing...');
      } else if (draftText) {
        previewHtml = `<span class="draft-prefix">Draft:</span> ${escapeHtml(draftText.replace(/\s+/g, ' '))}`;
      } else if (last) {
        const prefix = last.sender === state.me.username
          ? (isSaved ? '' : 'You: ')
          : (isRoom && last.sender && last.sender !== 'system' ? `${last.sender}: ` : '');
        previewHtml = escapeHtml(`${prefix}${last.preview || ''}`);
      }
      const timeStr = last ? formatSidebarTime(last.createdAt) : '';
      const unread = Number(chat.unreadCount || 0);
      const avatarSeed = isSaved
        ? { displayName: 'Saved Messages', avatarColor: 'var(--accent)' }
        : (isRoom ? { displayName: chat.title, avatarColor: chat.avatarColor || 'var(--accent)' } : peer);
      const rowTitle = isSaved ? 'Saved Messages' : (isRoom ? chat.title : (peer.displayName || peer.username));
      const roomTag = isRoom
        ? `<span class="room-kind-tag">${chat.type === 'channel' ? 'Channel' : 'Group'}</span>`
        : '';
      const prefBadges = `${chat.isPinned ? '<span class="chat-pin-badge" title="Pinned chat">📌</span>' : ''}${chat.isMuted ? '<span class="chat-mute-badge" title="Muted">🔇</span>' : ''}`;
      const openAttr = (isRoom || isSaved)
        ? `data-open-chat="${escapeHtml(chat.id)}"`
        : `data-open-user="${escapeHtml(peer.username)}"`;
      const avatarInner = isSaved
        ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
        : (!isRoom && peer && peer.avatarUrl ? `<img src="${escapeHtml(peer.avatarUrl)}" alt=""/>` : escapeHtml(initialsFor(avatarSeed)));

      const isChatSelected = state.chatSelectMode && state.selectedChatIds.has(chat.id);
      const selectChatChk = state.chatSelectMode
        ? `<span class="chat-select-check">${isChatSelected ? '✓' : ''}</span>`
        : '';
      const unarchiveBtnHtml = isArchivedView && !state.chatSelectMode
        ? `<button type="button" class="chat-unarchive-btn" data-quick-unarchive="${escapeHtml(chat.id)}" title="Unarchive chat">Unarchive</button>`
        : '';

      return `
        <div class="chat-row ${isActive ? 'active' : ''}${chat.isPinned ? ' is-pinned' : ''}${state.chatSelectMode ? ' select-mode' : ''}${isChatSelected ? ' selected' : ''}" data-chat-id="${escapeHtml(chat.id)}" ${openAttr} role="listitem" tabindex="0">
          ${selectChatChk}
          <div class="avatar-wrap">
            <div class="avatar${isSaved ? ' saved-avatar' : ''}" style="background: ${escapeHtml((avatarSeed && avatarSeed.avatarColor) || 'var(--accent)')}">
              ${avatarInner}
            </div>
            ${isOnline ? '<span class="online-dot"></span>' : ''}
          </div>
          <div class="chat-row-body">
            <div class="chat-row-top">
              <span class="chat-row-name">${roomTag}${escapeHtml(rowTitle)}${prefBadges}</span>
              <span class="chat-row-time">${escapeHtml(timeStr)}</span>
            </div>
            <div class="chat-row-bottom">
              <span class="chat-row-preview">${previewHtml}</span>
              ${unarchiveBtnHtml}
              ${unread > 0 ? `<span class="unread-badge${chat.isMuted ? ' muted' : ''}">${escapeHtml(formatCompactCount(unread))}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    const emptyAllWithArchive = !isArchivedView && visibleChats.length === 0 && archivedChats.length > 0
      ? `<div class="sidebar-empty">All your chats are in <strong>Archived Chats</strong> above.</div>`
      : '';

    els.sidebarList.innerHTML = `${headerBannerHtml}${rowsHtml}${emptyAllWithArchive}`;
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
    state.searchResults = [];
    els.sidebarSearch.value = '';
    els.sidebarSearch.focus();
    renderSidebar();
  }

  async function refreshFriends() {
    if (!state.me) return;
    try {
      const data = await api('/api/friends');
      state.friends = data.friends || [];
      state.friendRequestsSent = data.sent || [];
      state.friendRequestsReceived = data.received || [];
      for (const f of state.friends) {
        if (f.online) state.onlineUsers.add(f.username);
      }
      if (state.activePeer) {
        state.activePeer.relationship = getRelationshipForUser(state.activePeer.username);
        if (state.infoOpen) renderInfoDrawer();
      }
      if (state.searchResults.length > 0) {
        for (const u of state.searchResults) {
          u.relationship = getRelationshipForUser(u.username);
        }
      }
      renderSidebar();
    } catch {
      // Ignore transient errors
    }
  }

  async function performFriendAction(action, targetUsername) {
    const clean = String(targetUsername || '').trim().toLowerCase();
    if (!clean) return;
    try {
      if (action === 'request') {
        const res = await api('/api/friends/request', { method: 'POST', body: { targetUsername: clean } });
        showToast(res.status === 'friends' ? `You and @${clean} are now friends!` : `Friend request sent to @${clean}`, 'success');
      } else if (action === 'accept') {
        await api('/api/friends/accept', { method: 'POST', body: { username: clean } });
        showToast(`Accepted @${clean}'s friend request!`, 'success');
      } else if (action === 'decline') {
        await api('/api/friends/decline', { method: 'POST', body: { username: clean } });
        showToast(`Declined @${clean}'s request.`);
      } else if (action === 'cancel') {
        await api('/api/friends/cancel', { method: 'POST', body: { username: clean } });
        showToast(`Cancelled friend request to @${clean}.`);
      } else if (action === 'unfriend') {
        await api(`/api/friends/${encodeURIComponent(clean)}`, { method: 'DELETE' });
        showToast(`Unfriended @${clean}.`);
      }
      await refreshFriends();
    } catch (err) {
      showToast(err.message, 'error');
    }
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
    if (!state.activeChatId || (!state.activePeer && !state.activeRoom && (!state.activeChatMeta || state.activeChatMeta.type !== 'saved'))) return;
    const isTyping = state.typingPeers.has(state.activeChatId);

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

    if (state.activeChatMeta && state.activeChatMeta.type === 'saved') {
      els.chatPeerDot.classList.add('hidden');
      els.chatPeerStatus.textContent = 'Personal cloud notes & files';
      if (state.infoOpen) els.infoStatus.textContent = 'Personal Cloud';
      return;
    }

    if (state.activeRoom) {
      els.chatPeerDot.classList.add('hidden');
      const count = state.activeRoom.memberCount || (Array.isArray(state.activeRoom.members) ? state.activeRoom.members.length : 1);
      const kindLabel = state.activeRoom.type === 'channel' ? 'Channel' : 'Group';
      const statusText = isTyping ? 'someone is typing...' : `${kindLabel} • ${count} member${count === 1 ? '' : 's'}`;
      els.chatPeerStatus.textContent = statusText;
      if (isTyping) els.chatPeerStatus.classList.add('typing');
      if (state.infoOpen) {
        els.infoStatus.textContent = `${kindLabel} • ${count} member${count === 1 ? '' : 's'}`;
      }
      return;
    }

    const isOnline = state.onlineUsers.has(state.activePeer.username) || state.activePeer.online;
    els.chatPeerDot.classList.toggle('hidden', !isOnline);

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

  function updateComposerSendMicToggle() {
    if (!els.sendBtn || !els.voiceRecBtn) return;
    const hasText = Boolean(els.messageInput && els.messageInput.value.trim());
    const hasFiles = Array.isArray(state.pendingFiles) && state.pendingFiles.length > 0;
    const isEditing = Boolean(state.editingMessage);
    const showSend = hasText || hasFiles || isEditing;
    els.sendBtn.classList.toggle('hidden', !showSend);
    els.voiceRecBtn.classList.toggle('hidden', showSend);
  }

  function renderPinnedBar() {
    if (!els.pinnedMsgBar || !els.pinnedMsgPreview) return;
    const p = state.pinnedMessage;
    if (!p || !p.id) {
      els.pinnedMsgBar.classList.add('hidden');
      els.pinnedMsgPreview.textContent = '';
      return;
    }
    const senderPrefix = p.sender ? `@${p.sender}: ` : '';
    els.pinnedMsgPreview.textContent = `${senderPrefix}${p.text || 'Attachment'}`;
    els.pinnedMsgBar.classList.remove('hidden');
  }

  function syncComposerAccessForActiveChat() {
    const composerEl = typeof document !== 'undefined' ? document.querySelector('.composer') : null;
    const isChannel = state.activeRoom && state.activeRoom.type === 'channel';
    const isSaved = state.activeChatMeta && state.activeChatMeta.type === 'saved';
    const isAdmin = isChannel && state.me && Array.isArray(state.activeRoom.admins) && state.activeRoom.admins.includes(state.me.username);
    const readOnly = Boolean(isChannel && !isAdmin);

    const peer = state.activePeer;
    const isDeletedPeer = Boolean(peer && peer.deleted);
    const isBlockedByMe = Boolean(peer && peer.blockedByMe);
    const isBlockedByPeer = Boolean(peer && peer.blockedByPeer);
    const blockedDm = !isSaved && !state.activeRoom && (isDeletedPeer || isBlockedByMe || isBlockedByPeer);

    if (els.channelReadonlyBar) {
      els.channelReadonlyBar.classList.toggle('hidden', !readOnly);
    }
    if (els.dmBlockedBar) {
      els.dmBlockedBar.classList.toggle('hidden', !blockedDm);
      if (blockedDm && els.dmBlockedText) {
        if (isDeletedPeer) els.dmBlockedText.textContent = 'This account has been deleted.';
        else if (isBlockedByMe) els.dmBlockedText.textContent = 'You blocked this user.';
        else els.dmBlockedText.textContent = 'You cannot send messages to this user.';
      }
      if (els.dmUnblockInlineBtn) {
        els.dmUnblockInlineBtn.classList.toggle('hidden', !(isBlockedByMe && !isDeletedPeer));
      }
    }
    if (composerEl) {
      composerEl.classList.toggle('hidden', readOnly || blockedDm);
    }
    if (els.callAudioBtn) els.callAudioBtn.classList.toggle('hidden', Boolean(state.activeRoom || isSaved || blockedDm));
    if (els.callVideoBtn) els.callVideoBtn.classList.toggle('hidden', Boolean(state.activeRoom || isSaved || blockedDm));
    if (els.openGamesBtn) els.openGamesBtn.classList.toggle('hidden', readOnly || Boolean(isSaved || blockedDm));
    updateComposerSendMicToggle();
  }

  async function applyOpenedChat(data) {
    const chat = data.chat;
    const isSaved = chat.type === 'saved';
    const isRoom = chat.type === 'group' || chat.type === 'channel';

    state.activeChatId = chat.id;
    state.activeChatMeta = chat;
    state.activePeer = (isRoom || isSaved) ? null : chat.peer;
    state.activeRoom = isRoom ? chat : null;
    state.pinnedMessage = chat.pinnedMessage || null;
    state.messages = data.messages || [];
    state.unreadBelowCount = 0;
    state.userScrolledSinceOpen = false;
    state.editingMessage = null;
    state.selectMode = false;
    state.selectedMsgIds.clear();
    if (els.editBanner) els.editBanner.classList.add('hidden');
    if (els.multiSelectBar) els.multiSelectBar.classList.add('hidden');

    const firstUnread = state.me
      ? state.messages.find((m) => m.sender !== 'system' && m.sender !== state.me.username && (!Array.isArray(m.readBy) || !m.readBy.includes(state.me.username)))
      : null;
    state.firstUnreadMsgId = firstUnread ? firstUnread.id : null;
    state.replyTo = null;
    els.replyBanner.classList.add('hidden');
    state.chatSearch = { open: false, query: '', matches: [], index: -1 };
    els.chatSearchBar.classList.add('hidden');
    els.chatSearchInput.value = '';
    els.chatSearchCount.textContent = '0 / 0';
    if (els.mentionPopover) els.mentionPopover.classList.add('hidden');

    const savedDraft = state.drafts[state.activeChatId];
    els.messageInput.value = savedDraft && savedDraft.text ? savedDraft.text : '';
    if (state.pendingShare) {
      await applyPendingShareToActiveChat();
    }

    if (state.activePeer && state.activePeer.online) {
      state.onlineUsers.add(state.activePeer.username);
    }

    els.chatEmptyState.classList.add('hidden');
    els.activeChat.classList.remove('hidden');
    els.appShell.classList.add('mobile-chat-open');

    autoResizeInput();
    requestAnimationFrame(() => autoResizeInput());

    if (isSaved) {
      if (els.chatPeerAvatar) {
        els.chatPeerAvatar.classList.add('saved-avatar');
        els.chatPeerAvatar.style.background = 'var(--accent)';
        els.chatPeerAvatar.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
      }
      els.chatPeerName.textContent = 'Saved Messages';
    } else if (isRoom) {
      if (els.chatPeerAvatar) els.chatPeerAvatar.classList.remove('saved-avatar');
      renderAvatar(els.chatPeerAvatar, { displayName: chat.title, avatarColor: chat.avatarColor || 'var(--accent)' });
      els.chatPeerName.textContent = chat.title || 'Group';
    } else {
      if (els.chatPeerAvatar) els.chatPeerAvatar.classList.remove('saved-avatar');
      renderAvatar(els.chatPeerAvatar, state.activePeer);
      els.chatPeerName.textContent = state.activePeer.displayName || state.activePeer.username;
    }
    syncComposerAccessForActiveChat();
    updateChatHeaderStatus();
    renderPinnedBar();

    renderMessages(false);
    restoreChatScrollPosition(state.activeChatId);
    if (state.infoOpen) renderInfoDrawer();
    renderSidebar();

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
    } else if (!els.channelReadonlyBar || els.channelReadonlyBar.classList.contains('hidden')) {
      els.messageInput.focus();
    }
  }

  async function openSavedMessages() {
    try {
      if (state.activeChatId) {
        saveCurrentChatScroll();
        if (els.messageInput) {
          saveChatDraft(state.activeChatId, els.messageInput.value);
        }
      }
      const data = await api('/api/chats/open', {
        method: 'POST',
        body: { type: 'saved' }
      });
      await applyOpenedChat(data);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function openChatWithUser(targetUsername) {
    try {
      if (state.activeChatId) {
        saveCurrentChatScroll();
        if (els.messageInput) {
          saveChatDraft(state.activeChatId, els.messageInput.value);
        }
      }
      const data = await api('/api/chats/open', {
        method: 'POST',
        body: { targetUsername }
      });
      await applyOpenedChat(data);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function openRoomById(chatId) {
    try {
      if (state.activeChatId) {
        saveCurrentChatScroll();
        if (els.messageInput) {
          saveChatDraft(state.activeChatId, els.messageInput.value);
        }
      }
      const data = await api('/api/chats/open', {
        method: 'POST',
        body: { chatId }
      });
      await applyOpenedChat(data);
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

  const VOICE_SPEEDS = [1, 1.5, 2];
  const voicePlayerState = {
    audio: null,
    msgId: null,
    url: null,
    speedIdx: 0,
    rafId: null
  };

  function formatVoiceTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(s / 60);
    const secs = String(s % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function getVoicePeaks(msg, att) {
    if (msg && msg.voiceMeta && Array.isArray(msg.voiceMeta.peaks) && msg.voiceMeta.peaks.length >= 8) {
      return msg.voiceMeta.peaks;
    }
    const seedSrc = String((msg && msg.id) || (att && att.storedName) || 'voice');
    let h = 2166136261;
    for (let i = 0; i < seedSrc.length; i++) {
      h ^= seedSrc.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const bars = [];
    for (let i = 0; i < 28; i++) {
      h ^= (h << 13);
      h ^= (h >>> 17);
      h ^= (h << 5);
      const env = Math.sin(((i + 1) / 29) * Math.PI);
      const val = Math.round(18 + ((h >>> 0) % 58) * (0.45 + 0.55 * env));
      bars.push(Math.max(14, Math.min(96, val)));
    }
    return bars;
  }

  function formatTtlShort(seconds) {
    const s = Math.max(0, Math.ceil(Number(seconds) || 0));
    if (s < 60) return `${s}s`;
    if (s < 3600) {
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return s < 120 ? `${m}:${String(rem).padStart(2, '0')}` : `${m}m`;
    }
    if (s < 86400) return `${Math.ceil(s / 3600)}h`;
    return `${Math.ceil(s / 86400)}d`;
  }

  function formatTtlFromIso(expiresAt) {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return '0s';
    return formatTtlShort(ms / 1000);
  }

  function getComposeTimerPayload() {
    const m = state.composeTimerMode || 'off';
    if (m === 'viewOnce') return { viewOnce: true, ttlSeconds: 0 };
    const sec = Number(m);
    if (Number.isFinite(sec) && sec > 0) return { viewOnce: false, ttlSeconds: sec };
    return { viewOnce: false, ttlSeconds: 0 };
  }

  function syncComposerTimerUi() {
    const mode = state.composeTimerMode || 'off';
    if (els.msgTimerBtn) {
      els.msgTimerBtn.classList.toggle('active', mode !== 'off');
    }
    if (els.msgTimerPill) {
      if (mode === 'off') {
        els.msgTimerPill.classList.add('hidden');
        els.msgTimerPill.textContent = '';
      } else {
        const labels = { viewOnce: '1x', '10': '10s', '60': '1m', '3600': '1h', '86400': '24h' };
        els.msgTimerPill.textContent = labels[mode] || mode;
        els.msgTimerPill.classList.remove('hidden');
      }
    }
    if (els.msgTimerPopover) {
      els.msgTimerPopover.querySelectorAll('[data-timer-mode]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.timerMode === mode);
      });
    }
  }

  function syncVoicePlayerDom(msgId) {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.voice-player[data-voice-msg]').forEach((card) => {
      const id = card.dataset.voiceMsg;
      const isCurrent = id === voicePlayerState.msgId;
      const audio = voicePlayerState.audio;
      const isPlaying = isCurrent && audio && !audio.paused && !audio.ended;
      card.classList.toggle('is-playing', Boolean(isPlaying));

      const speedBtn = card.querySelector('.voice-speed-btn');
      const rate = VOICE_SPEEDS[voicePlayerState.speedIdx] || 1;
      if (speedBtn) {
        speedBtn.textContent = isCurrent ? `${rate}x` : '1x';
        speedBtn.classList.toggle('boosted', isCurrent && rate !== 1);
      }

      const fallbackDur = Number(card.dataset.voiceDuration) || 0;
      const duration = isCurrent && audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : fallbackDur;
      const currentTime = isCurrent && audio ? (audio.currentTime || 0) : 0;
      const pct = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

      const timeEl = card.querySelector('.voice-time');
      if (timeEl) {
        timeEl.textContent = isCurrent && (currentTime > 0 || isPlaying)
          ? `${formatVoiceTime(currentTime)} / ${formatVoiceTime(duration)}`
          : (duration > 0 ? formatVoiceTime(duration) : '0:00');
      }

      const bars = card.querySelectorAll('.voice-bar');
      const activeCount = Math.round(pct * bars.length);
      bars.forEach((b, idx) => {
        b.classList.toggle('played', isCurrent && idx < activeCount);
      });
    });
  }

  function stopVoicePlayback() {
    if (voicePlayerState.rafId) {
      cancelAnimationFrame(voicePlayerState.rafId);
      voicePlayerState.rafId = null;
    }
    if (voicePlayerState.audio) {
      try { voicePlayerState.audio.pause(); } catch { }
    }
    const prevId = voicePlayerState.msgId;
    voicePlayerState.msgId = null;
    voicePlayerState.url = null;
    if (prevId) syncVoicePlayerDom(prevId);
  }

  function ensureVoiceAudioElement() {
    if (voicePlayerState.audio) return voicePlayerState.audio;
    const audio = new Audio();
    audio.preload = 'metadata';
    const step = () => {
      if (!voicePlayerState.audio || voicePlayerState.audio.paused || voicePlayerState.audio.ended) {
        voicePlayerState.rafId = null;
        syncVoicePlayerDom();
        return;
      }
      syncVoicePlayerDom();
      voicePlayerState.rafId = requestAnimationFrame(step);
    };
    audio.addEventListener('play', () => {
      syncVoicePlayerDom();
      if (!voicePlayerState.rafId) voicePlayerState.rafId = requestAnimationFrame(step);
    });
    audio.addEventListener('pause', () => {
      if (voicePlayerState.rafId) {
        cancelAnimationFrame(voicePlayerState.rafId);
        voicePlayerState.rafId = null;
      }
      syncVoicePlayerDom();
    });
    audio.addEventListener('loadedmetadata', () => {
      if (voicePlayerState.msgId && Number.isFinite(audio.duration) && audio.duration > 0) {
        const card = document.querySelector(`.voice-player[data-voice-msg="${CSS && CSS.escape ? CSS.escape(voicePlayerState.msgId) : voicePlayerState.msgId}"]`);
        if (card) card.dataset.voiceDuration = String(Math.round(audio.duration));
      }
      syncVoicePlayerDom();
    });
    audio.addEventListener('ended', () => {
      if (voicePlayerState.rafId) {
        cancelAnimationFrame(voicePlayerState.rafId);
        voicePlayerState.rafId = null;
      }
      audio.currentTime = 0;
      voicePlayerState.msgId = null;
      syncVoicePlayerDom();
    });
    audio.addEventListener('error', () => {
      showToast('Could not play voice message.', 'error');
      stopVoicePlayback();
    });
    voicePlayerState.audio = audio;
    return audio;
  }

  async function toggleVoiceMessagePlay(msgId, url) {
    if (!url || typeof Audio === 'undefined') return;
    const audio = ensureVoiceAudioElement();
    if (voicePlayerState.msgId === msgId && voicePlayerState.url === url) {
      if (audio.paused) {
        audio.playbackRate = VOICE_SPEEDS[voicePlayerState.speedIdx] || 1;
        await audio.play().catch(() => {});
      } else {
        audio.pause();
      }
      return;
    }
    voicePlayerState.msgId = msgId;
    voicePlayerState.url = url;
    audio.src = url;
    audio.playbackRate = VOICE_SPEEDS[voicePlayerState.speedIdx] || 1;
    await audio.play().catch(() => {});
    syncVoicePlayerDom();
  }

  function seekVoiceMessage(msgId, url, fraction) {
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    const audio = ensureVoiceAudioElement();
    if (voicePlayerState.msgId !== msgId || voicePlayerState.url !== url) {
      voicePlayerState.msgId = msgId;
      voicePlayerState.url = url;
      audio.src = url;
      audio.playbackRate = VOICE_SPEEDS[voicePlayerState.speedIdx] || 1;
      audio.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = f * audio.duration;
        }
      }, { once: true });
      audio.play().catch(() => {});
      syncVoicePlayerDom();
      return;
    }
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = f * audio.duration;
      syncVoicePlayerDom();
    }
  }

  function cycleVoicePlaybackSpeed(msgId, url) {
    voicePlayerState.speedIdx = (voicePlayerState.speedIdx + 1) % VOICE_SPEEDS.length;
    const rate = VOICE_SPEEDS[voicePlayerState.speedIdx] || 1;
    if (voicePlayerState.audio) {
      voicePlayerState.audio.playbackRate = rate;
    }
    if (voicePlayerState.msgId !== msgId && url) {
      toggleVoiceMessagePlay(msgId, url);
    } else {
      syncVoicePlayerDom();
    }
  }

  function renderAttachmentsHtml(msg) {
    if (!Array.isArray(msg.attachments) || msg.attachments.length === 0) return '';
    const isRichStickerOrGif = !msg.text && msg.attachments.length === 1 && msg.attachments[0].isImage && (msg.kind === 'sticker' || msg.kind === 'gif' || msg.attachments[0].mimeType === 'image/gif');
    const items = msg.attachments.map((att) => {
      if (isRichStickerOrGif) {
        const isGif = msg.kind === 'gif' || att.mimeType === 'image/gif' || /\.gif$/i.test(att.originalName || '');
        return `
          <div class="msg-rich-media-wrap ${isGif ? 'is-gif' : 'is-sticker'}" data-lightbox-url="${escapeHtml(att.url)}" data-lightbox-name="${escapeHtml(att.originalName)}" data-lightbox-sender="${escapeHtml(msg.sender)}" data-lightbox-caption="">
            ${isGif ? '<span class="vr-gif-badge">GIF</span>' : ''}
            <img src="${escapeHtml(att.url)}" alt="${escapeHtml(att.originalName)}" loading="lazy" />
          </div>
        `;
      }
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
        const isVoice = /^voice-.*\.(webm|ogg|mp4|m4a|wav)$/i.test(String(att.originalName || '')) || Boolean(msg.voiceMeta);
        if (isVoice) {
          const peaks = getVoicePeaks(msg, att);
          const totalSec = msg.voiceMeta && msg.voiceMeta.durationSec ? Number(msg.voiceMeta.durationSec) : 0;
          const isCurrent = voicePlayerState.msgId === msg.id;
          const isPlaying = isCurrent && voicePlayerState.audio && !voicePlayerState.audio.paused;
          const curRate = VOICE_SPEEDS[voicePlayerState.speedIdx] || 1;
          const barsHtml = peaks.map((h) => `<span class="voice-bar" style="height:${Math.max(14, Math.min(100, h))}%"></span>`).join('');
          return `
            <div class="voice-player${isPlaying ? ' is-playing' : ''}" data-voice-msg="${escapeHtml(msg.id)}" data-voice-url="${escapeHtml(att.url)}" data-voice-duration="${totalSec}">
              <button type="button" class="voice-play-btn" data-voice-toggle="${escapeHtml(msg.id)}" aria-label="Play voice message">
                <svg class="voice-icon-play" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>
                <svg class="voice-icon-pause" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
              </button>
              <div class="voice-wave-body">
                <div class="voice-wave-track" data-voice-seek="${escapeHtml(msg.id)}" role="slider" aria-label="Voice progress" tabindex="0">
                  ${barsHtml}
                </div>
                <div class="voice-meta-row">
                  <span class="voice-time">${totalSec > 0 ? formatVoiceTime(totalSec) : '0:00'}</span>
                  <button type="button" class="voice-speed-btn${isCurrent && curRate !== 1 ? ' boosted' : ''}" data-voice-speed="${escapeHtml(msg.id)}" title="Playback speed">${isCurrent ? `${curRate}x` : '1x'}</button>
                </div>
              </div>
            </div>
          `;
        }
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

  function renderLinkPreviewHtml(msg) {
    const lp = msg && msg.linkPreview;
    if (!lp || !lp.url || (!lp.title && !lp.description && !lp.image)) return '';
    return `
      <a class="msg-link-preview" href="${escapeHtml(lp.url)}" target="_blank" rel="noopener noreferrer">
        <div class="msg-lp-body">
          ${lp.siteName ? `<div class="msg-lp-site">${escapeHtml(lp.siteName)}</div>` : ''}
          ${lp.title ? `<div class="msg-lp-title">${escapeHtml(lp.title)}</div>` : ''}
          ${lp.description ? `<div class="msg-lp-desc">${escapeHtml(lp.description)}</div>` : ''}
        </div>
        ${lp.image ? `<img class="msg-lp-thumb" src="${escapeHtml(lp.image)}" alt="" loading="lazy" />` : ''}
      </a>
    `;
  }

  let renderedMessagesChatId = null;
  let messageScratchEl = null;

  function parseMessageHtmlNode(html) {
    if (!messageScratchEl) messageScratchEl = document.createElement('div');
    messageScratchEl.innerHTML = html.trim();
    const node = messageScratchEl.firstElementChild;
    if (node && node.parentNode) messageScratchEl.removeChild(node);
    return node;
  }

  function triggerTransientClass(node, className, durationMs, timerKey) {
    if (!node || !node.classList) return;
    if (node[timerKey]) clearTimeout(node[timerKey]);
    node.classList.remove(className);
    if (typeof node.offsetWidth === 'number') void node.offsetWidth;
    node.classList.add(className);
    node[timerKey] = setTimeout(() => {
      node.classList.remove(className);
      node[timerKey] = null;
    }, durationMs);
  }

  function snapshotReactionChips(container) {
    const map = new Map();
    if (!container || typeof container.querySelectorAll !== 'function') return map;
    for (const chip of container.querySelectorAll('.reaction-chip[data-emoji]')) {
      const emoji = chip.getAttribute('data-emoji') || '';
      const countEl = chip.querySelector('span');
      const count = countEl ? Number(countEl.textContent) || 1 : 1;
      map.set(emoji, { count, mine: chip.classList.contains('mine') });
    }
    return map;
  }

  function animateChangedReactionChips(container, prevMap) {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    for (const chip of container.querySelectorAll('.reaction-chip[data-emoji]')) {
      const emoji = chip.getAttribute('data-emoji') || '';
      const prev = prevMap ? prevMap.get(emoji) : null;
      const countEl = chip.querySelector('span');
      const count = countEl ? Number(countEl.textContent) || 1 : 1;
      const mine = chip.classList.contains('mine');
      if (!prev || (mine && !prev.mine) || count > prev.count) {
        triggerTransientClass(chip, 'reaction-pop', 320, '_reactAnimTimer');
      }
    }
  }

  function syncRowOuterState(existingEl, item) {
    const preserved = [];
    for (const cls of ['msg-enter', 'msg-updated', 'highlight-pulse', 'search-match', 'menu-active']) {
      if (existingEl.classList.contains(cls)) preserved.push(cls);
    }
    existingEl.className = `${item.baseClassName}${preserved.length ? ' ' + preserved.join(' ') : ''}`;
    let checkEl = existingEl.querySelector(':scope > .msg-select-check');
    if (!checkEl) {
      for (const child of Array.from(existingEl.children || [])) {
        if (child.classList && child.classList.contains('msg-select-check')) {
          checkEl = child;
          break;
        }
      }
    }
    if (state.selectMode) {
      if (!checkEl) {
        checkEl = document.createElement('span');
        checkEl.className = 'msg-select-check';
        existingEl.insertBefore(checkEl, existingEl.firstElementChild || null);
      }
      checkEl.textContent = item.isSelected ? '✓' : '';
    } else if (checkEl) {
      checkEl.remove();
    }
  }

  function patchReadTicksInPlace(existingBubble, nextBubble) {
    const existingTicks = existingBubble.querySelector('.read-ticks');
    const nextTicks = nextBubble.querySelector('.read-ticks');
    if (existingTicks && nextTicks) {
      const becameRead = !existingTicks.classList.contains('read') && nextTicks.classList.contains('read');
      existingTicks.className = nextTicks.className;
      existingTicks.title = nextTicks.title;
      existingTicks.textContent = nextTicks.textContent;
      if (becameRead) {
        triggerTransientClass(existingTicks, 'read-pop', 340, '_tickAnimTimer');
      }
    } else if (!existingTicks && nextTicks) {
      const footer = existingBubble.querySelector('.msg-footer');
      if (footer) footer.appendChild(nextTicks);
    }
  }

  function patchBubbleReactionsInPlace(existingBubble, nextBubble) {
    const prevMap = snapshotReactionChips(existingBubble);
    const prevReactions = existingBubble.querySelector('.msg-reactions');
    const nextReactions = nextBubble.querySelector('.msg-reactions');
    if (!nextReactions) {
      if (prevReactions) prevReactions.remove();
      return;
    }
    if (prevReactions) {
      prevReactions.replaceWith(nextReactions);
    } else {
      const footer = existingBubble.querySelector('.msg-footer');
      if (footer) existingBubble.insertBefore(nextReactions, footer);
      else existingBubble.appendChild(nextReactions);
    }
    animateChangedReactionChips(existingBubble, prevMap);
  }

  function patchBubbleKeepingMedia(existingBubble, nextBubble) {
    const kept = existingBubble.querySelector('.msg-attachments') || existingBubble.querySelector('.vr-sticker-card');
    const keptSelector = kept
      ? (kept.classList.contains('msg-attachments') ? '.msg-attachments' : '.vr-sticker-card')
      : '';
    const nextKept = keptSelector ? nextBubble.querySelector(keptSelector) : null;
    existingBubble.className = nextBubble.className;
    if (!kept || !nextKept) {
      existingBubble.innerHTML = nextBubble.innerHTML;
      return;
    }
    const nextNodes = Array.from(nextBubble.childNodes);
    const pivotIdx = nextNodes.indexOf(nextKept);
    for (const child of Array.from(existingBubble.childNodes)) {
      if (child !== kept) existingBubble.removeChild(child);
    }
    for (let j = 0; j < pivotIdx; j++) {
      existingBubble.insertBefore(nextNodes[j], kept);
    }
    for (let j = pivotIdx + 1; j < nextNodes.length; j++) {
      existingBubble.appendChild(nextNodes[j]);
    }
  }

  function updateExistingMessageRow(existingEl, item) {
    const contentChanged = existingEl.dataset.contentSig !== item.contentSig;
    const mediaChanged = existingEl.dataset.mediaSig !== item.mediaSig;
    const reactionsChanged = existingEl.dataset.reactionsSig !== item.reactionsSig;
    const readChanged = existingEl.dataset.readSig !== item.readSig;
    const metaChanged = existingEl.dataset.metaSig !== item.metaSig;

    if (metaChanged) syncRowOuterState(existingEl, item);

    if (contentChanged || mediaChanged || reactionsChanged || readChanged) {
      const nextEl = parseMessageHtmlNode(item.html);
      const existingBubble = existingEl.querySelector('.msg-bubble');
      const nextBubble = nextEl ? nextEl.querySelector('.msg-bubble') : null;
      if (!existingBubble || !nextBubble) {
        if (nextEl) existingEl.innerHTML = nextEl.innerHTML;
      } else if (!contentChanged && !mediaChanged && !reactionsChanged && readChanged) {
        patchReadTicksInPlace(existingBubble, nextBubble);
      } else if (!contentChanged && !mediaChanged && reactionsChanged) {
        patchBubbleReactionsInPlace(existingBubble, nextBubble);
        if (readChanged) patchReadTicksInPlace(existingBubble, nextBubble);
      } else {
        const prevReactionsMap = reactionsChanged ? snapshotReactionChips(existingBubble) : null;
        if (!mediaChanged) {
          patchBubbleKeepingMedia(existingBubble, nextBubble);
        } else {
          existingBubble.className = nextBubble.className;
          existingBubble.innerHTML = nextBubble.innerHTML;
        }
        if (reactionsChanged) animateChangedReactionChips(existingBubble, prevReactionsMap);
        triggerTransientClass(existingEl, 'msg-updated', 560, '_updateAnimTimer');
      }
    }

    existingEl.dataset.renderSig = item.renderSig;
    existingEl.dataset.metaSig = item.metaSig;
    existingEl.dataset.contentSig = item.contentSig;
    existingEl.dataset.mediaSig = item.mediaSig;
    existingEl.dataset.reactionsSig = item.reactionsSig;
    existingEl.dataset.readSig = item.readSig;
  }

  function stampMessageDataset(node, item) {
    node.dataset.domKey = item.domKey;
    node.dataset.renderSig = item.renderSig;
    if (item.isMsgRow) {
      node.dataset.metaSig = item.metaSig;
      node.dataset.contentSig = item.contentSig;
      node.dataset.mediaSig = item.mediaSig;
      node.dataset.reactionsSig = item.reactionsSig;
      node.dataset.readSig = item.readSig;
    }
  }

  function renderMessages(scrollToBottom = false) {
    const msgs = state.messages;
    const isSaved = state.activeChatMeta && state.activeChatMeta.type === 'saved';
    const roomTitle = isSaved
      ? 'Saved Messages'
      : (state.activeRoom ? (state.activeRoom.title || 'this room') : (state.activePeer ? (state.activePeer.displayName || state.activePeer.username) : 'this chat'));
    const emptyHtml = isSaved
      ? `<div class="date-separator" data-dom-key="empty:state">Save notes, links, and files here to access them anywhere! 📌</div>`
      : `<div class="date-separator" data-dom-key="empty:state">No messages yet — say hi to ${escapeHtml(roomTitle)}! 👋</div>`;

    const canIncrementalDom = Boolean(
      typeof document !== 'undefined' &&
      typeof document.createElement === 'function' &&
      els.messagesList &&
      typeof els.messagesList.insertBefore === 'function'
    );
    const activeId = state.activeChatId || null;
    const isSameChat = canIncrementalDom && activeId !== null && renderedMessagesChatId === activeId;
    if (canIncrementalDom) renderedMessagesChatId = activeId;

    if (msgs.length === 0) {
      els.messagesList.innerHTML = emptyHtml;
      return;
    }

    let lastDateStr = '';
    const items = [];
    const roomProfiles = state.activeRoom && Array.isArray(state.activeRoom.members)
      ? new Map(state.activeRoom.members.filter((p) => p && p.username).map((p) => [p.username, p]))
      : null;

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const prev = msgs[i - 1];
      const next = msgs[i + 1];

      const dateStr = new Date(msg.createdAt).toDateString();
      if (dateStr !== lastDateStr) {
        lastDateStr = dateStr;
        const dateLabel = formatDateSeparator(msg.createdAt);
        items.push({
          domKey: `sep:${dateStr}`,
          renderSig: dateLabel,
          isMsgRow: false,
          html: `<div class="date-separator">${escapeHtml(dateLabel)}</div>`
        });
      }

      if (state.firstUnreadMsgId && msg.id === state.firstUnreadMsgId) {
        items.push({
          domKey: 'unread:divider',
          renderSig: state.firstUnreadMsgId,
          isMsgRow: false,
          html: '<div class="unread-divider">Unread Messages</div>'
        });
      }

      if (msg.kind === 'system' || msg.sender === 'system') {
        const sysText = msg.text || '';
        items.push({
          domKey: `msg:${msg.id}`,
          renderSig: sysText,
          isMsgRow: false,
          isSystemPill: true,
          html: `<div class="msg-system-pill" id="msg-${escapeHtml(msg.id)}" data-msg-id="${escapeHtml(msg.id)}">${escapeHtml(sysText)}</div>`
        });
        continue;
      }

      const isMine = msg.sender === state.me.username;
      const prevIsNormal = prev && prev.kind !== 'system' && prev.sender !== 'system';
      const nextIsNormal = next && next.kind !== 'system' && next.sender !== 'system';
      const samePrev = prevIsNormal && prev.sender === msg.sender && new Date(prev.createdAt).toDateString() === dateStr;
      const sameNext = nextIsNormal && next.sender === msg.sender && new Date(next.createdAt).toDateString() === dateStr;

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

      let readByOther = false;
      if (Array.isArray(msg.readBy)) {
        if (state.activePeer) {
          readByOther = msg.readBy.includes(state.activePeer.username);
        } else if (state.me) {
          readByOther = msg.readBy.some((u) => u !== state.me.username);
        }
      }
      const ticksHtml = isMine
        ? `<span class="read-ticks ${readByOther ? 'read' : ''}" title="${readByOther ? 'Read' : 'Sent'}">${readByOther ? '✓✓' : '✓'}</span>`
        : '';

      const actionsHtml = `
        <div class="msg-actions">
          ${QUICK_REACTIONS.map((e) => `<button class="msg-action-btn" type="button" data-react-msg="${escapeHtml(msg.id)}" data-emoji="${e}" title="React ${e}">${e}</button>`).join('')}
        </div>
      `;

      let senderHeaderHtml = '';
      if (state.activeRoom && !isMine && !samePrev) {
        const sp = roomProfiles ? roomProfiles.get(msg.sender) : null;
        const label = sp ? (sp.displayName || `@${sp.username}`) : `@${msg.sender}`;
        senderHeaderHtml = `<div class="msg-sender-name" style="color:${escapeHtml((sp && sp.avatarColor) || 'var(--accent)')}">${escapeHtml(label)}</div>`;
      }

      let gameCardHtml = '';
      if (msg.kind === 'game' && msg.game) {
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.renderGameBubbleHtml === 'function') {
          gameCardHtml = window.VibeRoomFeatures.renderGameBubbleHtml(msg);
        } else {
          gameCardHtml = `<div class="game-card-msg" data-open-game="${escapeHtml(msg.game.id)}"><strong>🎮 ${escapeHtml(msg.game.title || msg.game.type)}</strong><div>${escapeHtml(msg.game.status === 'finished' ? 'Finished' : `Turn: @${msg.game.turn}`)}</div></div>`;
        }
      }

      let callCardHtml = '';
      if (msg.kind === 'call' && msg.call) {
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.renderCallBubbleHtml === 'function') {
          callCardHtml = window.VibeRoomFeatures.renderCallBubbleHtml(msg);
        } else {
          callCardHtml = `<div class="call-log-msg">${escapeHtml(msg.text || 'Call')}</div>`;
        }
      }

      let pollCardHtml = '';
      if (msg.kind === 'poll' && msg.poll) {
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.renderPollBubbleHtml === 'function') {
          pollCardHtml = window.VibeRoomFeatures.renderPollBubbleHtml(msg);
        } else {
          pollCardHtml = `<div class="poll-card-fallback">📊 ${escapeHtml(msg.poll.question || 'Poll')}</div>`;
        }
      }

      const isSelected = state.selectMode && state.selectedMsgIds.has(msg.id);
      const fwdHeaderHtml = msg.forwardedFrom && msg.forwardedFrom.sender
        ? `<div class="msg-forwarded-header">↪ Forwarded from @${escapeHtml(msg.forwardedFrom.sender)}</div>`
        : '';
      const editedBadgeHtml = msg.editedAt
        ? `<span class="msg-edited-badge" title="Edited ${escapeHtml(formatTime(msg.editedAt))}">edited</span>`
        : '';
      const ttlBadgeHtml = msg.expiresAt
        ? `<span class="msg-ttl-badge" data-expires-at="${escapeHtml(msg.expiresAt)}" title="Self-destruct timer">⏱ ${escapeHtml(formatTtlFromIso(msg.expiresAt))}</span>`
        : '';
      const selectCheckHtml = state.selectMode
        ? `<span class="msg-select-check">${isSelected ? '✓' : ''}</span>`
        : '';

      let stickerCardHtml = '';
      if (msg.sticker && !msg.viewOnce) {
        if (window.VibeRoomStickers && typeof window.VibeRoomStickers.renderBubbleHtml === 'function') {
          stickerCardHtml = window.VibeRoomStickers.renderBubbleHtml(msg.sticker);
        } else {
          stickerCardHtml = `<div class="vr-sticker-fallback">${escapeHtml(msg.sticker.emoji || '🎭')}</div>`;
        }
      }

      let viewOnceCardHtml = '';
      if (msg.viewOnce) {
        const hint = msg.viewOnceHint || {};
        const typeLabel = hint.isVoice
          ? 'Voice Note'
          : (hint.hasImage ? 'Photo' : (hint.isVideo ? 'Video' : (hint.hasFile ? 'File' : 'Secret Message')));
        if (msg.consumed || msg.viewOnceState === 'consumed') {
          viewOnceCardHtml = `
            <div class="view-once-card is-consumed">
              <span class="view-once-icon">🔥</span>
              <span class="view-once-label">Opened • Self-destructed</span>
            </div>
          `;
        } else if (!isMine && msg.viewOnceState !== 'sent') {
          viewOnceCardHtml = `
            <button type="button" class="view-once-card is-sealed" data-open-view-once="${escapeHtml(msg.id)}">
              <span class="view-once-badge">1×</span>
              <div class="view-once-meta">
                <strong>View-Once ${escapeHtml(typeLabel)}</strong>
                <span>Tap to reveal once</span>
              </div>
            </button>
          `;
        } else {
          const opened = Array.isArray(msg.viewedBy) && msg.viewedBy.length > 0;
          viewOnceCardHtml = `
            <div class="view-once-card is-sent">
              <span class="view-once-badge">1×</span>
              <div class="view-once-meta">
                <strong>View-Once ${escapeHtml(typeLabel)}</strong>
                <span>${opened ? 'Opened by recipient' : 'Waiting to be opened'}</span>
              </div>
            </div>
          `;
        }
      }

      const isMediaStickerBubble = Boolean(
        !msg.viewOnce &&
        !msg.text &&
        (stickerCardHtml || (msg.attachments && msg.attachments.length === 1 && msg.attachments[0].isImage && (msg.kind === 'sticker' || msg.kind === 'gif' || msg.attachments[0].mimeType === 'image/gif')))
      );

      const showBodyText = Boolean(!msg.viewOnce && msg.text && msg.kind !== 'game' && msg.kind !== 'call' && msg.kind !== 'poll');
      const bubbleHtml = `
        <div class="msg-bubble${isMediaStickerBubble ? ' sticker-bubble' : ''}">
          ${fwdHeaderHtml}
          ${senderHeaderHtml}
          ${replyHtml}
          ${msg.viewOnce ? viewOnceCardHtml : `
            ${stickerCardHtml}
            ${renderAttachmentsHtml(msg)}
            ${gameCardHtml}
            ${callCardHtml}
            ${pollCardHtml}
            ${showBodyText ? `<div class="msg-text">${linkifyText(msg.text)}</div>` : ''}
            ${renderLinkPreviewHtml(msg)}
          `}
          ${renderReactionsHtml(msg)}
          <div class="msg-footer">
            ${ttlBadgeHtml}
            ${editedBadgeHtml}
            <span>${escapeHtml(formatTime(msg.createdAt))}</span>
            ${ticksHtml}
          </div>
        </div>
      `;

      const baseClassName = `msg-row ${groupClasses}${state.selectMode ? ' select-mode' : ''}${isSelected ? ' selected' : ''}`;
      const timeLabel = formatTime(msg.createdAt);
      const metaSig = `${baseClassName}|${timeLabel}|${isMediaStickerBubble ? '1' : '0'}`;
      const mediaSig = JSON.stringify([msg.kind || '', msg.sticker || null, msg.attachments || null, msg.voiceMeta || null, msg.viewOnce ? (msg.consumed ? '2' : (msg.viewOnceState || '1')) : '0']);
      const contentSig = JSON.stringify([
        msg.text || '',
        msg.editedAt || '',
        msg.replyTo || null,
        msg.forwardedFrom || null,
        msg.linkPreview || null,
        msg.game || null,
        msg.call || null,
        msg.poll || null,
        msg.viewOnce || false,
        msg.consumed || false,
        msg.viewedBy || null,
        msg.expiresAt || '',
        senderHeaderHtml
      ]);
      const reactionsSig = JSON.stringify(msg.reactions || null);
      const readSig = isMine ? (readByOther ? '2' : '1') : '0';

      items.push({
        domKey: `msg:${msg.id}`,
        isMsgRow: true,
        baseClassName,
        isSelected,
        metaSig,
        mediaSig,
        contentSig,
        reactionsSig,
        readSig,
        renderSig: `${metaSig}||${mediaSig}||${contentSig}||${reactionsSig}||${readSig}`,
        html: `
        <div class="${baseClassName}" id="msg-${escapeHtml(msg.id)}" data-msg-id="${escapeHtml(msg.id)}">
          ${selectCheckHtml}
          ${isMine ? actionsHtml + bubbleHtml : bubbleHtml + actionsHtml}
        </div>
      `
      });
    }

    if (!canIncrementalDom) {
      els.messagesList.innerHTML = items.map((i) => i.html).join('');
    } else if (!isSameChat) {
      els.messagesList.textContent = '';
      const frag = document.createDocumentFragment();
      for (const item of items) {
        const node = parseMessageHtmlNode(item.html);
        if (node) {
          stampMessageDataset(node, item);
          frag.appendChild(node);
        }
      }
      els.messagesList.appendChild(frag);
    } else {
      const existingByKey = new Map();
      const desiredKeys = new Set(items.map((i) => i.domKey));
      for (const child of Array.from(els.messagesList.children)) {
        const key = child.dataset ? child.dataset.domKey : '';
        if (!key || key.startsWith('__leaving__')) continue;
        if (!desiredKeys.has(key)) {
          if (child.classList.contains('msg-row') || child.classList.contains('msg-system-pill')) {
            child.dataset.domKey = `__leaving__${key}`;
            child.classList.add('msg-leaving');
            setTimeout(() => {
              if (child.parentNode === els.messagesList) child.remove();
            }, 170);
          } else {
            child.remove();
          }
          continue;
        }
        existingByKey.set(key, child);
      }

      const desiredNodes = [];
      for (const item of items) {
        const existing = existingByKey.get(item.domKey);
        if (!existing) {
          const node = parseMessageHtmlNode(item.html);
          if (!node) continue;
          stampMessageDataset(node, item);
          triggerTransientClass(node, 'msg-enter', 280, '_enterAnimTimer');
          desiredNodes.push(node);
        } else {
          if (existing.dataset.renderSig !== item.renderSig) {
            if (item.isMsgRow) {
              updateExistingMessageRow(existing, item);
            } else {
              const nextEl = parseMessageHtmlNode(item.html);
              if (nextEl) existing.innerHTML = nextEl.innerHTML;
              existing.dataset.renderSig = item.renderSig;
              if (item.isSystemPill) {
                triggerTransientClass(existing, 'msg-updated', 400, '_updateAnimTimer');
              }
            }
          }
          desiredNodes.push(existing);
        }
      }

      let cursor = els.messagesList.firstElementChild;
      while (cursor && cursor.classList && cursor.classList.contains('msg-leaving')) {
        cursor = cursor.nextElementSibling;
      }
      for (const node of desiredNodes) {
        if (node === cursor) {
          cursor = cursor.nextElementSibling;
          while (cursor && cursor.classList && cursor.classList.contains('msg-leaving')) {
            cursor = cursor.nextElementSibling;
          }
        } else {
          els.messagesList.insertBefore(node, cursor || null);
        }
      }
    }

    if (scrollToBottom) {
      state.pinToBottomUntil = Date.now() + 1800;
      state.userScrolledSinceOpen = false;
      instantScrollToBottom();
      requestAnimationFrame(() => {
        if (!state.userScrolledSinceOpen) instantScrollToBottom();
      });
    }
  }

  function isNearBottom(threshold = 140) {
    const vp = els.messagesViewport;
    return vp.scrollHeight - vp.scrollTop - vp.clientHeight < threshold;
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
      updateComposerSendMicToggle();
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
    updateComposerSendMicToggle();
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

  function startEditMessage(msgId) {
    const msg = state.messages.find((m) => m.id === msgId);
    if (!msg || !state.me || msg.sender !== state.me.username) return;
    if (msg.kind === 'game' || msg.kind === 'call') return;
    clearReply();
    clearPendingFiles();
    state.editingMessage = msg;
    if (els.editBannerText) els.editBannerText.textContent = msg.text || '';
    if (els.editBanner) els.editBanner.classList.remove('hidden');
    els.messageInput.value = msg.text || '';
    autoResizeInput();
    updateComposerSendMicToggle();
    els.messageInput.focus();
  }

  function cancelEditMode(clearInput = true) {
    state.editingMessage = null;
    if (els.editBanner) els.editBanner.classList.add('hidden');
    if (clearInput && els.messageInput) {
      els.messageInput.value = '';
      if (state.activeChatId) saveChatDraft(state.activeChatId, '');
      autoResizeInput();
    }
    updateComposerSendMicToggle();
  }

  async function sendMessage() {
    if (!state.activeChatId || state.sending) return;
    const rawValue = els.messageInput.value;
    const text = rawValue.trim();

    // Edit existing message flow
    if (state.editingMessage) {
      if (!text) {
        showToast('Edited message cannot be empty.', 'error');
        return;
      }
      const targetMsgId = state.editingMessage.id;
      const chatId = state.activeChatId;
      state.sending = true;
      try {
        const data = await api(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(targetMsgId)}`, {
          method: 'PATCH',
          body: { text }
        });
        cancelEditMode(true);
        if (data.message) {
          const idx = state.messages.findIndex((m) => m.id === data.message.id);
          if (idx >= 0) state.messages[idx] = data.message;
          renderMessages(false);
        }
        await refreshChats();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        state.sending = false;
      }
      return;
    }

    const hasFiles = state.pendingFiles.length > 0;
    if (!text && !hasFiles) return;

    const wasInputFocused = typeof document !== 'undefined' && document.activeElement === els.messageInput;
    state.sending = true;
    const chatId = state.activeChatId;
    const replyToId = state.replyTo ? state.replyTo.id : null;

    // Clear text input synchronously so the user can keep typing without keyboard flicker
    els.messageInput.value = '';
    saveChatDraft(chatId, '');
    autoResizeInput();
    updateComposerSendMicToggle();
    if (wasInputFocused && document.activeElement !== els.messageInput) {
      els.messageInput.focus({ preventScroll: true });
    }

    try {
      sendTypingSignal(false);
      const { viewOnce, ttlSeconds } = getComposeTimerPayload();
      let data;
      if (hasFiles) {
        const fd = new FormData();
        fd.append('text', text);
        if (replyToId) fd.append('replyToId', replyToId);
        if (ttlSeconds > 0) fd.append('ttlSeconds', String(ttlSeconds));
        if (viewOnce) fd.append('viewOnce', '1');
        for (const item of state.pendingFiles) {
          fd.append('files', item.file, item.file.name);
        }
        data = await sendWithProgress(`/api/chats/${encodeURIComponent(chatId)}/messages`, fd);
      } else {
        data = await api(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
          method: 'POST',
          body: { text, replyToId, ttlSeconds, viewOnce }
        });
      }

      clearPendingFiles();
      clearReply();
      if (viewOnce) {
        state.composeTimerMode = 'off';
        syncComposerTimerUi();
      }

      // Add message optimistically if SSE hasn't delivered it yet
      if (data.message && !state.messages.some((m) => m.id === data.message.id)) {
        state.messages.push(data.message);
        renderMessages(true);
        if (state.infoOpen) renderInfoDrawer();
      }
      playChime('send');
      await refreshChats();
    } catch (err) {
      if (!els.messageInput.value && rawValue && state.activeChatId === chatId) {
        els.messageInput.value = rawValue;
        saveChatDraft(chatId, rawValue);
        autoResizeInput();
      }
      showToast(err.message, 'error');
    } finally {
      state.sending = false;
      if (wasInputFocused && typeof document !== 'undefined' && document.activeElement !== els.messageInput) {
        try { els.messageInput.focus({ preventScroll: true }); } catch { }
      }
    }
  }

  function autoResizeInput() {
    const el = els.messageInput;
    if (!el) return;
    if (!el.value) {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    if (el.scrollHeight > 0) {
      el.style.height = `${Math.max(38, Math.min(el.scrollHeight, 140))}px`;
    }
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

  async function togglePinMessage(msgId, unpin = false) {
    if (!state.activeChatId) return;
    try {
      const data = await api(`/api/chats/${encodeURIComponent(state.activeChatId)}/pin`, {
        method: 'POST',
        body: { messageId: unpin ? null : msgId, unpin: Boolean(unpin) }
      });
      state.pinnedMessage = data.pinnedMessage || null;
      if (state.activeChatMeta) state.activeChatMeta.pinnedMessage = state.pinnedMessage;
      renderPinnedBar();
      showToast(state.pinnedMessage ? 'Message pinned to top' : 'Message unpinned', 'success');
      await refreshChats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function updateChatPrefs(chatId, prefs) {
    if (!chatId) return;
    try {
      const res = await api(`/api/chats/${encodeURIComponent(chatId)}/prefs`, {
        method: 'POST',
        body: prefs
      });
      if (chatId === state.activeChatId && state.activeChatMeta) {
        state.activeChatMeta.isPinned = Boolean(res.isPinned);
        state.activeChatMeta.isMuted = Boolean(res.isMuted);
        state.activeChatMeta.isArchived = Boolean(res.isArchived);
      }
      const c = state.chats.find((x) => x.id === chatId);
      if (c) {
        c.isPinned = Boolean(res.isPinned);
        c.isMuted = Boolean(res.isMuted);
        c.isArchived = Boolean(res.isArchived);
      }
      if (state.sidebarFilter === 'archived' && !state.chats.some((x) => x.isArchived)) {
        state.sidebarFilter = 'all';
      }
      if (state.infoOpen) renderInfoDrawer();
      await refreshChats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderMultiSelectBar() {
    if (!els.multiSelectBar) return;
    if (!state.selectMode) {
      els.multiSelectBar.classList.add('hidden');
      return;
    }
    const count = state.selectedMsgIds.size;
    els.multiSelectBar.classList.remove('hidden');
    if (els.multiSelectCount) {
      els.multiSelectCount.textContent = `${count} selected`;
    }
    const hasSelection = count > 0;
    if (els.multiCopyBtn) els.multiCopyBtn.disabled = !hasSelection;
    if (els.multiForwardBtn) els.multiForwardBtn.disabled = !hasSelection;
    if (els.multiDeleteBtn) els.multiDeleteBtn.disabled = !hasSelection;
  }

  function renderChatSelectBar() {
    if (!els.chatSelectBar) return;
    if (!state.chatSelectMode) {
      els.chatSelectBar.classList.add('hidden');
      return;
    }
    const selected = state.chats.filter((c) => state.selectedChatIds.has(c.id));
    const count = selected.length;
    els.chatSelectBar.classList.remove('hidden');
    if (els.chatSelectCount) {
      els.chatSelectCount.textContent = `${count} selected`;
    }
    const toggleable = selected.filter((c) => c.type !== 'saved');
    const allMuted = toggleable.length > 0 && toggleable.every((c) => c.isMuted);
    const allPinned = toggleable.length > 0 && toggleable.every((c) => c.isPinned);
    const allArchived = toggleable.length > 0 && toggleable.every((c) => c.isArchived);
    if (els.chatSelPinBtn) {
      els.chatSelPinBtn.disabled = toggleable.length === 0;
      els.chatSelPinBtn.textContent = allPinned ? '📌 Unpin' : '📌 Pin';
      els.chatSelPinBtn.dataset.nextPinned = allPinned ? '0' : '1';
    }
    if (els.chatSelMuteBtn) {
      els.chatSelMuteBtn.disabled = toggleable.length === 0;
      els.chatSelMuteBtn.textContent = allMuted ? '🔔 Unmute' : '🔇 Mute';
      els.chatSelMuteBtn.dataset.nextMuted = allMuted ? '0' : '1';
    }
    if (els.chatSelArchiveBtn) {
      els.chatSelArchiveBtn.disabled = toggleable.length === 0;
      els.chatSelArchiveBtn.textContent = allArchived ? '📤 Unarchive' : '📦 Archive';
      els.chatSelArchiveBtn.dataset.nextArchived = allArchived ? '0' : '1';
    }
    if (els.chatSelDeleteBtn) {
      els.chatSelDeleteBtn.disabled = count === 0;
    }
  }

  function enterChatSelectMode(initialChatId) {
    state.chatSelectMode = true;
    state.selectedChatIds = new Set(initialChatId ? [initialChatId] : []);
    renderChatSelectBar();
    renderSidebar();
  }

  function exitChatSelectMode() {
    if (!state.chatSelectMode && state.selectedChatIds.size === 0) return;
    state.chatSelectMode = false;
    state.selectedChatIds.clear();
    renderChatSelectBar();
    renderSidebar();
  }

  function toggleChatSelected(chatId) {
    if (!state.chatSelectMode || !chatId) return;
    if (state.selectedChatIds.has(chatId)) state.selectedChatIds.delete(chatId);
    else state.selectedChatIds.add(chatId);
    const row = els.sidebarList ? els.sidebarList.querySelector(`.chat-row[data-chat-id="${CSS && CSS.escape ? CSS.escape(chatId) : chatId}"]`) : null;
    if (row) {
      const sel = state.selectedChatIds.has(chatId);
      row.classList.toggle('selected', sel);
      const chk = row.querySelector('.chat-select-check');
      if (chk) chk.textContent = sel ? '✓' : '';
    }
    renderChatSelectBar();
  }

  function closeDeleteConfirmModal() {
    state.deleteConfirmState = null;
    if (els.deleteConfirmModal) els.deleteConfirmModal.classList.add('hidden');
  }

  function openDeleteConfirmForMessages(msgIds) {
    if (!state.activeChatId || !Array.isArray(msgIds) || msgIds.length === 0) return;
    const idSet = new Set(msgIds);
    const targets = state.messages.filter((m) => idSet.has(m.id));
    if (targets.length === 0) return;

    const isSaved = state.activeChatMeta && state.activeChatMeta.type === 'saved';
    const isChannelAdmin = state.activeRoom && state.activeRoom.type === 'channel' && state.me && Array.isArray(state.activeRoom.admins) && state.activeRoom.admins.includes(state.me.username);
    const ownCount = targets.filter((m) => state.me && (m.sender === state.me.username || isChannelAdmin)).length;
    const allowForEveryone = !isSaved && ownCount > 0;
    const peerLabel = state.activePeer
      ? (state.activePeer.displayName || `@${state.activePeer.username}`)
      : (state.activeRoom ? 'everyone' : 'the other user');

    state.deleteConfirmState = {
      mode: 'messages',
      chatId: state.activeChatId,
      msgIds: targets.map((m) => m.id),
      allowForEveryone
    };

    if (!els.deleteConfirmModal) {
      // Fallback for minimal mock test environments
      executeDeleteMessages(state.activeChatId, targets.map((m) => m.id), false);
      return;
    }

    els.deleteConfirmTitle.textContent = targets.length === 1 ? 'Delete Message?' : `Delete ${targets.length} Messages?`;
    els.deleteConfirmDesc.textContent = allowForEveryone
      ? `Choose whether to delete ${targets.length === 1 ? 'this message' : `these ${targets.length} messages`} only for you or also for ${peerLabel}.`
      : `Remove ${targets.length === 1 ? 'this message' : `these ${targets.length} messages`} from your chat view?`;

    if (els.deleteEveryoneRow && els.deleteEveryoneCheckbox && els.deleteEveryoneLabel) {
      els.deleteEveryoneRow.classList.toggle('hidden', !allowForEveryone);
      els.deleteEveryoneCheckbox.checked = false;
      if (allowForEveryone) {
        if (state.activePeer && ownCount < targets.length) {
          els.deleteEveryoneLabel.textContent = `Also delete my ${ownCount} message(s) for ${peerLabel}`;
        } else {
          els.deleteEveryoneLabel.textContent = `Also delete for ${peerLabel}`;
        }
      }
    }
    els.deleteConfirmModal.classList.remove('hidden');
  }

  function openDeleteConfirmForChats(chatIds) {
    if (!Array.isArray(chatIds) || chatIds.length === 0) return;
    const targets = state.chats.filter((c) => chatIds.includes(c.id));
    if (targets.length === 0) return;

    const dmTargets = targets.filter((c) => !c.type || c.type === 'dm');
    const adminRoomTargets = targets.filter((c) => (c.type === 'group' || c.type === 'channel') && state.me && (c.createdBy === state.me.username || (Array.isArray(c.admins) && c.admins.includes(state.me.username))));
    const allowForEveryone = dmTargets.length > 0 || adminRoomTargets.length > 0;

    let label = 'Also delete for the other user(s) too';
    if (targets.length === 1 && dmTargets.length === 1) {
      const peer = dmTargets[0].peer;
      const peerName = peer ? (peer.displayName || `@${peer.username}`) : 'other user';
      label = `Also delete chat for ${peerName}`;
    } else if (dmTargets.length === 0 && adminRoomTargets.length > 0) {
      label = 'Delete room for all members';
    }

    const singleTitle = targets[0].type === 'saved'
      ? 'Saved Messages'
      : (targets[0].title || (targets[0].peer ? (targets[0].peer.displayName || targets[0].peer.username) : 'this chat'));

    state.deleteConfirmState = {
      mode: 'chats',
      chatIds: targets.map((c) => c.id),
      allowForEveryone
    };

    if (!els.deleteConfirmModal) return;
    els.deleteConfirmTitle.textContent = targets.length === 1 ? `Delete "${singleTitle}"?` : `Delete ${targets.length} Chats?`;
    els.deleteConfirmDesc.textContent = targets.length === 1
      ? 'This will remove the chat and clear its messages from your device.'
      : `This will remove ${targets.length} selected chats and clear their history from your device.`;

    if (els.deleteEveryoneRow && els.deleteEveryoneCheckbox && els.deleteEveryoneLabel) {
      els.deleteEveryoneRow.classList.toggle('hidden', !allowForEveryone);
      els.deleteEveryoneCheckbox.checked = false;
      els.deleteEveryoneLabel.textContent = label;
    }
    els.deleteConfirmModal.classList.remove('hidden');
  }

  async function executeDeleteMessages(chatId, msgIds, forEveryone) {
    if (!chatId || !Array.isArray(msgIds) || msgIds.length === 0) return;
    try {
      if (msgIds.length === 1) {
        await api(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(msgIds[0])}?forEveryone=${forEveryone ? '1' : '0'}`, {
          method: 'DELETE'
        });
      } else {
        await api(`/api/chats/${encodeURIComponent(chatId)}/messages/bulk-delete`, {
          method: 'POST',
          body: { messageIds: msgIds, forEveryone: Boolean(forEveryone) }
        });
      }
      if (state.activeChatId === chatId) {
        const delSet = new Set(msgIds);
        state.messages = state.messages.filter((m) => !delSet.has(m.id));
        renderMessages(false);
        if (state.infoOpen) renderInfoDrawer();
      }
      exitSelectMode();
      await refreshChats();
      showToast(
        msgIds.length === 1 ? 'Message deleted' : `Deleted ${msgIds.length} messages`,
        'success'
      );
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function executeDeleteChats(chatIds, forEveryone) {
    if (!Array.isArray(chatIds) || chatIds.length === 0) return;
    try {
      const res = await api('/api/chats/bulk-delete', {
        method: 'POST',
        body: { chatIds, forEveryone: Boolean(forEveryone) }
      });
      const deletedSet = new Set(res.deletedChatIds || chatIds);
      state.chats = state.chats.filter((c) => !deletedSet.has(c.id));
      if (state.activeChatId && deletedSet.has(state.activeChatId)) {
        state.activeChatId = null;
        state.activeChatMeta = null;
        state.activePeer = null;
        state.activeRoom = null;
        state.pinnedMessage = null;
        state.messages = [];
        els.activeChat.classList.add('hidden');
        els.chatEmptyState.classList.remove('hidden');
        els.appShell.classList.remove('mobile-chat-open');
      }
      exitChatSelectMode();
      await refreshChats();
      showToast(
        deletedSet.size === 1 ? 'Chat deleted' : `Deleted ${deletedSet.size} chats`,
        'success'
      );
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function submitDeleteConfirmModal() {
    const info = state.deleteConfirmState;
    if (!info) return;
    const forEveryone = Boolean(info.allowForEveryone && els.deleteEveryoneCheckbox && els.deleteEveryoneCheckbox.checked);
    closeDeleteConfirmModal();
    if (info.mode === 'messages') {
      await executeDeleteMessages(info.chatId, info.msgIds, forEveryone);
    } else if (info.mode === 'chats') {
      await executeDeleteChats(info.chatIds, forEveryone);
    }
  }

  function enterSelectMode(initialMsgId) {
    state.selectMode = true;
    state.selectedMsgIds = new Set(initialMsgId ? [initialMsgId] : []);
    renderMultiSelectBar();
    renderMessages(false);
  }

  function exitSelectMode() {
    if (!state.selectMode && state.selectedMsgIds.size === 0) return;
    state.selectMode = false;
    state.selectedMsgIds.clear();
    renderMultiSelectBar();
    renderMessages(false);
  }

  function toggleMessageSelected(msgId) {
    if (!state.selectMode) return;
    if (state.selectedMsgIds.has(msgId)) state.selectedMsgIds.delete(msgId);
    else state.selectedMsgIds.add(msgId);
    const row = $(`msg-${msgId}`);
    if (row) {
      const sel = state.selectedMsgIds.has(msgId);
      row.classList.toggle('selected', sel);
      const chk = row.querySelector('.msg-select-check');
      if (chk) chk.textContent = sel ? '✓' : '';
    }
    renderMultiSelectBar();
  }

  async function multiCopySelected() {
    if (state.selectedMsgIds.size === 0) return;
    const ordered = state.messages.filter((m) => state.selectedMsgIds.has(m.id));
    const lines = ordered
      .map((m) => (m.text ? m.text : (m.attachments && m.attachments[0] ? m.attachments[0].originalName : '')))
      .filter(Boolean);
    if (lines.length === 0) {
      showToast('No text in selected messages.', 'error');
      return;
    }
    const payload = lines.join('\n\n');
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const ta = document.createElement('textarea');
        ta.value = payload;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showToast(`Copied ${lines.length} message${lines.length === 1 ? '' : 's'}`, 'success');
      exitSelectMode();
    } catch {
      showToast('Failed to copy messages.', 'error');
    }
  }

  async function multiDeleteSelected() {
    if (!state.activeChatId || state.selectedMsgIds.size === 0) return;
    openDeleteConfirmForMessages(Array.from(state.selectedMsgIds));
  }

  function openForwardModal(msgIds) {
    if (!els.forwardModal || !els.forwardTargetsList || !Array.isArray(msgIds) || msgIds.length === 0) return;
    state.forwardMsgIds = msgIds.slice();
    const seenIds = new Set();
    const targets = [];
    targets.push({
      targetId: 'saved',
      title: 'Saved Messages',
      subtitle: 'Personal cloud notes & files',
      isSaved: true
    });
    const mySavedId = state.me ? `saved_${state.me.username}` : '';
    seenIds.add(mySavedId);

    for (const c of state.chats) {
      if (!c || !c.id || seenIds.has(c.id)) continue;
      if (c.type === 'channel' && state.me && Array.isArray(c.admins) && !c.admins.includes(state.me.username)) continue;
      seenIds.add(c.id);
      const isRoom = c.type === 'group' || c.type === 'channel';
      const peer = c.peer;
      targets.push({
        targetId: c.id,
        title: isRoom ? (c.title || 'Group') : ((peer && (peer.displayName || peer.username)) || c.id),
        subtitle: isRoom ? (c.type === 'channel' ? 'Channel' : 'Group') : (peer ? `@${peer.username}` : ''),
        avatarSeed: isRoom ? { displayName: c.title, avatarColor: c.avatarColor } : peer
      });
    }

    if (state.me && Array.isArray(state.friends)) {
      for (const f of state.friends) {
        if (!f || !f.username) continue;
        const dmId = `dm_${[state.me.username, f.username].sort().join('__')}`;
        if (seenIds.has(dmId)) continue;
        seenIds.add(dmId);
        targets.push({
          targetId: dmId,
          title: f.displayName || f.username,
          subtitle: `@${f.username}`,
          avatarSeed: f
        });
      }
    }

    els.forwardTargetsList.innerHTML = targets.map((t) => `
      <button type="button" class="forward-target-row" data-forward-target="${escapeHtml(t.targetId)}">
        <div class="avatar${t.isSaved ? ' saved-avatar' : ''}" style="background: ${escapeHtml((t.avatarSeed && t.avatarSeed.avatarColor) || 'var(--accent)')}">
          ${t.isSaved
            ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
            : (t.avatarSeed && t.avatarSeed.avatarUrl ? `<img src="${escapeHtml(t.avatarSeed.avatarUrl)}" alt=""/>` : escapeHtml(initialsFor(t.avatarSeed || { displayName: t.title })))}
        </div>
        <div class="forward-target-meta">
          <div class="forward-target-name">${escapeHtml(t.title)}</div>
          <div class="forward-target-sub">${escapeHtml(t.subtitle || '')}</div>
        </div>
        <span class="forward-send-arrow">↪</span>
      </button>
    `).join('');
    els.forwardModal.classList.remove('hidden');
  }

  function closeForwardModal() {
    state.forwardMsgIds = [];
    if (els.forwardModal) els.forwardModal.classList.add('hidden');
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
    const isSaved = state.activeChatMeta && state.activeChatMeta.type === 'saved';
    if (!state.activePeer && !state.activeRoom && !isSaved) return;

    if (els.infoChatPrefs && state.activeChatId) {
      if (isSaved) {
        els.infoChatPrefs.classList.add('hidden');
      } else {
        const chatObj = state.chats.find((c) => c.id === state.activeChatId) || state.activeChatMeta || {};
        const isPinnedChat = Boolean(chatObj.isPinned);
        const isMutedChat = Boolean(chatObj.isMuted);
        const isArchivedChat = Boolean(chatObj.isArchived);
        els.infoChatPrefs.classList.remove('hidden');
        if (els.infoPinChatBtn) {
          els.infoPinChatBtn.textContent = isPinnedChat ? '📌 Unpin Chat' : '📌 Pin Chat';
          els.infoPinChatBtn.classList.toggle('active', isPinnedChat);
        }
        if (els.infoMuteChatBtn) {
          els.infoMuteChatBtn.classList.remove('hidden');
          els.infoMuteChatBtn.textContent = isMutedChat ? '🔔 Unmute' : '🔇 Mute';
          els.infoMuteChatBtn.classList.toggle('active', isMutedChat);
        }
        if (els.infoArchiveChatBtn) {
          els.infoArchiveChatBtn.classList.remove('hidden');
          els.infoArchiveChatBtn.textContent = isArchivedChat ? '📤 Unarchive' : '📦 Archive';
          els.infoArchiveChatBtn.classList.toggle('active', isArchivedChat);
        }
      }
    }

    if (isSaved) {
      if (els.infoHeaderTitle) els.infoHeaderTitle.textContent = 'Saved Messages';
      if (els.infoFriendControls) {
        els.infoFriendControls.classList.add('hidden');
        els.infoFriendControls.innerHTML = '';
      }
      if (els.infoSafetyControls) els.infoSafetyControls.classList.add('hidden');
      if (els.infoRoomControls) {
        els.infoRoomControls.classList.add('hidden');
        els.infoRoomControls.innerHTML = '';
      }
      if (els.infoAvatar) {
        els.infoAvatar.classList.add('saved-avatar');
        els.infoAvatar.style.background = 'var(--accent)';
        els.infoAvatar.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
      }
      els.infoDisplayName.textContent = 'Saved Messages';
      els.infoUsername.textContent = state.me ? `@${state.me.username}` : 'Personal Cloud';
      els.infoStatus.textContent = 'Notes, links & files';
      if (els.infoEmailRow) els.infoEmailRow.classList.add('hidden');
      if (els.infoBioRow) els.infoBioRow.classList.add('hidden');
      if (els.infoBirthdayRow) els.infoBirthdayRow.classList.add('hidden');
    } else if (state.activeRoom) {
      if (els.infoAvatar) els.infoAvatar.classList.remove('saved-avatar');
      if (els.infoSafetyControls) els.infoSafetyControls.classList.add('hidden');
      const r = state.activeRoom;
      if (els.infoHeaderTitle) {
        els.infoHeaderTitle.textContent = r.type === 'channel' ? 'Channel Info' : 'Group Info';
      }
      if (els.infoFriendControls) {
        els.infoFriendControls.classList.add('hidden');
        els.infoFriendControls.innerHTML = '';
      }
      renderAvatar(els.infoAvatar, { displayName: r.title, avatarColor: r.avatarColor || 'var(--accent)' });
      els.infoDisplayName.textContent = r.title || 'Room';
      els.infoUsername.textContent = r.type === 'channel' ? 'Broadcast Channel' : 'Group Chat';
      const count = r.memberCount || (Array.isArray(r.members) ? r.members.length : 1);
      els.infoStatus.textContent = `${count} member${count === 1 ? '' : 's'}`;
      if (els.infoEmailRow) els.infoEmailRow.classList.add('hidden');
      if (els.infoBirthdayRow) els.infoBirthdayRow.classList.add('hidden');
      if (r.description) {
        els.infoBioRow.classList.remove('hidden');
        els.infoBio.textContent = r.description;
      } else {
        els.infoBioRow.classList.add('hidden');
      }
      if (els.infoRoomControls) {
        els.infoRoomControls.classList.remove('hidden');
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.renderRoomInfo === 'function') {
          window.VibeRoomFeatures.renderRoomInfo(els.infoRoomControls, r);
        }
      }
    } else {
      if (els.infoAvatar) els.infoAvatar.classList.remove('saved-avatar');
      const p = state.activePeer;
      if (els.infoHeaderTitle) els.infoHeaderTitle.textContent = 'User Info';
      if (els.infoRoomControls) {
        els.infoRoomControls.classList.add('hidden');
        els.infoRoomControls.innerHTML = '';
      }
      if (els.infoEmailRow) {
        if (p.email) {
          els.infoEmailRow.classList.remove('hidden');
          els.infoEmail.textContent = p.email;
        } else {
          els.infoEmailRow.classList.add('hidden');
          els.infoEmail.textContent = '';
        }
      }
      renderAvatar(els.infoAvatar, p);
      els.infoDisplayName.textContent = p.displayName || p.username;
      els.infoUsername.textContent = `@${p.username}`;
      const isOnline = state.onlineUsers.has(p.username) || p.online;
      els.infoStatus.textContent = p.deleted ? 'deleted account' : (isOnline ? 'online' : formatLastSeen(p.lastSeen));
      if (p.bio) {
        els.infoBioRow.classList.remove('hidden');
        els.infoBio.textContent = p.bio;
      } else {
        els.infoBioRow.classList.add('hidden');
      }

      if (els.infoBirthdayRow && els.infoBirthday) {
        const bdayInfo = formatBirthdayLabel(p.birthday);
        if (bdayInfo) {
          els.infoBirthdayRow.classList.remove('hidden');
          els.infoBirthday.textContent = bdayInfo.text;
          els.infoBirthday.classList.toggle('birthday-today', bdayInfo.isToday);
        } else {
          els.infoBirthdayRow.classList.add('hidden');
        }
      }

      if (els.infoFriendControls) {
        const rel = getRelationshipForUser(p.username) !== 'none'
          ? getRelationshipForUser(p.username)
          : (p.relationship || 'none');
        els.infoFriendControls.classList.remove('hidden');
        const u = escapeHtml(p.username);
        if (rel === 'friends') {
          els.infoFriendControls.innerHTML = `
            <span class="friend-status-pill">✓ Friends</span>
            <button type="button" class="danger-btn sm" data-friend-action="unfriend" data-friend-user="${u}">Unfriend</button>
          `;
        } else if (rel === 'outgoing_pending') {
          els.infoFriendControls.innerHTML = `
            <span class="friend-status-pill pending">Request Sent</span>
            <button type="button" class="secondary-btn sm" data-friend-action="cancel" data-friend-user="${u}">Cancel Request</button>
          `;
        } else if (rel === 'incoming_pending') {
          els.infoFriendControls.innerHTML = `
            <button type="button" class="primary-btn sm" data-friend-action="accept" data-friend-user="${u}">Accept Friend</button>
            <button type="button" class="secondary-btn sm" data-friend-action="decline" data-friend-user="${u}">Decline</button>
          `;
        } else {
          els.infoFriendControls.innerHTML = `
            <button type="button" class="primary-btn sm full-width" data-friend-action="request" data-friend-user="${u}">+ Add Friend</button>
          `;
        }
      }
      if (els.infoSafetyControls) {
        if (p.deleted) {
          els.infoSafetyControls.classList.add('hidden');
        } else {
          els.infoSafetyControls.classList.remove('hidden');
          if (els.infoBlockBtn) {
            els.infoBlockBtn.textContent = p.blockedByMe ? '🔓 Unblock User' : '🚫 Block User';
            els.infoBlockBtn.classList.toggle('danger-btn', !p.blockedByMe);
            els.infoBlockBtn.classList.toggle('secondary-btn', Boolean(p.blockedByMe));
          }
        }
      }
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
  let activeMenuMsgId = null;
  let activeMenuExpanded = false;

  function closeMessageContextMenu() {
    if (activeMenuMsgId) {
      const prevRow = $(`msg-${activeMenuMsgId}`);
      if (prevRow) prevRow.classList.remove('menu-active');
    }
    activeMenuMsgId = null;
    activeMenuExpanded = false;
    if (els.msgContextOverlay) {
      els.msgContextOverlay.classList.add('hidden');
      els.msgContextOverlay.setAttribute('aria-hidden', 'true');
    }
  }

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

  function syncProfileAvatarControls() {
    if (!state.me) return;
    renderAvatar(els.profileEditAvatar, state.me);
    if (els.profileRemoveAvatarBtn) {
      els.profileRemoveAvatarBtn.classList.toggle('hidden', !state.me.avatarUrl);
    }
  }

  function openProfileModal() {
    if (!state.me) return;
    syncProfileAvatarControls();
    if (els.profileUsername) els.profileUsername.value = state.me.username || '';
    els.profileDisplayName.value = state.me.displayName || state.me.username;
    els.profileBio.value = state.me.bio || '';
    if (els.profileBirthday) els.profileBirthday.value = state.me.birthday || '';
    if (els.profileClearBirthdayBtn) {
      els.profileClearBirthdayBtn.classList.toggle('hidden', !state.me.birthday);
    }
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
      const isSystem = data.message.kind === 'system' || data.message.sender === 'system';
      const isCallLog = data.message.kind === 'call' && data.message.call;
      const isSilentCallLog = isCallLog && data.message.call.status !== 'missed';
      const isIncoming = !isSystem && !isSilentCallLog && data.message.sender !== state.me.username;
      const senderName = (data.senderProfile && data.senderProfile.displayName) || data.message.sender;
      const senderAvatarUrl = (data.senderProfile && data.senderProfile.avatarUrl) || '';
      const senderAvatarColor = (data.senderProfile && data.senderProfile.avatarColor) || '';
      const bodyPreview = data.message.kind === 'game'
        ? `🎮 ${(data.message.game && data.message.game.title) || 'Mini-Game'}`
        : (isCallLog
          ? (data.message.text || 'Call')
          : (data.message.text
            ? data.message.text.slice(0, 120)
            : (data.message.attachments && data.message.attachments[0]
              ? (data.message.attachments[0].isImage ? '📷 Sent a photo' : `📎 ${data.message.attachments[0].originalName}`)
              : 'New message')));

      if (data.chatId === state.activeChatId) {
        const wasNearBottom = isNearBottom();
        if (!state.messages.some((m) => m.id === data.message.id)) {
          state.messages.push(data.message);
          if (isIncoming && !wasNearBottom) {
            state.unreadBelowCount = (state.unreadBelowCount || 0) + 1;
            if (!state.firstUnreadMsgId) state.firstUnreadMsgId = data.message.id;
          } else if (!isIncoming && !isSystem) {
            state.firstUnreadMsgId = null;
          }
          renderMessages(wasNearBottom);
          if (state.infoOpen) renderInfoDrawer();
          if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.onNewMessage === 'function') {
            window.VibeRoomFeatures.onNewMessage(data.chatId, data.message);
          }
        }
        if (isIncoming) {
          const activeChatObj = state.chats.find((c) => c.id === data.chatId) || state.activeChatMeta;
          const isMutedChat = Boolean(activeChatObj && activeChatObj.isMuted);
          if (!isMutedChat) {
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
          }
          if (wasNearBottom) {
            await markActiveChatRead();
          } else {
            updateGlobalUnreadCounters();
          }
        }
      } else if (isIncoming) {
        const existingChat = state.chats.find((c) => c.id === data.chatId);
        const isSilentChat = Boolean(existingChat && (existingChat.isMuted || existingChat.isArchived));
        if (existingChat) {
          existingChat.unreadCount = Number(existingChat.unreadCount || 0) + 1;
          renderSidebar();
        }
        if (!isSilentChat) {
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
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.onMessageUpdated === 'function') {
          window.VibeRoomFeatures.onMessageUpdated(data.chatId, data.message);
        }
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

    es.addEventListener('chat_pinned', async (ev) => {
      const data = JSON.parse(ev.data);
      if (data.chatId === state.activeChatId) {
        state.pinnedMessage = data.pinnedMessage || null;
        if (state.activeChatMeta) state.activeChatMeta.pinnedMessage = state.pinnedMessage;
        renderPinnedBar();
      }
      await refreshChats();
    });

    es.addEventListener('chat_prefs_updated', async (ev) => {
      const data = JSON.parse(ev.data);
      if (data.chatId === state.activeChatId && state.activeChatMeta) {
        state.activeChatMeta.isPinned = Boolean(data.isPinned);
        state.activeChatMeta.isMuted = Boolean(data.isMuted);
        state.activeChatMeta.isArchived = Boolean(data.isArchived);
        if (state.infoOpen) renderInfoDrawer();
      }
      await refreshChats();
    });

    es.addEventListener('chat_deleted', async (ev) => {
      const data = JSON.parse(ev.data);
      const chatId = data && data.chatId;
      if (!chatId) return;
      state.chats = state.chats.filter((c) => c.id !== chatId);
      state.selectedChatIds.delete(chatId);
      if (state.activeChatId === chatId) {
        state.activeChatId = null;
        state.activeChatMeta = null;
        state.activePeer = null;
        state.activeRoom = null;
        state.pinnedMessage = null;
        state.messages = [];
        els.activeChat.classList.add('hidden');
        els.chatEmptyState.classList.remove('hidden');
        els.appShell.classList.remove('mobile-chat-open');
        if (data.by && (!state.me || data.by !== state.me.username)) {
          showToast('This chat was deleted.', 'info');
        }
      }
      renderChatSelectBar();
      renderSidebar();
      await refreshChats();
    });

    es.addEventListener('block_updated', async (ev) => {
      const data = JSON.parse(ev.data);
      if (state.activePeer && (state.activePeer.username === data.by || state.activePeer.username === data.target)) {
        await openChatWithUser(state.activePeer.username);
      }
      await refreshBlockedUsers();
      await refreshChats();
    });

    es.addEventListener('account_deleted', () => {
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
      }
      state.me = null;
      state.chats = [];
      state.activeChatId = null;
      els.activeChat.classList.add('hidden');
      els.chatEmptyState.classList.remove('hidden');
      closeSettingsModal();
      showAuthScreen();
    });

    es.addEventListener('chat_updated', async (ev) => {
      const data = JSON.parse(ev.data);
      if (data.chat && data.chatId) {
        const idx = state.chats.findIndex((c) => c.id === data.chatId);
        if (idx >= 0) state.chats[idx] = { ...state.chats[idx], ...data.chat };
        else state.chats.unshift(data.chat);
        if (state.activeChatId === data.chatId && state.activeRoom) {
          state.activeRoom = data.chat;
          renderAvatar(els.chatPeerAvatar, { displayName: data.chat.title, avatarColor: data.chat.avatarColor || 'var(--accent)' });
          els.chatPeerName.textContent = data.chat.title || 'Room';
          syncComposerAccessForActiveChat();
          updateChatHeaderStatus();
          if (state.infoOpen) renderInfoDrawer();
        }
        renderSidebar();
      } else {
        await refreshChats();
      }
    });

    es.addEventListener('chat_removed', (ev) => {
      const data = JSON.parse(ev.data);
      if (!data.chatId) return;
      state.chats = state.chats.filter((c) => c.id !== data.chatId);
      if (state.activeChatId === data.chatId) {
        state.activeChatId = null;
        state.activePeer = null;
        state.activeRoom = null;
        state.messages = [];
        els.activeChat.classList.add('hidden');
        els.chatEmptyState.classList.remove('hidden');
        els.appShell.classList.remove('mobile-chat-open');
        toggleInfoDrawer(false);
      }
      renderSidebar();
    });

    es.addEventListener('friends_updated', async (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        if (state.me && data.to === state.me.username && data.status === 'outgoing_pending') {
          showToast(`@${data.from} sent you a friend request!`, 'success');
        } else if (state.me && data.by && data.friend === state.me.username && data.status === 'friends') {
          showToast(`@${data.by} accepted your friend request!`, 'success');
        }
      } catch {
        // Ignore
      }
      await refreshFriends();
    });

    const forwardFeatureEvents = [
      'stranger_matched', 'stranger_message', 'stranger_typing',
      'stranger_ended', 'stranger_reveal_requested', 'stranger_revealed',
      'call_incoming', 'call_accepted', 'call_signal', 'call_declined', 'call_ended'
    ];
    for (const evtName of forwardFeatureEvents) {
      es.addEventListener(evtName, (ev) => {
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.onSseEvent === 'function') {
          try {
            window.VibeRoomFeatures.onSseEvent(evtName, JSON.parse(ev.data));
          } catch {
            // Ignore malformed SSE payload
          }
        }
      });
    }

    es.addEventListener('profile_updated', async (ev) => {
      const data = JSON.parse(ev.data);
      const updated = data.user;
      if (!updated) return;
      const prevUsername = data.previousUsername || updated.username;
      const renamedUser = prevUsername !== updated.username;

      if (state.me && (state.me.username === updated.username || state.me.username === prevUsername)) {
        state.me = updated;
        updateDrawerUserInfo();
        syncProfileAvatarControls();
      }
      if (state.activePeer && (state.activePeer.username === updated.username || state.activePeer.username === prevUsername)) {
        state.activePeer = { ...state.activePeer, ...updated };
        renderAvatar(els.chatPeerAvatar, state.activePeer);
        els.chatPeerName.textContent = state.activePeer.displayName || state.activePeer.username;
        updateChatHeaderStatus();
        if (state.infoOpen) renderInfoDrawer();
      }
      if (renamedUser && state.activeChatId) {
        if (state.activeChatId.startsWith('saved_') && state.me && state.me.username === updated.username) {
          await openSavedMessages();
        } else if (Array.isArray(data.chatRenames)) {
          const hit = data.chatRenames.find((r) => r.oldChatId === state.activeChatId);
          if (hit && state.activePeer) {
            await openChatWithUser(state.activePeer.username);
          }
        }
      }
      await refreshChats();
    });
  }

  // =========================================================================
  // Boot & Event Listeners
  // =========================================================================
  let activePickerTab = 'emoji';
  function renderPickerBody() {
    const bodyEl = els.pickerBody || els.emojiPopover;
    if (!bodyEl) return;
    if (els.pickerSearchWrap) {
      els.pickerSearchWrap.classList.toggle('hidden', activePickerTab === 'emoji');
    }
    if (els.pickerTabs) {
      els.pickerTabs.querySelectorAll('[data-picker-tab]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.pickerTab === activePickerTab);
      });
    }
    if (activePickerTab === 'emoji') {
      bodyEl.innerHTML = `<div class="emoji-grid">${EMOJI_LIST.map(
        (em) => `<button type="button" class="emoji-item" data-insert-emoji="${em}">${em}</button>`
      ).join('')}</div>`;
      return;
    }
    const query = els.pickerSearchInput ? els.pickerSearchInput.value : '';
    const items = window.VibeRoomStickers && typeof window.VibeRoomStickers.searchItems === 'function'
      ? window.VibeRoomStickers.searchItems(activePickerTab, query)
      : [];
    if (items.length === 0) {
      bodyEl.innerHTML = `<div class="picker-empty">No ${activePickerTab === 'gif' ? 'GIFs' : 'stickers'} matched your search.</div>`;
      return;
    }
    const gridCls = activePickerTab === 'gif' ? 'gif-grid' : 'sticker-grid';
    bodyEl.innerHTML = `<div class="${gridCls}">${items.map((item) => `
      <button type="button" class="picker-media-item" data-send-sticker="${escapeHtml(item.id)}" title="${escapeHtml(item.label || '')}">
        ${window.VibeRoomStickers.renderBubbleHtml(item)}
      </button>
    `).join('')}</div>`;
  }

  function initEmojiPopover() {
    renderPickerBody();
  }

  async function sendBuiltInStickerOrGif(stickerId) {
    if (!state.activeChatId || state.sending) return;
    const item = window.VibeRoomStickers && window.VibeRoomStickers.getById ? window.VibeRoomStickers.getById(stickerId) : null;
    if (!item) return;
    const chatId = state.activeChatId;
    const replyToId = state.replyTo ? state.replyTo.id : null;
    state.sending = true;
    try {
      const data = await api(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        method: 'POST',
        body: { text: '', kind: item.type, sticker: item, replyToId }
      });
      clearReply();
      if (data.message && !state.messages.some((m) => m.id === data.message.id)) {
        state.messages.push(data.message);
        renderMessages(true);
      }
      playChime('send');
      await refreshChats();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      state.sending = false;
    }
  }

  async function sendRichMediaFile(file, kindHint = 'sticker') {
    if (!state.activeChatId || !file || state.sending) return;
    const chatId = state.activeChatId;
    const replyToId = state.replyTo ? state.replyTo.id : null;
    const isGif = kindHint === 'gif' || file.type === 'image/gif' || /\.gif$/i.test(file.name || '');
    const kind = isGif ? 'gif' : 'sticker';
    const wasFocused = typeof document !== 'undefined' && document.activeElement === els.messageInput;
    state.sending = true;
    try {
      const fd = new FormData();
      fd.append('text', '');
      fd.append('kind', kind);
      const { viewOnce, ttlSeconds } = getComposeTimerPayload();
      if (ttlSeconds > 0) fd.append('ttlSeconds', String(ttlSeconds));
      if (viewOnce) fd.append('viewOnce', '1');
      if (replyToId) fd.append('replyToId', replyToId);
      fd.append('files', file, file.name || (isGif ? `keyboard-${Date.now()}.gif` : `sticker-${Date.now()}.png`));
      const data = await sendWithProgress(`/api/chats/${encodeURIComponent(chatId)}/messages`, fd);
      clearReply();
      if (viewOnce) {
        state.composeTimerMode = 'off';
        syncComposerTimerUi();
      }
      if (data.message && !state.messages.some((m) => m.id === data.message.id)) {
        state.messages.push(data.message);
        renderMessages(true);
        if (state.infoOpen) renderInfoDrawer();
      }
      playChime('send');
      await refreshChats();
    } catch (err) {
      showToast(err.message || 'Failed to send sticker/GIF.', 'error');
    } finally {
      state.sending = false;
      if (wasFocused && els.messageInput && typeof document !== 'undefined' && document.activeElement !== els.messageInput) {
        try { els.messageInput.focus({ preventScroll: true }); } catch { }
      }
    }
  }

  async function handleIncomingKeyboardMedia(payload) {
    if (!payload || !payload.url) return;
    const token = payload.token || '';
    const cleanupToken = () => {
      if (token && window.AndroidBridge && typeof window.AndroidBridge.clearSharedFile === 'function') {
        try { window.AndroidBridge.clearSharedFile(token); } catch { }
      }
    };
    if (!state.me || !state.activeChatId) {
      cleanupToken();
      showToast('Open a chat to send stickers or GIFs.', 'info');
      return;
    }
    const isChannelReadOnly = state.activeRoom && state.activeRoom.type === 'channel' && (!Array.isArray(state.activeRoom.admins) || !state.activeRoom.admins.includes(state.me.username));
    const blockedDm = state.activePeer && (state.activePeer.blockedByMe || state.activePeer.blockedByPeer || state.activePeer.deleted);
    if (isChannelReadOnly || blockedDm) {
      cleanupToken();
      showToast('You cannot send stickers or GIFs in this chat.', 'error');
      return;
    }
    try {
      const resp = await fetch(payload.url);
      if (!resp.ok) throw new Error('Could not read keyboard media');
      const blob = await resp.blob();
      const mime = payload.mime || blob.type || 'image/gif';
      const fallbackName = mime.includes('gif') ? `gboard-${Date.now()}.gif` : (mime.includes('webp') ? `sticker-${Date.now()}.webp` : `sticker-${Date.now()}.png`);
      const file = new File([blob], payload.name || fallbackName, { type: mime });
      cleanupToken();
      await sendRichMediaFile(file, payload.kind || (mime.includes('gif') ? 'gif' : 'sticker'));
    } catch (err) {
      cleanupToken();
      showToast(err.message || 'Could not send keyboard sticker/GIF.', 'error');
    }
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
        showToast(`Email verified! Welcome to VibeRoom, @${data.user.username}!`, 'success');
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

    // Forgot Password Flow
    if (els.forgotPasswordBtn) {
      els.forgotPasswordBtn.addEventListener('click', showForgotPasswordStep);
    }
    if (els.forgotBackBtn) {
      els.forgotBackBtn.addEventListener('click', () => switchAuthTab('login'));
    }
    if (els.forgotSendBtn) {
      els.forgotSendBtn.addEventListener('click', async () => {
        const identifier = els.forgotIdentifier ? els.forgotIdentifier.value.trim() : '';
        if (!identifier) {
          if (els.forgotReqError) {
            els.forgotReqError.textContent = 'Please enter your username or email.';
            els.forgotReqError.classList.remove('hidden');
          }
          return;
        }
        if (els.forgotReqError) els.forgotReqError.classList.add('hidden');
        els.forgotSendBtn.disabled = true;
        try {
          const data = await api('/api/auth/forgot-password', {
            method: 'POST',
            body: { identifier }
          });
          state.forgotVerificationId = data.verificationId;
          if (els.forgotStepRequest) els.forgotStepRequest.classList.add('hidden');
          if (els.forgotStepReset) els.forgotStepReset.classList.remove('hidden');
          if (els.forgotSubtitle) {
            els.forgotSubtitle.innerHTML = `Enter the 6-digit code sent to <strong>${escapeHtml(data.maskedEmail)}</strong> and choose a new password.`;
          }
          if (els.forgotDevBanner) {
            if (data.deliveryMode === 'dev' && data.devCode) {
              els.forgotDevBanner.innerHTML = `Local Dev Preview:<br/>Your reset code is <strong>${escapeHtml(data.devCode)}</strong>`;
              els.forgotDevBanner.classList.remove('hidden');
            } else {
              els.forgotDevBanner.classList.add('hidden');
            }
          }
          if (els.forgotCode) {
            els.forgotCode.value = '';
            els.forgotCode.focus();
          }
          if (els.forgotNewPassword) els.forgotNewPassword.value = '';
        } catch (err) {
          if (els.forgotReqError) {
            els.forgotReqError.textContent = err.message;
            els.forgotReqError.classList.remove('hidden');
          }
        } finally {
          els.forgotSendBtn.disabled = false;
        }
      });
    }
    if (els.forgotForm) {
      els.forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.forgotVerificationId) return;
        const code = els.forgotCode ? els.forgotCode.value.trim() : '';
        const newPassword = els.forgotNewPassword ? els.forgotNewPassword.value : '';
        if (els.forgotResetError) els.forgotResetError.classList.add('hidden');
        if (els.forgotResetSubmit) els.forgotResetSubmit.disabled = true;
        try {
          await api('/api/auth/reset-password', {
            method: 'POST',
            body: {
              verificationId: state.forgotVerificationId,
              code,
              newPassword
            }
          });
          state.forgotVerificationId = null;
          switchAuthTab('login');
          showToast('Password updated! You can now sign in.', 'success');
        } catch (err) {
          if (els.forgotResetError) {
            els.forgotResetError.textContent = err.message;
            els.forgotResetError.classList.remove('hidden');
          }
        } finally {
          if (els.forgotResetSubmit) els.forgotResetSubmit.disabled = false;
        }
      });
    }

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
    els.menuAppUpdate.addEventListener('click', () => {
      closeDrawer();
      openSettingsModal('updates');
      if (hasAndroidUpdater()) window.AndroidBridge.checkForAppUpdate(true);
    });
    els.appUpdateBanner.addEventListener('click', () => {
      openSettingsModal('updates');
    });
    els.updateCheckBtn.addEventListener('click', () => {
      if (hasAndroidUpdater()) window.AndroidBridge.checkForAppUpdate(true);
    });
    els.updateInstallBtn.addEventListener('click', () => {
      if (hasAndroidUpdater()) window.AndroidBridge.startAppUpdate();
    });
    if (els.menuSavedMessages) {
      els.menuSavedMessages.addEventListener('click', async () => {
        closeDrawer();
        await openSavedMessages();
      });
    }
    if (els.menuFriends) {
      els.menuFriends.addEventListener('click', () => {
        closeDrawer();
        state.browseMode = false;
        state.searchQuery = '';
        els.sidebarSearch.value = '';
        state.sidebarFilter = 'friends';
        els.appShell.classList.remove('mobile-chat-open');
        refreshFriends();
        renderSidebar();
      });
    }
    els.menuFindUsers.addEventListener('click', () => {
      closeDrawer();
      triggerBrowseUsers();
    });
    els.menuEditProfile.addEventListener('click', () => {
      closeDrawer();
      openProfileModal();
    });
    if (els.shareTargetCancel) {
      els.shareTargetCancel.addEventListener('click', () => clearPendingShare(true));
    }

    els.menuLogout.addEventListener('click', async () => {
      closeDrawer();
      clearPendingShare(true);
      state.drafts = {};
      state.scrollPositions = {};
      try {
        localStorage.removeItem('viberoom_drafts');
        localStorage.removeItem('viberoom_scroll');
      } catch { }
      await api('/api/auth/logout', { method: 'POST' }).catch(() => { });
      if (state.eventSource) state.eventSource.close();
      state.me = null;
      state.chats = [];
      state.friends = [];
      state.friendRequestsSent = [];
      state.friendRequestsReceived = [];
      state.activeChatId = null;
      state.activePeer = null;
      state.activeRoom = null;
      state.messages = [];
      if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.onLogout === 'function') {
        window.VibeRoomFeatures.onLogout();
      }
      els.activeChat.classList.add('hidden');
      els.chatEmptyState.classList.remove('hidden');
      showAuthScreen();
    });

    // Settings Modal
    els.settingsModalClose.addEventListener('click', closeSettingsModal);
    els.settingsModalBackdrop.addEventListener('click', closeSettingsModal);
    els.settingsBackBtn.addEventListener('click', () => {
      if (isMobileSettingsViewport()) {
        if (settingsMobileView === 'detail') {
          showSettingsMobileMenu();
        } else {
          closeSettingsModal();
        }
      } else {
        switchSettingsTab('general');
      }
    });
    els.settingsMobileProfile.addEventListener('click', () => {
      closeSettingsModal();
      openProfileModal();
    });
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
          syncAndroidFcmToken();
        } else {
          const granted = await requestBrowserNotificationPermission();
          if (!granted) els.prefNotifications.checked = false;
        }
      } else {
        state.prefs.notifications = false;
        savePrefs();
        if (!hasAndroidBridge) unsubscribeWebPush();
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
        await syncAndroidFcmToken();
        api('/api/push/test', { method: 'POST' }).catch(() => {});
        window.AndroidBridge.showNotification(
          state.me ? (state.me.displayName || state.me.username) : 'VibeRoom Test',
          'Android notifications & push alerts are working!',
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
        await ensureWebPushSubscribed();
        const pushRes = await api('/api/push/test', { method: 'POST' }).catch(() => null);
        if (pushRes && pushRes.webSent > 0) {
          showToast('Background Web Push test sent!', 'success');
          return;
        }
        const opts = { body: 'Browser notifications are working!', icon: '/icon-192.png', tag: 'viberoom-test' };
        if (swRegistration && typeof swRegistration.showNotification === 'function') {
          await swRegistration.showNotification('VibeRoom Test', opts);
        } else {
          new Notification('VibeRoom Test', opts);
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

    // Shareable Profile Link & QR Actions
    if (els.copyProfileLinkBtn) {
      els.copyProfileLinkBtn.addEventListener('click', async () => {
        const url = els.settingsProfileLink ? els.settingsProfileLink.value : '';
        if (!url) return;
        try {
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
          }
          showToast('Profile link copied!', 'success');
        } catch {
          showToast('Copy failed — please select and copy the link.', 'error');
        }
      });
    }
    if (els.shareProfileLinkBtn) {
      els.shareProfileLinkBtn.addEventListener('click', async () => {
        const url = els.settingsProfileLink ? els.settingsProfileLink.value : '';
        if (!url) return;
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          try {
            await navigator.share({
              title: 'Add me on VibeRoom',
              text: state.me ? `Chat with @${state.me.username} on VibeRoom` : 'Join me on VibeRoom',
              url
            });
            return;
          } catch {
            // Fall back to clipboard
          }
        }
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url).catch(() => {});
          showToast('Profile link copied!', 'success');
        }
      });
    }

    // Change Password (in Account & Profile Settings)
    if (els.changePasswordForm) {
      els.changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (els.chgPassError) els.chgPassError.classList.add('hidden');
        const currentPassword = els.chgCurPassword ? els.chgCurPassword.value : '';
        const newPassword = els.chgNewPassword ? els.chgNewPassword.value : '';
        const confirmPassword = els.chgConfirmPassword ? els.chgConfirmPassword.value : '';
        if (newPassword !== confirmPassword) {
          if (els.chgPassError) {
            els.chgPassError.textContent = 'New passwords do not match.';
            els.chgPassError.classList.remove('hidden');
          }
          return;
        }
        if (els.chgPassSubmit) els.chgPassSubmit.disabled = true;
        try {
          await api('/api/users/me/password', {
            method: 'POST',
            body: { currentPassword, newPassword }
          });
          els.changePasswordForm.reset();
          showToast('Password updated!', 'success');
        } catch (err) {
          if (els.chgPassError) {
            els.chgPassError.textContent = err.message;
            els.chgPassError.classList.remove('hidden');
          }
        } finally {
          if (els.chgPassSubmit) els.chgPassSubmit.disabled = false;
        }
      });
    }

    // Privacy Settings (Everyone / Contacts / Nobody)
    const bindPrivacySelect = (el, key) => {
      if (!el) return;
      el.addEventListener('change', async () => {
        try {
          const data = await api('/api/users/me/privacy', {
            method: 'PATCH',
            body: { [key]: el.value }
          });
          if (data.user) state.me = data.user;
          showToast('Privacy setting updated', 'success');
        } catch (err) {
          syncPrivacyUI();
          showToast(err.message, 'error');
        }
      });
    };
    bindPrivacySelect(els.privEmail, 'email');
    bindPrivacySelect(els.privBirthday, 'birthday');
    bindPrivacySelect(els.privLastSeen, 'lastSeen');
    bindPrivacySelect(els.privAvatar, 'avatar');

    if (els.blockedUsersList) {
      els.blockedUsersList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-unblock-user]');
        if (!btn) return;
        performBlockToggle(btn.dataset.unblockUser, false);
      });
    }

    // Delete Account (Email OTP + "DELETE" Confirmation)
    if (els.deleteAccSendCodeBtn) {
      els.deleteAccSendCodeBtn.addEventListener('click', async () => {
        els.deleteAccSendCodeBtn.disabled = true;
        if (els.deleteAccError) els.deleteAccError.classList.add('hidden');
        try {
          const data = await api('/api/users/me/delete-request', { method: 'POST', body: {} });
          state.deleteAccountVerificationId = data.verificationId;
          if (els.deleteAccStepRequest) els.deleteAccStepRequest.classList.add('hidden');
          if (els.deleteAccStepConfirm) els.deleteAccStepConfirm.classList.remove('hidden');
          if (els.deleteAccMaskedSub) {
            els.deleteAccMaskedSub.innerHTML = `Enter the 6-digit code sent to <strong>${escapeHtml(data.maskedEmail)}</strong> and type <code>DELETE</code>.`;
          }
          if (els.deleteAccDevBanner) {
            if (data.deliveryMode === 'dev' && data.devCode) {
              els.deleteAccDevBanner.innerHTML = `Local Dev Preview:<br/>Your deletion code is <strong>${escapeHtml(data.devCode)}</strong>`;
              els.deleteAccDevBanner.classList.remove('hidden');
            } else {
              els.deleteAccDevBanner.classList.add('hidden');
            }
          }
          if (els.deleteAccCode) els.deleteAccCode.focus();
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          els.deleteAccSendCodeBtn.disabled = false;
        }
      });
    }
    if (els.deleteAccConfirmBtn) {
      els.deleteAccConfirmBtn.addEventListener('click', async () => {
        if (!state.deleteAccountVerificationId) return;
        if (els.deleteAccError) els.deleteAccError.classList.add('hidden');
        const code = els.deleteAccCode ? els.deleteAccCode.value.trim() : '';
        const confirmText = els.deleteAccPhrase ? els.deleteAccPhrase.value.trim() : '';
        if (confirmText !== 'DELETE') {
          if (els.deleteAccError) {
            els.deleteAccError.textContent = 'Please type DELETE in uppercase to confirm.';
            els.deleteAccError.classList.remove('hidden');
          }
          return;
        }
        els.deleteAccConfirmBtn.disabled = true;
        try {
          await api('/api/users/me/delete-confirm', {
            method: 'POST',
            body: {
              verificationId: state.deleteAccountVerificationId,
              code,
              confirmText
            }
          });
          if (state.eventSource) state.eventSource.close();
          state.me = null;
          state.chats = [];
          state.activeChatId = null;
          closeSettingsModal();
          showAuthScreen();
          showToast('Your account has been deleted. Username and email are now released.', 'info');
        } catch (err) {
          if (els.deleteAccError) {
            els.deleteAccError.textContent = err.message;
            els.deleteAccError.classList.remove('hidden');
          }
        } finally {
          els.deleteAccConfirmBtn.disabled = false;
        }
      });
    }

    // Block, Unblock, Report & User Link Preview Modal
    if (els.infoBlockBtn) {
      els.infoBlockBtn.addEventListener('click', () => {
        if (!state.activePeer) return;
        performBlockToggle(state.activePeer.username, !state.activePeer.blockedByMe);
      });
    }
    if (els.dmUnblockInlineBtn) {
      els.dmUnblockInlineBtn.addEventListener('click', () => {
        if (!state.activePeer) return;
        performBlockToggle(state.activePeer.username, false);
      });
    }
    if (els.infoReportBtn) {
      els.infoReportBtn.addEventListener('click', () => {
        if (!state.activePeer) return;
        openReportModal(state.activePeer.username);
      });
    }
    if (els.reportModalBackdrop) els.reportModalBackdrop.addEventListener('click', closeReportModal);
    if (els.reportModalClose) els.reportModalClose.addEventListener('click', closeReportModal);
    if (els.reportCancelBtn) els.reportCancelBtn.addEventListener('click', closeReportModal);
    if (els.reportUserForm) {
      els.reportUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.reportTargetUsername) return;
        if (els.reportSubmitBtn) els.reportSubmitBtn.disabled = true;
        try {
          await api('/api/users/report', {
            method: 'POST',
            body: {
              targetUsername: state.reportTargetUsername,
              reason: els.reportReason ? els.reportReason.value : 'spam',
              details: els.reportDetails ? els.reportDetails.value.trim() : '',
              chatId: state.activeChatId || null
            }
          });
          closeReportModal();
          showToast('Report submitted. Thank you for helping keep VibeRoom safe.', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          if (els.reportSubmitBtn) els.reportSubmitBtn.disabled = false;
        }
      });
    }

    if (els.userPreviewBackdrop) els.userPreviewBackdrop.addEventListener('click', closeUserPreviewModal);
    if (els.userPreviewClose) els.userPreviewClose.addEventListener('click', closeUserPreviewModal);
    if (els.userPreviewActions) {
      els.userPreviewActions.addEventListener('click', async (e) => {
        const msgBtn = e.target.closest('[data-preview-message]');
        if (msgBtn) {
          const uname = msgBtn.dataset.previewMessage;
          closeUserPreviewModal();
          await openChatWithUser(uname);
          return;
        }
        const friendBtn = e.target.closest('[data-friend-action]');
        if (friendBtn) {
          const uname = friendBtn.dataset.friendUser;
          await performFriendAction(friendBtn.dataset.friendAction, uname);
          if (state.previewedProfileUser && state.previewedProfileUser.username === uname) {
            await openUserProfilePreviewModal(uname);
          }
          return;
        }
        const blkBtn = e.target.closest('[data-preview-block]');
        if (blkBtn) {
          await performBlockToggle(blkBtn.dataset.previewUser, blkBtn.dataset.previewBlock === 'block');
          return;
        }
        const rptBtn = e.target.closest('[data-preview-report]');
        if (rptBtn) {
          const uname = rptBtn.dataset.previewReport;
          closeUserPreviewModal();
          openReportModal(uname);
        }
      });
    }

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

    // Sidebar filter tabs (All Chats / Unread / Friends)
    if (els.sidebarTabs) {
      els.sidebarTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-chat-filter]');
        if (!btn) return;
        const next = btn.dataset.chatFilter;
        state.sidebarFilter = next === 'unread' ? 'unread' : (next === 'friends' ? 'friends' : 'all');
        if (state.sidebarFilter === 'friends') {
          refreshFriends();
        }
        renderSidebar();
      });
    }

    // Sidebar click, right-click context menu (Desktop), long-press select (Mobile) & keyboard delegation
    let suppressSidebarClickUntil = 0;
    let activeChatMenuId = null;

    function closeChatContextMenu() {
      activeChatMenuId = null;
      if (els.chatContextOverlay) {
        els.chatContextOverlay.classList.add('hidden');
        els.chatContextOverlay.setAttribute('aria-hidden', 'true');
      }
    }

    function openChatContextMenu(chatId, anchorX, anchorY) {
      const chat = state.chats.find((c) => c.id === chatId);
      if (!chat || !els.chatContextOverlay || !els.chatContextCard) return;
      closeChatContextMenu();
      activeChatMenuId = chatId;

      const isSaved = chat.type === 'saved';
      const items = [
        {
          action: 'select',
          label: 'Select Chats',
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
        }
      ];

      if (!isSaved) {
        items.push({
          action: 'pin',
          label: chat.isPinned ? 'Unpin Chat' : 'Pin Chat',
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>'
        });
        items.push({
          action: 'mute',
          label: chat.isMuted ? 'Unmute Notifications' : 'Mute Notifications',
          icon: chat.isMuted
            ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
            : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        });
        items.push({
          action: 'archive',
          label: chat.isArchived ? 'Unarchive Chat' : 'Archive Chat',
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>'
        });
      }

      items.push({
        action: 'delete',
        label: 'Delete Chat',
        danger: true,
        icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
      });

      els.chatContextCard.innerHTML = items.map((it) => `
        <button type="button" class="msg-ctx-item${it.danger ? ' danger' : ''}" data-chat-ctx-action="${it.action}">
          ${it.icon}
          <span>${escapeHtml(it.label)}</span>
        </button>
      `).join('');

      els.chatContextOverlay.classList.remove('hidden');
      els.chatContextOverlay.setAttribute('aria-hidden', 'false');

      const vw = window.innerWidth || 360;
      const vh = window.innerHeight || 640;
      const w = els.chatContextCard.offsetWidth || 210;
      const h = els.chatContextCard.offsetHeight || 180;
      const left = Math.max(8, Math.min(anchorX, vw - w - 12));
      const top = Math.max(8, Math.min(anchorY, vh - h - 12));
      els.chatContextCard.style.position = 'fixed';
      els.chatContextCard.style.left = `${left}px`;
      els.chatContextCard.style.top = `${top}px`;
    }

    if (els.chatContextBackdrop) {
      els.chatContextBackdrop.addEventListener('click', closeChatContextMenu);
    }
    if (els.chatContextCard) {
      els.chatContextCard.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-chat-ctx-action]');
        if (!btn || !activeChatMenuId) return;
        const action = btn.dataset.chatCtxAction;
        const chatId = activeChatMenuId;
        const chat = state.chats.find((c) => c.id === chatId);
        closeChatContextMenu();
        if (!chat) return;
        if (action === 'select') {
          enterChatSelectMode(chatId);
        } else if (action === 'pin') {
          await updateChatPrefs(chatId, { pinned: !chat.isPinned });
        } else if (action === 'mute') {
          await updateChatPrefs(chatId, { muted: !chat.isMuted });
          showToast(chat.isMuted ? 'Notifications unmuted' : 'Notifications muted', 'success');
        } else if (action === 'archive') {
          const nextArchived = !chat.isArchived;
          await updateChatPrefs(chatId, { archived: nextArchived });
          showToast(nextArchived ? 'Chat archived' : 'Chat unarchived', 'success');
        } else if (action === 'delete') {
          openDeleteConfirmForChats([chatId]);
        }
      });
    }

    if (els.chatSelCancelBtn) {
      els.chatSelCancelBtn.addEventListener('click', exitChatSelectMode);
    }
    if (els.chatSelPinBtn) {
      els.chatSelPinBtn.addEventListener('click', async () => {
        const ids = Array.from(state.selectedChatIds);
        if (ids.length === 0) return;
        const nextPinned = els.chatSelPinBtn.dataset.nextPinned === '1';
        try {
          await api('/api/chats/bulk-prefs', {
            method: 'POST',
            body: { chatIds: ids, pinned: nextPinned }
          });
          showToast(nextPinned ? 'Pinned selected chats' : 'Unpinned selected chats', 'success');
          exitChatSelectMode();
          await refreshChats();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }
    if (els.chatSelMuteBtn) {
      els.chatSelMuteBtn.addEventListener('click', async () => {
        const ids = Array.from(state.selectedChatIds);
        if (ids.length === 0) return;
        const nextMuted = els.chatSelMuteBtn.dataset.nextMuted === '1';
        try {
          await api('/api/chats/bulk-prefs', {
            method: 'POST',
            body: { chatIds: ids, muted: nextMuted }
          });
          showToast(nextMuted ? 'Muted selected chats' : 'Unmuted selected chats', 'success');
          exitChatSelectMode();
          await refreshChats();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }
    if (els.chatSelArchiveBtn) {
      els.chatSelArchiveBtn.addEventListener('click', async () => {
        const ids = Array.from(state.selectedChatIds);
        if (ids.length === 0) return;
        const nextArchived = els.chatSelArchiveBtn.dataset.nextArchived === '1';
        try {
          await api('/api/chats/bulk-prefs', {
            method: 'POST',
            body: { chatIds: ids, archived: nextArchived }
          });
          showToast(nextArchived ? 'Archived selected chats' : 'Unarchived selected chats', 'success');
          exitChatSelectMode();
          await refreshChats();
          if (state.sidebarFilter === 'archived' && !state.chats.some((c) => c.isArchived)) {
            state.sidebarFilter = 'all';
            renderSidebar();
          }
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }
    if (els.chatSelDeleteBtn) {
      els.chatSelDeleteBtn.addEventListener('click', () => {
        const ids = Array.from(state.selectedChatIds);
        if (ids.length > 0) openDeleteConfirmForChats(ids);
      });
    }

    if (els.deleteConfirmBackdrop) els.deleteConfirmBackdrop.addEventListener('click', closeDeleteConfirmModal);
    if (els.deleteConfirmClose) els.deleteConfirmClose.addEventListener('click', closeDeleteConfirmModal);
    if (els.deleteConfirmCancel) els.deleteConfirmCancel.addEventListener('click', closeDeleteConfirmModal);
    if (els.deleteConfirmSubmit) els.deleteConfirmSubmit.addEventListener('click', submitDeleteConfirmModal);

    function openChatFromSidebarRow(row) {
      if (!row) return;
      if (state.chatSelectMode && row.dataset.chatId) {
        toggleChatSelected(row.dataset.chatId);
        return;
      }
      if (row.dataset.openChat) openRoomById(row.dataset.openChat);
      else if (row.dataset.openUser) openChatWithUser(row.dataset.openUser);
    }
    els.sidebarList.addEventListener('click', (e) => {
      if (Date.now() < suppressSidebarClickUntil) return;
      const openArchivedBtn = e.target.closest('[data-open-archived]');
      if (openArchivedBtn) {
        if (state.chatSelectMode) exitChatSelectMode();
        state.sidebarFilter = 'archived';
        renderSidebar();
        return;
      }
      const archivedBackBtn = e.target.closest('[data-archived-back]');
      if (archivedBackBtn) {
        if (state.chatSelectMode) exitChatSelectMode();
        state.sidebarFilter = 'all';
        renderSidebar();
        return;
      }
      const quickUnarchiveBtn = e.target.closest('[data-quick-unarchive]');
      if (quickUnarchiveBtn) {
        e.stopPropagation();
        const cid = quickUnarchiveBtn.dataset.quickUnarchive;
        if (cid) {
          updateChatPrefs(cid, { archived: false }).then(() => showToast('Chat unarchived', 'success'));
        }
        return;
      }
      const subBtn = e.target.closest('[data-friends-subtab]');
      if (subBtn) {
        state.friendsSubTab = subBtn.dataset.friendsSubtab || 'friends';
        renderSidebar();
        return;
      }
      const friendBtn = e.target.closest('[data-friend-action]');
      if (friendBtn) {
        e.stopPropagation();
        performFriendAction(friendBtn.dataset.friendAction, friendBtn.dataset.friendUser);
        return;
      }
      const row = e.target.closest('[data-chat-id], [data-open-chat], [data-open-user]');
      openChatFromSidebarRow(row);
    });

    els.sidebarList.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.chat-row[data-chat-id]');
      if (!row) return;
      e.preventDefault();
      if (isMobileTouchMode()) return;
      openChatContextMenu(row.dataset.chatId, e.clientX, e.clientY);
    });

    let sidebarLongPressTimer = null;
    let sidebarTouchStartX = 0;
    let sidebarTouchStartY = 0;
    const clearSidebarLongPress = () => {
      if (sidebarLongPressTimer) {
        clearTimeout(sidebarLongPressTimer);
        sidebarLongPressTimer = null;
      }
    };
    els.sidebarList.addEventListener('touchstart', (e) => {
      clearSidebarLongPress();
      const row = e.target.closest('.chat-row[data-chat-id]');
      if (!row || e.target.closest('button')) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      sidebarTouchStartX = t.clientX;
      sidebarTouchStartY = t.clientY;
      const chatId = row.dataset.chatId;
      sidebarLongPressTimer = setTimeout(() => {
        sidebarLongPressTimer = null;
        suppressSidebarClickUntil = Date.now() + 550;
        if (navigator && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(14); } catch { }
        }
        if (els.msgTimerPopover && !els.msgTimerPopover.classList.contains('hidden')) {
          els.msgTimerPopover.classList.add('hidden');
          return;
        }
        if (els.viewOnceModal && !els.viewOnceModal.classList.contains('hidden')) {
          closeAndBurnViewOnceModal();
          return;
        }
        if (state.chatSelectMode) {
          toggleChatSelected(chatId);
        } else {
          enterChatSelectMode(chatId);
        }
      }, 420);
    }, { passive: true });
    els.sidebarList.addEventListener('touchmove', (e) => {
      if (!sidebarLongPressTimer) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - sidebarTouchStartX) > 10 || Math.abs(t.clientY - sidebarTouchStartY) > 10) {
        clearSidebarLongPress();
      }
    }, { passive: true });
    els.sidebarList.addEventListener('touchend', clearSidebarLongPress, { passive: true });
    els.sidebarList.addEventListener('touchcancel', clearSidebarLongPress, { passive: true });
    if (els.infoFriendControls) {
      els.infoFriendControls.addEventListener('click', (e) => {
        const friendBtn = e.target.closest('[data-friend-action]');
        if (!friendBtn) return;
        performFriendAction(friendBtn.dataset.friendAction, friendBtn.dataset.friendUser);
      });
    }
    els.sidebarList.addEventListener('keydown', (e) => {
      const folderTrigger = e.target.closest('[data-open-archived], [data-archived-back]');
      if (folderTrigger && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        folderTrigger.click();
        return;
      }
      const row = e.target.closest('.chat-row[data-open-chat], .chat-row[data-open-user]');
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openChatFromSidebarRow(row);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = row.nextElementSibling;
        if (next && next.classList.contains('chat-row')) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = row.previousElementSibling;
        if (prev && prev.classList.contains('chat-row')) prev.focus();
      }
    });

    // Mobile back button
    els.mobileBackBtn.addEventListener('click', () => {
      saveCurrentChatScroll();
      els.appShell.classList.remove('mobile-chat-open');
      state.activeChatId = null;
      state.activePeer = null;
      state.activeRoom = null;
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

    // Scroll to bottom, scroll persistence & image-load bottom pinning
    let scrollSaveTimer = null;
    const markUserScrolled = () => {
      if (!isNearBottom(90)) {
        state.userScrolledSinceOpen = true;
        state.pinToBottomUntil = 0;
      }
    };
    els.messagesViewport.addEventListener('wheel', () => {
      state.userScrolledSinceOpen = true;
      state.pinToBottomUntil = 0;
    }, { passive: true });
    els.messagesViewport.addEventListener('touchmove', markUserScrolled, { passive: true });

    els.messagesViewport.addEventListener('scroll', () => {
      const nearBottom = isNearBottom();
      els.scrollBottomBtn.classList.toggle('hidden', nearBottom);
      if (!nearBottom && Date.now() > state.pinToBottomUntil) {
        state.userScrolledSinceOpen = true;
      }
      if (nearBottom && state.unreadBelowCount > 0) {
        state.unreadBelowCount = 0;
        updateGlobalUnreadCounters();
        markActiveChatRead();
      }
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(saveCurrentChatScroll, 180);
    });

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        if (state.activeChatId && !state.userScrolledSinceOpen && Date.now() < state.pinToBottomUntil) {
          instantScrollToBottom();
        }
      });
      ro.observe(els.messagesList);
    }
    els.messagesList.addEventListener('load', () => {
      if (state.activeChatId && !state.userScrolledSinceOpen && Date.now() < state.pinToBottomUntil) {
        instantScrollToBottom();
      }
    }, true);

    els.scrollBottomBtn.addEventListener('click', () => {
      state.pinToBottomUntil = Date.now() + 800;
      state.userScrolledSinceOpen = false;
      els.messagesViewport.scrollTo({ top: els.messagesViewport.scrollHeight, behavior: 'smooth' });
      if (state.unreadBelowCount > 0) {
        state.unreadBelowCount = 0;
        updateGlobalUnreadCounters();
        markActiveChatRead();
      }
      setTimeout(saveCurrentChatScroll, 300);
    });

    // Telegram-style Message Context Menu (Left-click on Desktop Website / Long-press on Mobile App)
    let suppressNextClickUntil = 0;

    function isMobileTouchMode() {
      if (window.AndroidBridge) return true;
      return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    }

    async function toggleReactionOnMessage(msgId, emoji) {
      if (!state.activeChatId || !msgId || !emoji) return;
      try {
        await api(`/api/chats/${encodeURIComponent(state.activeChatId)}/messages/${encodeURIComponent(msgId)}/react`, {
          method: 'POST',
          body: { emoji }
        });
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    async function copyMessageText(msg) {
      if (!msg || !msg.text || !navigator.clipboard) return;
      await navigator.clipboard.writeText(msg.text).catch(() => { });
      showToast('Message copied to clipboard', 'success');
    }

    function deleteMessageById(msgId) {
      if (!state.activeChatId || !msgId) return;
      openDeleteConfirmForMessages([msgId]);
    }

    function renderContextReactionBar(msg, expanded) {
      if (!els.msgContextReactions || !msg) return;
      const list = expanded ? [...QUICK_REACTIONS, ...MORE_REACTIONS] : QUICK_REACTIONS;
      const reactions = msg.reactions || {};
      const buttonsHtml = list.map((emoji) => {
        const users = reactions[emoji] || [];
        const active = Array.isArray(users) && state.me && users.includes(state.me.username);
        return `<button type="button" class="msg-ctx-react-btn${active ? ' active' : ''}" data-ctx-react="${escapeHtml(emoji)}" aria-label="React ${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`;
      }).join('');
      const chevronSvg = expanded
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
      const moreBtnHtml = `<button type="button" class="msg-ctx-react-more" data-ctx-more-react="1" aria-label="More reactions">${chevronSvg}</button>`;
      els.msgContextReactions.innerHTML = buttonsHtml + moreBtnHtml;
    }

    function positionMessageContextPopup(anchorX, anchorY, isMine) {
      if (!els.msgContextPopup) return;
      const popup = els.msgContextPopup;
      popup.style.left = '0px';
      popup.style.top = '0px';
      popup.style.alignItems = isMine ? 'flex-end' : 'flex-start';

      requestAnimationFrame(() => {
        const vw = window.innerWidth || 360;
        const vh = window.innerHeight || 640;
        const rect = popup.getBoundingClientRect();
        const pad = 12;

        let left = isMine ? (anchorX - rect.width + 24) : (anchorX - 24);
        left = Math.max(pad, Math.min(vw - rect.width - pad, left));

        let top = anchorY - 56;
        if (top + rect.height > vh - pad) {
          top = Math.max(pad, anchorY - rect.height - 8);
        }
        if (top < pad) top = pad;

        popup.style.left = `${Math.round(left)}px`;
        popup.style.top = `${Math.round(top)}px`;
      });
    }

    function openMessageContextMenu(msgId, anchorX, anchorY) {
      const msg = state.messages.find((m) => m.id === msgId);
      if (!msg || !els.msgContextOverlay || !els.msgContextCard) return;

      if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
        try {
          const sel = window.getSelection();
          if (sel && typeof sel.removeAllRanges === 'function') sel.removeAllRanges();
        } catch {
        }
      }

      closeMessageContextMenu();
      activeMenuMsgId = msgId;
      activeMenuExpanded = false;

      const row = $(`msg-${msgId}`);
      if (row) row.classList.add('menu-active');

      renderContextReactionBar(msg, false);

      const isMine = state.me && msg.sender === state.me.username;
      const firstAtt = Array.isArray(msg.attachments) && msg.attachments[0] ? msg.attachments[0] : null;
      const isChannelReadOnly = Boolean(
        state.activeRoom &&
        state.activeRoom.type === 'channel' &&
        (!state.me || !Array.isArray(state.activeRoom.admins) || !state.activeRoom.admins.includes(state.me.username))
      );
      const isCurrentlyPinned = Boolean(state.pinnedMessage && state.pinnedMessage.id === msg.id);
      const items = [
        {
          action: 'reply',
          label: 'Reply',
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>'
        }
      ];

      if (isMine && msg.kind !== 'game' && msg.kind !== 'call' && msg.kind !== 'sticker' && msg.kind !== 'gif' && msg.kind !== 'poll' && !msg.sticker && !msg.viewOnce) {
        items.push({
          action: 'edit',
          label: 'Edit',
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>'
        });
      }

      if (!isChannelReadOnly && msg.kind !== 'game' && msg.kind !== 'call' && !msg.viewOnce) {
        items.push({
          action: isCurrentlyPinned ? 'unpin' : 'pin',
          label: isCurrentlyPinned ? 'Unpin' : 'Pin',
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>'
        });
      }

      if (msg.text && !msg.viewOnce) {
        items.push({
          action: 'copy',
          label: 'Copy',
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
        });
      }

      if (msg.kind !== 'game' && msg.kind !== 'call' && !msg.viewOnce) {
        items.push({
          action: 'forward',
          label: 'Forward',
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>'
        });
        items.push({
          action: 'select',
          label: 'Select',
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
        });
      }

      if (firstAtt) {
        items.push({
          action: firstAtt.isImage ? 'open-media' : 'download-file',
          label: firstAtt.isImage ? 'View Photo' : 'Download File',
          icon: firstAtt.isImage
            ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
            : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
        });
      }

      if (msg.kind !== 'system' && msg.sender !== 'system') {
        items.push({
          action: 'delete',
          label: 'Delete',
          danger: true,
          icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
        });
      }

      els.msgContextCard.innerHTML = items.map((it) => `
        <button type="button" class="msg-ctx-item${it.danger ? ' danger' : ''}" data-ctx-action="${it.action}">
          ${it.icon}
          <span>${escapeHtml(it.label)}</span>
        </button>
      `).join('');

      els.msgContextOverlay.classList.remove('hidden');
      els.msgContextOverlay.setAttribute('aria-hidden', 'false');
      positionMessageContextPopup(anchorX, anchorY, Boolean(isMine));
    }

    if (els.msgContextBackdrop) {
      els.msgContextBackdrop.addEventListener('click', closeMessageContextMenu);
    }

    if (els.msgContextReactions) {
      els.msgContextReactions.addEventListener('click', async (e) => {
        const moreBtn = e.target.closest('[data-ctx-more-react]');
        if (moreBtn && activeMenuMsgId) {
          activeMenuExpanded = !activeMenuExpanded;
          const msg = state.messages.find((m) => m.id === activeMenuMsgId);
          renderContextReactionBar(msg, activeMenuExpanded);
          return;
        }
        const reactBtn = e.target.closest('[data-ctx-react]');
        if (reactBtn && activeMenuMsgId) {
          const msgId = activeMenuMsgId;
          const emoji = reactBtn.dataset.ctxReact;
          closeMessageContextMenu();
          await toggleReactionOnMessage(msgId, emoji);
        }
      });
    }

    if (els.msgContextCard) {
      els.msgContextCard.addEventListener('click', async (e) => {
        const itemBtn = e.target.closest('[data-ctx-action]');
        if (!itemBtn || !activeMenuMsgId) return;
        const action = itemBtn.dataset.ctxAction;
        const msgId = activeMenuMsgId;
        const msg = state.messages.find((m) => m.id === msgId);
        closeMessageContextMenu();
        if (!msg) return;

        if (action === 'reply') {
          setReply(msgId);
        } else if (action === 'edit') {
          startEditMessage(msgId);
        } else if (action === 'pin') {
          await togglePinMessage(msgId, false);
        } else if (action === 'unpin') {
          await togglePinMessage(msgId, true);
        } else if (action === 'forward') {
          openForwardModal([msgId]);
        } else if (action === 'select') {
          enterSelectMode(msgId);
        } else if (action === 'copy') {
          await copyMessageText(msg);
        } else if (action === 'open-media') {
          const att = msg.attachments && msg.attachments.find((a) => a.isImage);
          if (att) openLightbox(att.url, att.originalName, msg.sender, msg.text || '');
        } else if (action === 'download-file') {
          const att = msg.attachments && msg.attachments[0];
          if (att) {
            const a = document.createElement('a');
            a.href = `${att.url}?download=1`;
            a.download = att.originalName || 'file';
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
        } else if (action === 'delete') {
          await deleteMessageById(msgId);
        }
      });
    }

    // Message list click & long-press delegation
    const handleMediaOrActionClick = async (e) => {
      if (Date.now() < suppressNextClickUntil) return;

      if (state.selectMode && e.currentTarget === els.messagesList) {
        const row = e.target.closest('.msg-row[data-msg-id]');
        if (row && row.dataset.msgId) {
          toggleMessageSelected(row.dataset.msgId);
          return;
        }
      }

      const spoilerEl = e.target.closest('.msg-spoiler');
      if (spoilerEl) {
        spoilerEl.classList.toggle('revealed');
        return;
      }

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
        await toggleReactionOnMessage(reactBtn.dataset.reactMsg, reactBtn.dataset.emoji);
        return;
      }

      const voiceToggleBtn = e.target.closest('[data-voice-toggle]');
      if (voiceToggleBtn) {
        e.stopPropagation();
        const card = voiceToggleBtn.closest('.voice-player');
        if (card) {
          await toggleVoiceMessagePlay(card.dataset.voiceMsg, card.dataset.voiceUrl);
        }
        return;
      }

      const voiceSpeedBtn = e.target.closest('[data-voice-speed]');
      if (voiceSpeedBtn) {
        e.stopPropagation();
        const card = voiceSpeedBtn.closest('.voice-player');
        if (card) {
          cycleVoicePlaybackSpeed(card.dataset.voiceMsg, card.dataset.voiceUrl);
        }
        return;
      }

      const voiceSeekTrack = e.target.closest('[data-voice-seek]');
      if (voiceSeekTrack && typeof voiceSeekTrack.getBoundingClientRect === 'function') {
        e.stopPropagation();
        const card = voiceSeekTrack.closest('.voice-player');
        const rect = voiceSeekTrack.getBoundingClientRect();
        if (card && rect.width > 0) {
          const frac = (e.clientX - rect.left) / rect.width;
          seekVoiceMessage(card.dataset.voiceMsg, card.dataset.voiceUrl, frac);
        }
        return;
      }

      const viewOnceBtn = e.target.closest('[data-open-view-once]');
      if (viewOnceBtn && state.activeChatId) {
        e.stopPropagation();
        await openViewOnceById(viewOnceBtn.dataset.openViewOnce);
        return;
      }

      const pollVoteBtn = e.target.closest('[data-poll-vote]');
      if (pollVoteBtn && state.activeChatId) {
        e.stopPropagation();
        const pollId = pollVoteBtn.dataset.pollId;
        const optIdx = Number(pollVoteBtn.dataset.pollVote);
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.votePollOption === 'function') {
          await window.VibeRoomFeatures.votePollOption(state.activeChatId, pollId, optIdx);
        }
        return;
      }

      const pollCloseBtn = e.target.closest('[data-poll-close]');
      if (pollCloseBtn && state.activeChatId) {
        e.stopPropagation();
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.closePollById === 'function') {
          await window.VibeRoomFeatures.closePollById(state.activeChatId, pollCloseBtn.dataset.pollClose);
        }
        return;
      }

      const rematchBtn = e.target.closest('[data-rematch-game]');
      if (rematchBtn && state.activeChatId) {
        e.stopPropagation();
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.rematchGame === 'function') {
          await window.VibeRoomFeatures.rematchGame(rematchBtn.dataset.rematchGame);
        }
        return;
      }

      const cancelGameBtn = e.target.closest('[data-cancel-game]');
      if (cancelGameBtn && state.activeChatId) {
        e.stopPropagation();
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.cancelGameById === 'function') {
          await window.VibeRoomFeatures.cancelGameById(cancelGameBtn.dataset.cancelGame, state.activeChatId);
        }
        return;
      }

      const callBackBtn = e.target.closest('[data-call-back]');
      if (callBackBtn && state.activePeer) {
        e.stopPropagation();
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.initiateCall === 'function') {
          await window.VibeRoomFeatures.initiateCall(callBackBtn.dataset.callBack || 'audio');
        }
        return;
      }

      const gameTrigger = e.target.closest('[data-open-game]');
      if (gameTrigger && state.activeChatId) {
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.openGameById === 'function') {
          window.VibeRoomFeatures.openGameById(gameTrigger.dataset.openGame);
        }
        return;
      }

      const mentionTag = e.target.closest('[data-mention]');
      if (mentionTag) {
        const targetUsername = mentionTag.dataset.mention;
        if (targetUsername && (!state.me || targetUsername.toLowerCase() !== state.me.username)) {
          await openChatWithUser(targetUsername.toLowerCase());
        }
        return;
      }

      // On desktop websites (fine pointer, non-Android), left-clicking a message bubble opens the action + reaction menu
      if (!isMobileTouchMode() && e.button === 0 && e.currentTarget === els.messagesList) {
        if (e.target.closest('a, button, video, audio, .voice-player, .poll-card, .view-once-card, .msg-actions, .game-card-msg, .call-log-msg, .mention-tag')) return;
        const selected = typeof window.getSelection === 'function' ? String(window.getSelection() || '').trim() : '';
        if (selected.length > 0) return;
        const bubble = e.target.closest('.msg-bubble');
        const row = bubble ? bubble.closest('.msg-row[data-msg-id]') : null;
        if (row && row.dataset.msgId) {
          openMessageContextMenu(row.dataset.msgId, e.clientX, e.clientY);
        }
      }
    };

    els.messagesList.addEventListener('click', handleMediaOrActionClick);
    els.infoSharedContent.addEventListener('click', handleMediaOrActionClick);

    // Mobile Swipe-to-Reply & Long-Press Context Menu on touch devices
    let longPressTimer = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    let swipeState = null;

    function clearLongPressTimer() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    function finishSwipeGesture(triggerReply) {
      if (!swipeState) return;
      const { row, bubble, indicator, msgId, crossedThreshold } = swipeState;
      swipeState = null;
      bubble.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)';
      bubble.style.transform = '';
      setTimeout(() => {
        if (bubble) bubble.style.transition = '';
      }, 200);
      if (indicator && indicator.parentNode === row) {
        indicator.remove();
      }
      if (triggerReply && crossedThreshold && msgId) {
        suppressNextClickUntil = Date.now() + 260;
        setReply(msgId);
      }
    }

    els.messagesList.addEventListener('touchstart', (e) => {
      clearLongPressTimer();
      finishSwipeGesture(false);
      if (!e.touches || e.touches.length !== 1) return;
      if (e.target.closest('button, video, audio')) return;
      const bubble = e.target.closest('.msg-bubble');
      const row = bubble ? bubble.closest('.msg-row[data-msg-id]') : null;
      if (!row || !row.dataset.msgId) return;

      const touch = e.touches[0];
      longPressStartX = touch.clientX;
      longPressStartY = touch.clientY;
      const msgId = row.dataset.msgId;

      swipeState = {
        row,
        bubble,
        msgId,
        startX: touch.clientX,
        startY: touch.clientY,
        decided: false,
        active: false,
        crossedThreshold: false,
        indicator: null
      };

      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        swipeState = null;
        suppressNextClickUntil = Date.now() + 550;
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(14); } catch { }
        }
        openMessageContextMenu(msgId, longPressStartX, longPressStartY);
      }, 430);
    }, { passive: true });

    els.messagesList.addEventListener('touchmove', (e) => {
      if (!e.touches || !e.touches[0]) return;
      const dx = e.touches[0].clientX - longPressStartX;
      const dy = e.touches[0].clientY - longPressStartY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearLongPressTimer();
      }
      if (!swipeState) return;

      if (!swipeState.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        swipeState.decided = true;
        if (Math.abs(dy) > Math.abs(dx) || dx >= 0) {
          swipeState = null;
          return;
        }
        swipeState.active = true;
        swipeState.bubble.style.transition = 'none';
        const indicator = document.createElement('span');
        indicator.className = 'swipe-reply-indicator';
        indicator.textContent = '↩';
        swipeState.row.appendChild(indicator);
        swipeState.indicator = indicator;
      }

      if (swipeState.active) {
        const clamped = Math.max(-72, Math.min(0, dx * 0.72));
        swipeState.bubble.style.transform = `translateX(${clamped}px)`;
        const ratio = Math.min(1, Math.abs(clamped) / 44);
        if (swipeState.indicator) {
          swipeState.indicator.style.opacity = String(ratio);
          swipeState.indicator.style.transform = `translateY(-50%) scale(${0.6 + ratio * 0.45})`;
        }
        const nowCrossed = clamped <= -44;
        if (nowCrossed && !swipeState.crossedThreshold) {
          swipeState.crossedThreshold = true;
          if (swipeState.indicator) swipeState.indicator.classList.add('ready');
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate(10); } catch { }
          }
        } else if (!nowCrossed && swipeState.crossedThreshold) {
          swipeState.crossedThreshold = false;
          if (swipeState.indicator) swipeState.indicator.classList.remove('ready');
        }
      }
    }, { passive: true });

    els.messagesList.addEventListener('touchend', () => {
      clearLongPressTimer();
      finishSwipeGesture(true);
    }, { passive: true });
    els.messagesList.addEventListener('touchcancel', () => {
      clearLongPressTimer();
      finishSwipeGesture(false);
    }, { passive: true });
    els.messagesList.addEventListener('contextmenu', (e) => {
      if (isMobileTouchMode() && e.target.closest('.msg-bubble')) {
        e.preventDefault();
      }
    });

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

    const keepInputFocusOnTap = (e) => {
      if (typeof document !== 'undefined' && document.activeElement === els.messageInput) {
        e.preventDefault();
      }
    };
    els.cancelReplyBtn.addEventListener('pointerdown', keepInputFocusOnTap);
    els.cancelReplyBtn.addEventListener('mousedown', keepInputFocusOnTap);
    els.cancelReplyBtn.addEventListener('click', clearReply);

    if (els.cancelEditBtn) {
      els.cancelEditBtn.addEventListener('pointerdown', keepInputFocusOnTap);
      els.cancelEditBtn.addEventListener('click', () => cancelEditMode(true));
    }

    if (els.pinnedMsgJump) {
      els.pinnedMsgJump.addEventListener('click', () => {
        if (!state.pinnedMessage || !state.pinnedMessage.id) return;
        const targetEl = $(`msg-${state.pinnedMessage.id}`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetEl.classList.remove('highlight-pulse');
          void targetEl.offsetWidth;
          targetEl.classList.add('highlight-pulse');
        } else {
          showToast('Pinned message is outside loaded view.', 'info');
        }
      });
    }
    if (els.unpinMsgBtn) {
      els.unpinMsgBtn.addEventListener('click', () => togglePinMessage(null, true));
    }

    if (els.infoPinChatBtn) {
      els.infoPinChatBtn.addEventListener('click', () => {
        if (!state.activeChatId) return;
        const chatObj = state.chats.find((c) => c.id === state.activeChatId) || state.activeChatMeta || {};
        updateChatPrefs(state.activeChatId, { pinned: !chatObj.isPinned });
      });
    }
    if (els.infoMuteChatBtn) {
      els.infoMuteChatBtn.addEventListener('click', () => {
        if (!state.activeChatId) return;
        const chatObj = state.chats.find((c) => c.id === state.activeChatId) || state.activeChatMeta || {};
        updateChatPrefs(state.activeChatId, { muted: !chatObj.isMuted });
      });
    }
    if (els.infoArchiveChatBtn) {
      els.infoArchiveChatBtn.addEventListener('click', async () => {
        if (!state.activeChatId) return;
        const chatObj = state.chats.find((c) => c.id === state.activeChatId) || state.activeChatMeta || {};
        const nextArchived = !chatObj.isArchived;
        await updateChatPrefs(state.activeChatId, { archived: nextArchived });
        showToast(nextArchived ? 'Chat archived' : 'Chat unarchived', 'success');
      });
    }

    if (els.multiCopyBtn) els.multiCopyBtn.addEventListener('click', multiCopySelected);
    if (els.multiForwardBtn) {
      els.multiForwardBtn.addEventListener('click', () => {
        const ids = Array.from(state.selectedMsgIds);
        if (ids.length > 0) openForwardModal(ids);
      });
    }
    if (els.multiDeleteBtn) els.multiDeleteBtn.addEventListener('click', multiDeleteSelected);
    if (els.multiCancelBtn) els.multiCancelBtn.addEventListener('click', exitSelectMode);

    if (els.forwardModalBackdrop) els.forwardModalBackdrop.addEventListener('click', closeForwardModal);
    if (els.forwardModalClose) els.forwardModalClose.addEventListener('click', closeForwardModal);
    if (els.forwardTargetsList) {
      els.forwardTargetsList.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-forward-target]');
        if (!btn || !state.activeChatId || state.forwardMsgIds.length === 0) return;
        const targetChatId = btn.dataset.forwardTarget;
        const ids = state.forwardMsgIds.slice();
        closeForwardModal();
        try {
          await api(`/api/chats/${encodeURIComponent(state.activeChatId)}/forward`, {
            method: 'POST',
            body: { targetChatIds: [targetChatId], messageIds: ids }
          });
          exitSelectMode();
          showToast('Message forwarded!', 'success');
          await refreshChats();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    if (els.openPollBtn) {
      els.openPollBtn.addEventListener('click', () => {
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.openPollModal === 'function') {
          window.VibeRoomFeatures.openPollModal();
        }
      });
    }

    if (els.msgTimerBtn && els.msgTimerPopover) {
      els.msgTimerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        els.msgTimerPopover.classList.toggle('hidden');
      });
      els.msgTimerPopover.addEventListener('click', (e) => {
        const opt = e.target.closest('[data-timer-mode]');
        if (!opt) return;
        state.composeTimerMode = opt.dataset.timerMode || 'off';
        syncComposerTimerUi();
        els.msgTimerPopover.classList.add('hidden');
        if (state.composeTimerMode === 'viewOnce') {
          showToast('View-Once enabled for next message', 'info');
        } else if (state.composeTimerMode !== 'off') {
          showToast(`Self-destruct timer: ${formatTtlShort(Number(state.composeTimerMode))}`, 'info');
        }
      });
      document.addEventListener('click', (e) => {
        if (!els.msgTimerPopover.classList.contains('hidden') && !e.target.closest('.msg-timer-anchor')) {
          els.msgTimerPopover.classList.add('hidden');
        }
      });
    }

    let activeViewOnceContext = null;
    async function closeAndBurnViewOnceModal() {
      if (els.viewOnceModal) els.viewOnceModal.classList.add('hidden');
      if (els.viewOnceBody) els.viewOnceBody.innerHTML = '';
      const ctx = activeViewOnceContext;
      activeViewOnceContext = null;
      if (ctx && !ctx.alreadyBurned && ctx.chatId && ctx.msgId) {
        try {
          const res = await api(`/api/chats/${encodeURIComponent(ctx.chatId)}/messages/${encodeURIComponent(ctx.msgId)}/view-once/burn`, {
            method: 'POST'
          });
          if (res.message && state.activeChatId === ctx.chatId) {
            const idx = state.messages.findIndex((m) => m.id === res.message.id);
            if (idx >= 0) {
              state.messages[idx] = res.message;
              renderMessages(false);
            }
          }
        } catch {
          // Already burned
        }
      }
    }

    async function openViewOnceById(msgId) {
      if (!state.activeChatId || !msgId) return;
      const chatId = state.activeChatId;
      try {
        const res = await api(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(msgId)}/view-once`, {
          method: 'POST'
        });
        const revealed = res.message;
        if (!revealed || !els.viewOnceModal || !els.viewOnceBody) return;
        activeViewOnceContext = { chatId, msgId, alreadyBurned: Boolean(res.consumed) };

        const parts = [];
        if (Array.isArray(revealed.attachments)) {
          for (const att of revealed.attachments) {
            if (att.isImage) {
              parts.push(`<img class="view-once-media" src="${escapeHtml(att.url)}" alt="${escapeHtml(att.originalName)}" />`);
            } else if (att.mimeType && att.mimeType.startsWith('video/')) {
              parts.push(`<video class="view-once-media" controls autoplay src="${escapeHtml(att.url)}"></video>`);
            } else if (att.mimeType && att.mimeType.startsWith('audio/')) {
              parts.push(`<audio class="view-once-audio" controls autoplay src="${escapeHtml(att.url)}"></audio>`);
            } else {
              parts.push(`<a class="secondary-btn" href="${escapeHtml(att.url)}&download=1" download="${escapeHtml(att.originalName)}">⬇ ${escapeHtml(att.originalName)}</a>`);
            }
          }
        }
        if (revealed.text) {
          parts.push(`<div class="view-once-text">${linkifyText(revealed.text)}</div>`);
        }
        els.viewOnceBody.innerHTML = parts.join('') || '<div class="vr-hint">Empty View-Once content</div>';
        els.viewOnceModal.classList.remove('hidden');

        if (res.consumed) {
          const idx = state.messages.findIndex((m) => m.id === msgId);
          if (idx >= 0) {
            state.messages[idx] = { ...state.messages[idx], consumed: true, viewOnceState: 'consumed' };
            renderMessages(false);
          }
        }
      } catch (err) {
        showToast(err.message || 'Unable to reveal View-Once message.', 'error');
      }
    }

    if (els.viewOnceBackdrop) els.viewOnceBackdrop.addEventListener('click', closeAndBurnViewOnceModal);
    if (els.viewOnceClose) els.viewOnceClose.addEventListener('click', closeAndBurnViewOnceModal);
    if (els.viewOnceDoneBtn) els.viewOnceDoneBtn.addEventListener('click', closeAndBurnViewOnceModal);

    // Voice Note Recorder (hold-to-record OR tap-to-record + live waveform sampling)
    let voiceRecState = null;
    function renderRecLiveWave(levelPct = 18) {
      if (!els.voiceRecWave) return;
      if (els.voiceRecWave.children.length === 0) {
        els.voiceRecWave.innerHTML = Array.from({ length: 18 }, () => '<span class="voice-rec-bar-item" style="height:20%"></span>').join('');
      }
      const bars = Array.from(els.voiceRecWave.children);
      for (let i = 0; i < bars.length - 1; i++) {
        bars[i].style.height = bars[i + 1].style.height || '20%';
      }
      if (bars.length > 0) {
        bars[bars.length - 1].style.height = `${Math.max(14, Math.min(100, Math.round(levelPct)))}%`;
      }
    }

    function downsamplePeaks(samples, count = 28) {
      if (!Array.isArray(samples) || samples.length === 0) return null;
      const out = [];
      const step = samples.length / count;
      for (let i = 0; i < count; i++) {
        const start = Math.floor(i * step);
        const end = Math.max(start + 1, Math.floor((i + 1) * step));
        let maxVal = 0;
        for (let k = start; k < end && k < samples.length; k++) {
          if (samples[k] > maxVal) maxVal = samples[k];
        }
        out.push(Math.max(12, Math.min(100, Math.round(maxVal))));
      }
      return out;
    }

    function cleanupVoiceRecorderUI() {
      if (voiceRecState) {
        if (voiceRecState.timer) clearInterval(voiceRecState.timer);
        if (voiceRecState.meterTimer) clearInterval(voiceRecState.meterTimer);
        if (voiceRecState.audioCtx && typeof voiceRecState.audioCtx.close === 'function') {
          try { voiceRecState.audioCtx.close(); } catch { }
        }
        if (voiceRecState.stream) {
          try { voiceRecState.stream.getTracks().forEach((t) => t.stop()); } catch { }
        }
      }
      voiceRecState = null;
      if (els.voiceRecBar) els.voiceRecBar.classList.add('hidden');
      if (els.voiceRecBtn) els.voiceRecBtn.classList.remove('recording');
      if (els.voiceRecWave) els.voiceRecWave.innerHTML = '';
    }

    async function sendVoiceAudioBlob(blob, mimeType, voiceMeta = null) {
      if (!state.activeChatId || !blob || blob.size < 400) return;
      const chatId = state.activeChatId;
      const ext = mimeType.includes('ogg') ? 'ogg' : (mimeType.includes('mp4') ? 'm4a' : 'webm');
      const fd = new FormData();
      fd.append('text', '');
      if (state.replyTo && state.replyTo.id) fd.append('replyToId', state.replyTo.id);
      if (voiceMeta) fd.append('voiceMeta', JSON.stringify(voiceMeta));
      const { viewOnce, ttlSeconds } = getComposeTimerPayload();
      if (ttlSeconds > 0) fd.append('ttlSeconds', String(ttlSeconds));
      if (viewOnce) fd.append('viewOnce', '1');
      fd.append('files', blob, `voice-${Date.now()}.${ext}`);
      try {
        const data = await sendWithProgress(`/api/chats/${encodeURIComponent(chatId)}/messages`, fd);
        clearReply();
        if (viewOnce) {
          state.composeTimerMode = 'off';
          syncComposerTimerUi();
        }
        if (data.message && !state.messages.some((m) => m.id === data.message.id)) {
          state.messages.push(data.message);
          renderMessages(true);
        }
        playChime('send');
        await refreshChats();
      } catch (err) {
        showToast(err.message || 'Failed to send voice message.', 'error');
      }
    }

    function stopVoiceRecording(shouldSend) {
      if (!voiceRecState) return;
      voiceRecState.shouldSend = Boolean(shouldSend);
      const rec = voiceRecState.recorder;
      if (rec && rec.state !== 'inactive') {
        try { rec.stop(); } catch { cleanupVoiceRecorderUI(); }
      } else {
        cleanupVoiceRecorderUI();
      }
    }

    async function startVoiceRecording() {
      if (!state.activeChatId || voiceRecState) return;
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
        showToast('Voice recording is not supported on this browser.', 'error');
        return;
      }
      try {
        stopVoicePlayback();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeOptions = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
        const chosenMime = mimeOptions.find((m) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m)) || '';
        const recorder = chosenMime ? new MediaRecorder(stream, { mimeType: chosenMime }) : new MediaRecorder(stream);
        const chunks = [];
        const samples = [];
        const startedAt = Date.now();
        voiceRecState = {
          recorder,
          stream,
          chunks,
          samples,
          startedAt,
          timer: null,
          meterTimer: null,
          audioCtx: null,
          shouldSend: false,
          mimeType: chosenMime || 'audio/webm'
        };

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          try {
            const ctx = new AudioCtx();
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            src.connect(analyser);
            const dataArr = new Uint8Array(analyser.frequencyBinCount);
            voiceRecState.audioCtx = ctx;
            voiceRecState.meterTimer = setInterval(() => {
              if (!voiceRecState) return;
              analyser.getByteTimeDomainData(dataArr);
              let sumSq = 0;
              for (let i = 0; i < dataArr.length; i++) {
                const v = (dataArr[i] - 128) / 128;
                sumSq += v * v;
              }
              const rms = Math.sqrt(sumSq / dataArr.length);
              const pct = Math.max(14, Math.min(100, Math.round(14 + rms * 340)));
              samples.push(pct);
              renderRecLiveWave(pct);
            }, 80);
          } catch {
            // Optional live waveform analyser fallback
          }
        }

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        recorder.onstop = async () => {
          const cur = voiceRecState;
          const doSend = cur && cur.shouldSend;
          const type = (cur && cur.mimeType) || 'audio/webm';
          const durationSec = cur ? Math.max(1, Math.round((Date.now() - cur.startedAt) / 1000)) : 1;
          const peaks = cur ? downsamplePeaks(cur.samples, 28) : null;
          const blob = new Blob(chunks, { type });
          cleanupVoiceRecorderUI();
          if (doSend) {
            await sendVoiceAudioBlob(blob, type, { durationSec, peaks: peaks || undefined });
          }
        };

        recorder.start(150);
        if (els.voiceRecBtn) els.voiceRecBtn.classList.add('recording');
        if (els.voiceRecBar) els.voiceRecBar.classList.remove('hidden');
        if (els.voiceRecTimer) els.voiceRecTimer.textContent = '0:00';
        voiceRecState.timer = setInterval(() => {
          if (!voiceRecState || !els.voiceRecTimer) return;
          const sec = Math.floor((Date.now() - voiceRecState.startedAt) / 1000);
          const m = Math.floor(sec / 60);
          const s = String(sec % 60).padStart(2, '0');
          els.voiceRecTimer.textContent = `${m}:${s}`;
        }, 250);
      } catch (err) {
        cleanupVoiceRecorderUI();
        showToast(err.message || 'Microphone permission denied.', 'error');
      }
    }

    if (els.voiceRecBtn) {
      let pressStartMs = 0;
      els.voiceRecBtn.addEventListener('pointerdown', (e) => {
        if (e.button && e.button !== 0) return;
        pressStartMs = Date.now();
        if (!voiceRecState) {
          startVoiceRecording();
        }
      });
      els.voiceRecBtn.addEventListener('pointerup', () => {
        if (!voiceRecState) return;
        const heldMs = Date.now() - pressStartMs;
        // Held > 450ms -> Telegram hold-to-record release-to-send; short tap keeps recording bar open
        if (heldMs > 450) {
          stopVoiceRecording(true);
        }
      });
      els.voiceRecBtn.addEventListener('pointercancel', () => {
        if (voiceRecState) stopVoiceRecording(false);
      });
    }
    if (els.voiceCancelBtn) {
      els.voiceCancelBtn.addEventListener('click', () => stopVoiceRecording(false));
    }
    if (els.voiceSendBtn) {
      els.voiceSendBtn.addEventListener('click', () => stopVoiceRecording(true));
    }

    els.sendBtn.addEventListener('pointerdown', keepInputFocusOnTap);
    els.sendBtn.addEventListener('mousedown', keepInputFocusOnTap);
    els.sendBtn.addEventListener('touchend', (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t || typeof els.sendBtn.getBoundingClientRect !== 'function') return;
      const r = els.sendBtn.getBoundingClientRect();
      const inside = t.clientX >= r.left - 8 && t.clientX <= r.right + 8 && t.clientY >= r.top - 8 && t.clientY <= r.bottom + 8;
      if (!inside) return;
      // Canceling synthetic click & focus transfer on touchend keeps the mobile keyboard open continuously
      e.preventDefault();
      if (typeof document !== 'undefined' && document.activeElement !== els.messageInput) {
        try { els.messageInput.focus({ preventScroll: true }); } catch { }
      }
      sendMessage();
    });
    els.sendBtn.addEventListener('click', sendMessage);

    els.messageInput.addEventListener('input', () => {
      autoResizeInput();
      updateComposerSendMicToggle();
      if (state.activeChatId) {
        saveChatDraft(state.activeChatId, els.messageInput.value);
      }
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

    // Keyboard rich-media insertion (Gboard / SwiftKey / Samsung Keyboard Stickers & GIFs on Mobile Browsers) & Clipboard Paste
    const handleKeyboardOrPasteFiles = (files, e) => {
      if (!files || files.length === 0) return false;
      const first = files[0];
      const isStickerOrGifMime = /^(image\/(gif|webp|apng|png))$/i.test(first.type || '') || /\.(gif|webp|apng)$/i.test(first.name || '');
      const hasNoText = !els.messageInput.value.trim();
      const shouldInstantSend = files.length === 1 && hasNoText && (
        (isMobileTouchMode() && isStickerOrGifMime) ||
        first.type === 'image/gif'
      );
      if (shouldInstantSend) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const kind = first.type === 'image/gif' || /\.gif$/i.test(first.name || '') ? 'gif' : 'sticker';
        sendRichMediaFile(first, kind);
        return true;
      }
      addPendingFiles(files);
      return true;
    };

    els.messageInput.addEventListener('beforeinput', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleKeyboardOrPasteFiles(e.dataTransfer.files, e);
      }
    });

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
        handleKeyboardOrPasteFiles(pastedFiles, e);
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

    // Emoji, Sticker & GIF Picker
    els.emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = els.emojiPopover.classList.contains('hidden');
      els.emojiPopover.classList.toggle('hidden');
      if (willOpen) renderPickerBody();
    });
    if (els.pickerTabs) {
      els.pickerTabs.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-picker-tab]');
        if (!tabBtn) return;
        e.stopPropagation();
        activePickerTab = tabBtn.dataset.pickerTab || 'emoji';
        renderPickerBody();
        if (activePickerTab !== 'emoji' && els.pickerSearchInput) {
          els.pickerSearchInput.focus();
        }
      });
    }
    if (els.pickerSearchInput) {
      els.pickerSearchInput.addEventListener('input', () => renderPickerBody());
    }
    els.emojiPopover.addEventListener('click', async (e) => {
      const stickerBtn = e.target.closest('[data-send-sticker]');
      if (stickerBtn) {
        const stickerId = stickerBtn.dataset.sendSticker;
        els.emojiPopover.classList.add('hidden');
        await sendBuiltInStickerOrGif(stickerId);
        return;
      }
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
      updateComposerSendMicToggle();
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

    async function prepareAvatarUpload(file) {
      if (!file || file.type === 'image/gif' || (!file.type.startsWith('image/') && file.type !== '')) {
        return { blob: file, filename: (file && file.name) || 'avatar.jpg' };
      }
      if (file.size <= 400 * 1024) {
        return { blob: file, filename: file.name || 'avatar.jpg' };
      }
      const objectUrl = URL.createObjectURL(file);
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Image decode failed'));
          el.src = objectUrl;
        });
        const maxDim = 512;
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || maxDim, img.naturalHeight || maxDim));
        const width = Math.max(1, Math.round((img.naturalWidth || maxDim) * scale));
        const height = Math.max(1, Math.round((img.naturalHeight || maxDim) * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) {
          return { blob: file, filename: file.name || 'avatar.jpg' };
        }
        ctx2d.drawImage(img, 0, 0, width, height);

        const preferWebp = file.type === 'image/png' || file.type === 'image/webp';
        let outMime = preferWebp ? 'image/webp' : 'image/jpeg';
        let outBlob = await new Promise((resolve) => canvas.toBlob(resolve, outMime, 0.88));
        if (!outBlob || outBlob.type !== outMime) {
          outMime = 'image/jpeg';
          outBlob = await new Promise((resolve) => canvas.toBlob(resolve, outMime, 0.88));
        }
        if (!outBlob || outBlob.size >= file.size) {
          return { blob: file, filename: file.name || 'avatar.jpg' };
        }
        const baseName = (file.name || 'avatar').replace(/\.[^.]+$/, '');
        const ext = outMime === 'image/webp' ? '.webp' : '.jpg';
        return { blob: outBlob, filename: `${baseName}${ext}` };
      } catch {
        return { blob: file, filename: file.name || 'avatar.jpg' };
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    els.profileAvatarInput.addEventListener('change', async () => {
      const file = els.profileAvatarInput.files[0];
      if (!file) return;
      els.profileAvatarInput.disabled = true;
      try {
        const prepared = await prepareAvatarUpload(file);
        const fd = new FormData();
        fd.append('avatar', prepared.blob, prepared.filename);
        const data = await api('/api/users/me/avatar', { method: 'POST', body: fd });
        state.me = data.user;
        syncProfileAvatarControls();
        updateDrawerUserInfo();
        showToast('Avatar updated!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        els.profileAvatarInput.disabled = false;
        els.profileAvatarInput.value = '';
      }
    });

    els.profileRemoveAvatarBtn.addEventListener('click', async () => {
      if (!state.me || !state.me.avatarUrl) return;
      els.profileRemoveAvatarBtn.disabled = true;
      try {
        const data = await api('/api/users/me/avatar', { method: 'DELETE' });
        state.me = data.user;
        syncProfileAvatarControls();
        updateDrawerUserInfo();
        showToast('Profile picture removed!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        els.profileRemoveAvatarBtn.disabled = false;
      }
    });

    if (els.profileClearBirthdayBtn && els.profileBirthday) {
      els.profileClearBirthdayBtn.addEventListener('click', () => {
        els.profileBirthday.value = '';
        els.profileClearBirthdayBtn.classList.add('hidden');
      });
      els.profileBirthday.addEventListener('change', () => {
        els.profileClearBirthdayBtn.classList.toggle('hidden', !els.profileBirthday.value);
      });
    }

    els.profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const payload = {
          displayName: els.profileDisplayName.value.trim(),
          bio: els.profileBio.value.trim(),
          birthday: els.profileBirthday ? els.profileBirthday.value.trim() : undefined
        };
        if (els.profileUsername) {
          payload.username = els.profileUsername.value.trim().toLowerCase();
        }
        const data = await api('/api/users/me', {
          method: 'PATCH',
          body: payload
        });
        state.me = data.user;
        updateDrawerUserInfo();
        if (data.renamedFrom && state.activePeer) {
          await openChatWithUser(state.activePeer.username);
        }
        await refreshChats();
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
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && state.me && state.chats.length > 0) {
        e.preventDefault();
        const curIdx = state.chats.findIndex((c) => c.id === state.activeChatId);
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const nextIdx = curIdx < 0
          ? 0
          : (curIdx + delta + state.chats.length) % state.chats.length;
        const nextChat = state.chats[nextIdx];
        if (nextChat) {
          if (nextChat.type === 'group' || nextChat.type === 'channel') {
            openRoomById(nextChat.id);
          } else if (nextChat.peer) {
            openChatWithUser(nextChat.peer.username);
          }
        }
        return;
      }
      if (e.key === 'Escape') {
        if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.handleEscape === 'function') {
          if (window.VibeRoomFeatures.handleEscape()) return;
        }
        if (els.reportUserModal && !els.reportUserModal.classList.contains('hidden')) {
          closeReportModal();
          return;
        }
        if (els.userPreviewModal && !els.userPreviewModal.classList.contains('hidden')) {
          closeUserPreviewModal();
          return;
        }
        if (els.deleteConfirmModal && !els.deleteConfirmModal.classList.contains('hidden')) {
          closeDeleteConfirmModal();
          return;
        }
        if (els.chatContextOverlay && !els.chatContextOverlay.classList.contains('hidden')) {
          closeChatContextMenu();
          return;
        }
        if (els.msgTimerPopover && !els.msgTimerPopover.classList.contains('hidden')) {
          els.msgTimerPopover.classList.add('hidden');
          return;
        }
        if (els.viewOnceModal && !els.viewOnceModal.classList.contains('hidden')) {
          closeAndBurnViewOnceModal();
          return;
        }
        if (state.chatSelectMode) {
          exitChatSelectMode();
          return;
        }
        if (els.msgContextOverlay && !els.msgContextOverlay.classList.contains('hidden')) {
          closeMessageContextMenu();
          return;
        }
        if (els.forwardModal && !els.forwardModal.classList.contains('hidden')) {
          closeForwardModal();
          return;
        }
        if (state.selectMode) {
          exitSelectMode();
          return;
        }
        if (state.editingMessage) {
          cancelEditMode(true);
          return;
        }
        closeLightbox();
        closeProfileModal();
        closeSettingsModal();
        closeDrawer();
        closeChatSearch();
        els.emojiPopover.classList.add('hidden');
        if (els.mentionPopover) els.mentionPopover.classList.add('hidden');
        if (state.replyTo) clearReply();
      }
    });
  }

  async function onAuthenticated(user) {
    state.me = user;
    showAppShell();
    updateNotificationBanner();
    updateAppUpdateUI();
    syncAndroidState(true);
    connectRealtime();
    ensureWebPushSubscribed();
    syncAndroidFcmToken();
    await Promise.all([refreshChats(), refreshFriends(), refreshBlockedUsers()]);
    if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.onAuthenticated === 'function') {
      await window.VibeRoomFeatures.onAuthenticated(user);
    }
    if (state.queuedAndroidShare) {
      const queued = state.queuedAndroidShare;
      state.queuedAndroidShare = null;
      handleIncomingAndroidShare(queued);
    }
    if (state.pendingDeepLinkChatId) {
      const targetChatId = state.pendingDeepLinkChatId;
      state.pendingDeepLinkChatId = null;
      await openChatByIdOrSender(targetChatId, null);
    }
    if (state.pendingProfileLinkUser) {
      const targetHandle = state.pendingProfileLinkUser;
      state.pendingProfileLinkUser = null;
      await openUserProfilePreviewModal(targetHandle);
    }
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
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      setInterval(() => {
        if (!state.activeChatId || !Array.isArray(state.messages) || state.messages.length === 0) return;
        const now = Date.now();
        let removedAny = false;
        const remaining = [];
        for (const m of state.messages) {
          if (m && m.expiresAt && new Date(m.expiresAt).getTime() <= now) {
            removedAny = true;
          } else {
            remaining.push(m);
          }
        }
        if (removedAny) {
          state.messages = remaining;
          renderMessages(false);
          refreshChats();
          return;
        }
        document.querySelectorAll('.msg-ttl-badge[data-expires-at]').forEach((badge) => {
          badge.textContent = `⏱ ${formatTtlFromIso(badge.dataset.expiresAt)}`;
        });
      }, 1000);
    }
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
  window.__telechatOnFcmToken = (token) => syncAndroidFcmToken(token);
  window.__telechatOnUpdateStatus = (info) => updateAppUpdateUI(info);
  window.__telechatReceiveShare = (payload) => handleIncomingAndroidShare(payload);
  window.__telechatReceiveKeyboardMedia = (payload) => handleIncomingKeyboardMedia(payload);
  window.__telechatOpenUpdates = () => {
    openSettingsModal('updates');
    updateAppUpdateUI();
  };
  window.__telechatHandleBack = () => {
    if (window.VibeRoomFeatures && typeof window.VibeRoomFeatures.handleEscape === 'function') {
      if (window.VibeRoomFeatures.handleEscape()) return true;
    }
    if (els.viewOnceModal && !els.viewOnceModal.classList.contains('hidden')) { closeAndBurnViewOnceModal(); return true; }
    if (els.reportUserModal && !els.reportUserModal.classList.contains('hidden')) { closeReportModal(); return true; }
    if (els.userPreviewModal && !els.userPreviewModal.classList.contains('hidden')) { closeUserPreviewModal(); return true; }
    if (els.deleteConfirmModal && !els.deleteConfirmModal.classList.contains('hidden')) { closeDeleteConfirmModal(); return true; }
    if (els.chatContextOverlay && !els.chatContextOverlay.classList.contains('hidden')) { els.chatContextOverlay.classList.add('hidden'); return true; }
    if (state.chatSelectMode) { exitChatSelectMode(); return true; }
    if (els.forwardModal && !els.forwardModal.classList.contains('hidden')) { closeForwardModal(); return true; }
    if (state.selectMode) { exitSelectMode(); return true; }
    if (els.msgContextOverlay && !els.msgContextOverlay.classList.contains('hidden')) { closeMessageContextMenu(); return true; }
    if (!els.lightboxModal.classList.contains('hidden')) { closeLightbox(); return true; }
    if (!els.settingsModal.classList.contains('hidden')) {
      if (isMobileSettingsViewport() && settingsMobileView === 'detail') {
        showSettingsMobileMenu();
      } else {
        closeSettingsModal();
      }
      return true;
    }
    if (!els.profileModal.classList.contains('hidden')) { closeProfileModal(); return true; }
    if (els.navDrawer.classList.contains('open')) { closeDrawer(); return true; }
    if (state.infoOpen) { toggleInfoDrawer(false); return true; }
    if (els.appShell.classList.contains('mobile-chat-open')) {
      saveCurrentChatScroll();
      els.appShell.classList.remove('mobile-chat-open');
      state.activeChatId = null;
      state.activePeer = null;
      state.activeRoom = null;
      syncAndroidState();
      renderSidebar();
      return true;
    }
    if (state.pendingShare) {
      clearPendingShare(true);
      return true;
    }
    return false;
  };

  window.VibeRoomCore = {
    getState: () => state,
    getEls: () => els,
    api,
    openChatWithUser,
    openRoomById,
    openSavedMessages,
    refreshChats,
    refreshFriends,
    performFriendAction,
    getRelationshipForUser,
    renderSidebar,
    renderMessages,
    renderInfoDrawer,
    toggleInfoDrawer,
    closeDrawer,
    showToast,
    renderAvatar,
    initialsFor,
    escapeHtml,
    formatTime,
    saveChatDraft
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveCurrentChatScroll();
    syncAndroidState(!document.hidden);
  });
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', saveCurrentChatScroll);
  }

  async function boot() {
    applyPrefs();
    setupMobileViewportSync();
    registerServiceWorker();
    initEmojiPopover();
    wireEvents();
    updateAppUpdateUI();
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      try {
        const params = new URLSearchParams(window.location.search);
        const uParam = params.get('user');
        const cParam = params.get('chatId');
        if (cParam) {
          state.pendingDeepLinkChatId = cParam.trim();
        }
        if (uParam) {
          state.pendingProfileLinkUser = uParam.trim().replace(/^@+/, '').toLowerCase();
          if (window.history && typeof window.history.replaceState === 'function') {
            params.delete('user');
            params.delete('chatId');
            const remaining = params.toString();
            const nextUrl = window.location.pathname + (remaining ? `?${remaining}` : '') + (window.location.hash || '');
            window.history.replaceState({}, '', nextUrl);
          }
        } else if (cParam && window.history && typeof window.history.replaceState === 'function') {
          params.delete('chatId');
          const remaining = params.toString();
          const nextUrl = window.location.pathname + (remaining ? `?${remaining}` : '') + (window.location.hash || '');
          window.history.replaceState({}, '', nextUrl);
        }
      } catch { }
    }
    if (hasAndroidUpdater()) {
      try {
        window.AndroidBridge.checkForAppUpdate(false);
      } catch {
      }
    }

    try {
      const data = await api('/api/auth/me');
      await onAuthenticated(data.user);
    } catch {
      showAuthScreen();
    }
  }

  boot();
})();
