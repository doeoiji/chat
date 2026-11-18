/**
 * Zero-dependency animated Stickers & GIF reaction cards for VibeRoom.
 */
(function (root) {
  'use strict';

  const STICKERS = [
    { id: 'stk_wave', type: 'sticker', pack: 'Moods', emoji: '👋', label: 'Hey Wave', bg: 'linear-gradient(135deg,#4facfe,#00f2fe)', anim: 'vr-stk-wobble' },
    { id: 'stk_heart', type: 'sticker', pack: 'Love', emoji: '❤️', label: 'Big Love', bg: 'linear-gradient(135deg,#ff416c,#ff4b2b)', anim: 'vr-stk-pulse' },
    { id: 'stk_laugh', type: 'sticker', pack: 'Moods', emoji: '😂', label: 'ROFL', bg: 'linear-gradient(135deg,#f7971e,#ffd200)', anim: 'vr-stk-bounce' },
    { id: 'stk_fire', type: 'sticker', pack: 'Party', emoji: '🔥', label: 'On Fire', bg: 'linear-gradient(135deg,#f12711,#f5af19)', anim: 'vr-stk-pulse' },
    { id: 'stk_party', type: 'sticker', pack: 'Party', emoji: '🥳', label: 'Celebrate', bg: 'linear-gradient(135deg,#8e2de2,#4a00e0)', anim: 'vr-stk-wobble' },
    { id: 'stk_cool', type: 'sticker', pack: 'Moods', emoji: '😎', label: 'Cool Shades', bg: 'linear-gradient(135deg,#11998e,#38ef7d)', anim: 'vr-stk-float' },
    { id: 'stk_shocked', type: 'sticker', pack: 'Moods', emoji: '😱', label: 'Whoa', bg: 'linear-gradient(135deg,#667eea,#764ba2)', anim: 'vr-stk-shake' },
    { id: 'stk_cry', type: 'sticker', pack: 'Moods', emoji: '😭', label: 'Crying', bg: 'linear-gradient(135deg,#2193b0,#6dd5ed)', anim: 'vr-stk-bounce' },
    { id: 'stk_gg', type: 'sticker', pack: 'Party', emoji: '🏆', label: 'GG Champ', bg: 'linear-gradient(135deg,#f7b733,#fc4a1a)', anim: 'vr-stk-float' },
    { id: 'stk_rocket', type: 'sticker', pack: 'Party', emoji: '🚀', label: 'Let’s Go', bg: 'linear-gradient(135deg,#396afc,#2948ff)', anim: 'vr-stk-float' },
    { id: 'stk_hug', type: 'sticker', pack: 'Love', emoji: '🫂', label: 'Warm Hug', bg: 'linear-gradient(135deg,#ec008c,#fc6767)', anim: 'vr-stk-pulse' },
    { id: 'stk_kiss', type: 'sticker', pack: 'Love', emoji: '😘', label: 'Muah', bg: 'linear-gradient(135deg,#ff758c,#ff7eb3)', anim: 'vr-stk-wobble' },
    { id: 'stk_ghost', type: 'sticker', pack: 'Moods', emoji: '👻', label: 'Spooky Hi', bg: 'linear-gradient(135deg,#606c88,#3f4c6b)', anim: 'vr-stk-float' },
    { id: 'stk_thumbs', type: 'sticker', pack: 'Moods', emoji: '👍', label: 'Nice!', bg: 'linear-gradient(135deg,#36d1dc,#5b86e5)', anim: 'vr-stk-bounce' },
    { id: 'stk_clap', type: 'sticker', pack: 'Party', emoji: '👏', label: 'Bravo', bg: 'linear-gradient(135deg,#56ab2f,#a8e063)', anim: 'vr-stk-wobble' },
    { id: 'stk_coffee', type: 'sticker', pack: 'Moods', emoji: '☕', label: 'Coffee Break', bg: 'linear-gradient(135deg,#c79081,#dfa579)', anim: 'vr-stk-float' },
    { id: 'stk_game', type: 'sticker', pack: 'Party', emoji: '🎮', label: 'Play Now', bg: 'linear-gradient(135deg,#7f00ff,#e100ff)', anim: 'vr-stk-wobble' },
    { id: 'stk_star', type: 'sticker', pack: 'Love', emoji: '✨', label: 'Sparkles', bg: 'linear-gradient(135deg,#f83600,#f9d423)', anim: 'vr-stk-pulse' }
  ];

  const GIFS = [
    { id: 'gif_yay', type: 'gif', emoji: '🎉', label: 'YAY!!', sub: 'CONFETTI TIME', bg: 'linear-gradient(135deg,#7F00FF,#E100FF)', anim: 'vr-gif-pop' },
    { id: 'gif_haha', type: 'gif', emoji: '🤣', label: 'HAHAHA!', sub: 'TOO FUNNY', bg: 'linear-gradient(135deg,#F7971E,#FFD200)', anim: 'vr-gif-shake' },
    { id: 'gif_love', type: 'gif', emoji: '💖', label: 'LOVE THIS', sub: '100% VIBE', bg: 'linear-gradient(135deg,#FF416C,#FF4B2B)', anim: 'vr-gif-pulse' },
    { id: 'gif_gg', type: 'gif', emoji: '👑', label: 'GG EZ!', sub: 'VICTORY ROYALE', bg: 'linear-gradient(135deg,#00B4DB,#0083B0)', anim: 'vr-gif-pop' },
    { id: 'gif_fire', type: 'gif', emoji: '🔥', label: 'SO LIT', sub: 'PURE HEAT', bg: 'linear-gradient(135deg,#FF512F,#F09819)', anim: 'vr-gif-pulse' },
    { id: 'gif_omg', type: 'gif', emoji: '🤯', label: 'NO WAY!', sub: 'MIND BLOWN', bg: 'linear-gradient(135deg,#4776E6,#8E54E9)', anim: 'vr-gif-shake' },
    { id: 'gif_dance', type: 'gif', emoji: '🕺', label: 'VIBE CHECK', sub: 'DANCE PARTY', bg: 'linear-gradient(135deg,#11998E,#38EF7D)', anim: 'vr-gif-pop' },
    { id: 'gif_sleep', type: 'gif', emoji: '😴', label: 'GOOD NIGHT', sub: 'ZZZ...', bg: 'linear-gradient(135deg,#141E30,#243B55)', anim: 'vr-gif-pulse' },
    { id: 'gif_hi', type: 'gif', emoji: '🙋', label: 'HIII!!', sub: 'WHAT’S UP', bg: 'linear-gradient(135deg,#56CCF2,#2F80ED)', anim: 'vr-gif-pop' },
    { id: 'gif_popcorn', type: 'gif', emoji: '🍿', label: 'DRAMA', sub: 'WATCHING NOW', bg: 'linear-gradient(135deg,#D31027,#EA384D)', anim: 'vr-gif-shake' },
    { id: 'gif_load', type: 'gif', emoji: '⏳', label: 'LOADING...', sub: 'BRAIN PROCESSING', bg: 'linear-gradient(135deg,#373B44,#4286f4)', anim: 'vr-gif-pulse' },
    { id: 'gif_100', type: 'gif', emoji: '💯', label: 'FACTS!', sub: 'NO CAP', bg: 'linear-gradient(135deg,#00c6ff,#0072ff)', anim: 'vr-gif-pop' }
  ];

  const ALL_BY_ID = new Map();
  for (const s of [...STICKERS, ...GIFS]) {
    ALL_BY_ID.set(s.id, s);
  }

  function escapeAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getById(id) {
    return ALL_BY_ID.get(id) || null;
  }

  function searchItems(kind, query) {
    const src = kind === 'gif' ? GIFS : STICKERS;
    const q = String(query || '').trim().toLowerCase();
    if (!q) return src;
    return src.filter((item) =>
      (item.label && item.label.toLowerCase().includes(q)) ||
      (item.pack && item.pack.toLowerCase().includes(q)) ||
      (item.sub && item.sub.toLowerCase().includes(q)) ||
      (item.emoji && item.emoji.includes(q))
    );
  }

  function renderBubbleHtml(stickerData) {
    if (!stickerData) return '';
    const ref = getById(stickerData.id) || stickerData;
    const emoji = escapeAttr(ref.emoji || '🎭');
    const label = escapeAttr(ref.label || 'Sticker');
    const isGif = ref.type === 'gif' || stickerData.type === 'gif';
    const bg = escapeAttr(ref.bg || 'linear-gradient(135deg,#5288C1,#3A6EA5)');
    const anim = escapeAttr(ref.anim || (isGif ? 'vr-gif-pop' : 'vr-stk-float'));

    if (isGif) {
      const sub = escapeAttr(ref.sub || '');
      return `
        <div class="vr-gif-card ${anim}" style="background:${bg}">
          <span class="vr-gif-badge">GIF</span>
          <div class="vr-gif-emoji">${emoji}</div>
          <div class="vr-gif-title">${label}</div>
          ${sub ? `<div class="vr-gif-sub">${sub}</div>` : ''}
        </div>
      `;
    }
    return `
      <div class="vr-sticker-card ${anim}" title="${label}">
        <div class="vr-sticker-aura" style="background:${bg}"></div>
        <div class="vr-sticker-emoji">${emoji}</div>
        <div class="vr-sticker-tag">${label}</div>
      </div>
    `;
  }

  const api = { STICKERS, GIFS, getById, searchItems, renderBubbleHtml };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.VibeRoomStickers = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
