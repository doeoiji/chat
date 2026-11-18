(() => {
  'use strict';

  const core = () => window.VibeRoomCore;
  const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

  const STRANGER_TAG_PRESETS = [
    'chill', 'gaming', 'music', 'movies', 'coding', 'anime', 'books', 'sports', 'memes', 'travel'
  ];

  const CHESS_UNICODE = {
    K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
    k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'
  };

  const fState = {
    // Stranger Lounge
    strangerStatus: 'idle', // 'idle' | 'searching' | 'matched' | 'ended'
    strangerInterests: ['chill', 'gaming'],
    strangerLanguage: 'any',
    strangerSession: null,
    strangerEndedReason: '',
    strangerTyping: false,
    strangerTypingTimer: null,
    strangerRevealInfo: null, // { friend, dmChatId }

    // Games
    activeGameId: null,
    activeGameChatId: null,
    gamesTab: 'play', // 'play' | 'leaderboard'
    chessSelectedSq: null,
    chessBusy: false,

    // WebRTC Call
    call: null, // { id, role: 'caller'|'callee', peerUsername, peerProfile, mode, status, startedAt }
    callTimerId: null,
    callMuted: false,
    callCamOff: false,
    callFacing: 'user',
    callMinimized: false,
    localStream: null,
    remoteStream: null,
    pc: null,
    pendingIce: [],
    ringOscTimer: null,
    ringAudioCtx: null,

    // Mention autocomplete
    mentionMatches: [],
    mentionActiveIdx: 0,
    mentionRange: null
  };

  function el(id) {
    return $(id);
  }

  function esc(str) {
    return core() ? core().escapeHtml(str) : String(str || '').replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  }

  function getMyUsername() {
    const c = core();
    const s = c ? c.getState() : null;
    return s && s.me ? s.me.username : '';
  }

  // =========================================================================
  // 1. Groups & Channels Manager + @Mention Autocomplete
  // =========================================================================
  let groupModalTab = 'create'; // 'create' | 'join'
  let groupCreateType = 'group'; // 'group' | 'channel'
  let selectedGroupMembers = new Set();

  function openGroupModal(tab = 'create') {
    const modal = el('group-modal');
    if (!modal) return;
    groupModalTab = tab;
    selectedGroupMembers = new Set();
    renderGroupModal();
    modal.classList.remove('hidden');
  }

  function closeGroupModal() {
    const modal = el('group-modal');
    if (modal) modal.classList.add('hidden');
  }

  function renderGroupModal() {
    const titleEl = el('group-modal-title');
    const bodyEl = el('group-modal-body');
    if (!bodyEl || !core()) return;
    const state = core().getState();
    const friendsList = Array.isArray(state.friends) ? state.friends : [];

    if (titleEl) {
      titleEl.textContent = groupModalTab === 'join' ? 'Join via Invite' : 'New Group / Channel';
    }

    const tabsHtml = `
      <div class="vr-seg-tabs" role="tablist">
        <button type="button" class="vr-seg-tab ${groupModalTab === 'create' ? 'active' : ''}" data-grp-tab="create">Create New</button>
        <button type="button" class="vr-seg-tab ${groupModalTab === 'join' ? 'active' : ''}" data-grp-tab="join">Join with Invite</button>
      </div>
    `;

    if (groupModalTab === 'join') {
      bodyEl.innerHTML = `
        ${tabsHtml}
        <form id="grp-join-form" class="vr-stack">
          <div class="field-group">
            <label for="grp-invite-input">Invite Code or Link</label>
            <input id="grp-invite-input" type="text" placeholder="Paste invite link or code (e.g. a1b2c3d4e5)" required />
          </div>
          <p class="vr-hint">Anyone with a valid VibeRoom Group or Channel invite link can join right away.</p>
          <div class="modal-actions">
            <button type="submit" class="primary-btn">Join Room</button>
          </div>
        </form>
      `;
      const joinForm = el('grp-join-form');
      if (joinForm) {
        joinForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const raw = (el('grp-invite-input').value || '').trim();
          const match = /[?&]join=([a-zA-Z0-9_-]+)/.exec(raw);
          const code = match ? match[1] : raw.replace(/^.*\/+/, '').trim();
          if (!code) return;
          try {
            const res = await core().api('/api/groups/join', {
              method: 'POST',
              body: { inviteCode: code }
            });
            closeGroupModal();
            await core().refreshChats();
            if (res.chat && res.chat.id) await core().openRoomById(res.chat.id);
            core().showToast(`Joined ${res.chat ? res.chat.title : 'room'}!`, 'success');
          } catch (err) {
            core().showToast(err.message, 'error');
          }
        });
      }
      return;
    }

    bodyEl.innerHTML = `
      ${tabsHtml}
      <form id="grp-create-form" class="vr-stack">
        <div class="vr-seg-tabs compact">
          <button type="button" class="vr-seg-tab ${groupCreateType === 'group' ? 'active' : ''}" data-grp-type="group">👥 Group Chat</button>
          <button type="button" class="vr-seg-tab ${groupCreateType === 'channel' ? 'active' : ''}" data-grp-type="channel">📢 Broadcast Channel</button>
        </div>
        <p class="vr-hint">
          ${groupCreateType === 'channel'
            ? 'In a Broadcast Channel, only admins can post updates while subscribers read and react.'
            : 'In a Group Chat, everyone can message, reply, @mention, and play mini-games together.'}
        </p>
        <div class="field-group">
          <label for="grp-title-input">${groupCreateType === 'channel' ? 'Channel Name' : 'Group Name'}</label>
          <input id="grp-title-input" type="text" maxlength="64" placeholder="${groupCreateType === 'channel' ? 'e.g. Weekend Announcements' : 'e.g. Squad Chat'}" required />
        </div>
        <div class="field-group">
          <label for="grp-desc-input">Description (optional)</label>
          <input id="grp-desc-input" type="text" maxlength="200" placeholder="What is this room about?" />
        </div>
        <div class="field-group">
          <label for="grp-member-add">Add Friends by @username</label>
          <div class="vr-inline-row">
            <input id="grp-member-add" type="text" placeholder="Type friend's @username and click Add" />
            <button type="button" id="grp-member-add-btn" class="secondary-btn">Add</button>
          </div>
          <p class="vr-hint" style="margin-top:4px;">Only friends can be added directly. Anyone else can join anytime via the invite link.</p>
          <div id="grp-selected-chips" class="vr-chips-wrap"></div>
          ${friendsList.length > 0 ? `
            <div class="vr-quick-peers">
              <span class="vr-sub-label">Quick pick from Friends:</span>
              <div class="vr-chips-wrap">
                ${friendsList.slice(0, 12).map((p) => `
                  <button type="button" class="vr-chip-btn ${selectedGroupMembers.has(p.username) ? 'selected' : ''}" data-grp-pick="${esc(p.username)}">
                    @${esc(p.username)}
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
        <div class="modal-actions">
          <button type="submit" class="primary-btn">Create ${groupCreateType === 'channel' ? 'Channel' : 'Group'}</button>
        </div>
      </form>
    `;

    renderSelectedGroupChips();

    const addBtn = el('grp-member-add-btn');
    const addInp = el('grp-member-add');
    const addTypedMember = () => {
      if (!addInp) return;
      const uname = addInp.value.trim().replace(/^@+/, '').toLowerCase();
      if (!uname) return;
      if (uname !== getMyUsername()) {
        selectedGroupMembers.add(uname);
      }
      addInp.value = '';
      renderGroupModal();
    };
    if (addBtn) addBtn.addEventListener('click', addTypedMember);
    if (addInp) {
      addInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addTypedMember();
        }
      });
    }

    const createForm = el('grp-create-form');
    if (createForm) {
      createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = (el('grp-title-input').value || '').trim();
        const description = (el('grp-desc-input').value || '').trim();
        if (!title) return;
        try {
          const data = await core().api('/api/groups', {
            method: 'POST',
            body: {
              type: groupCreateType,
              title,
              description,
              members: Array.from(selectedGroupMembers)
            }
          });
          closeGroupModal();
          await core().refreshChats();
          if (data.chat && data.chat.id) {
            await core().openRoomById(data.chat.id);
          }
          core().showToast(`${groupCreateType === 'channel' ? 'Channel' : 'Group'} created!`, 'success');
        } catch (err) {
          core().showToast(err.message, 'error');
        }
      });
    }
  }

  function renderSelectedGroupChips() {
    const wrap = el('grp-selected-chips');
    if (!wrap) return;
    const list = Array.from(selectedGroupMembers);
    if (list.length === 0) {
      wrap.innerHTML = '<span class="vr-hint">No members selected yet (you can invite more later via link).</span>';
      return;
    }
    wrap.innerHTML = list.map((u) => `
      <span class="vr-chip active">@${esc(u)} <button type="button" data-grp-remove-chip="${esc(u)}" aria-label="Remove @${esc(u)}">&times;</button></span>
    `).join('');
  }

  function buildInviteUrl(inviteCode) {
    if (!inviteCode) return '';
    if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null') {
      return `${window.location.origin}/?join=${encodeURIComponent(inviteCode)}`;
    }
    return inviteCode;
  }

  function getRoomMemberProfiles(room) {
    if (!room) return [];
    if (Array.isArray(room.members) && room.members.length > 0 && typeof room.members[0] === 'object') {
      return room.members;
    }
    if (Array.isArray(room.participants)) {
      return room.participants.map((u) => ({ username: u, displayName: u }));
    }
    return [];
  }

  function renderRoomInfo(container, room) {
    if (!container || !room || !core()) return;
    const me = getMyUsername();
    const isAdmin = Array.isArray(room.admins) && room.admins.includes(me);
    const profiles = getRoomMemberProfiles(room);
    const inviteUrl = buildInviteUrl(room.inviteCode);

    container.innerHTML = `
      <div class="vr-room-section">
        <div class="info-label">Invite Link</div>
        <div class="vr-invite-box">
          <code class="vr-invite-code">${esc(inviteUrl)}</code>
          <div class="vr-inline-btns">
            <button type="button" class="secondary-btn sm" data-room-copy-invite>Copy</button>
            ${isAdmin ? '<button type="button" class="secondary-btn sm" data-room-regen-invite>Reset</button>' : ''}
          </div>
        </div>
      </div>

      ${isAdmin ? `
        <div class="vr-room-section">
          <div class="info-label">Admin Controls</div>
          <form id="room-edit-form" class="vr-inline-edit">
            <input id="room-edit-title" type="text" maxlength="64" value="${esc(room.title || '')}" placeholder="Room title" required />
            <input id="room-edit-desc" type="text" maxlength="200" value="${esc(room.description || '')}" placeholder="Description" />
            <button type="submit" class="secondary-btn sm">Save Info</button>
          </form>
          <form id="room-add-member-form" class="vr-inline-row" style="margin-top:8px;">
            <input id="room-add-member-input" type="text" placeholder="Add @username" />
            <button type="submit" class="secondary-btn sm">Add</button>
          </form>
        </div>
      ` : ''}

      <div class="vr-room-section">
        <div class="info-label">Members (${profiles.length || room.memberCount || 0})</div>
        <div class="vr-member-list">
          ${profiles.map((m) => {
            const mIsAdmin = Array.isArray(room.admins) && room.admins.includes(m.username);
            const isCreator = room.createdBy === m.username;
            const isSelf = m.username === me;
            return `
              <div class="vr-member-row">
                <div class="vr-member-left" data-open-dm-user="${esc(m.username)}">
                  <div class="avatar sm" style="background:${esc(m.avatarColor || 'var(--accent)')}">
                    ${m.avatarUrl ? `<img src="${esc(m.avatarUrl)}" alt=""/>` : esc(core().initialsFor(m))}
                  </div>
                  <div class="vr-member-meta">
                    <div class="vr-member-name">
                      ${esc(m.displayName || m.username)}
                      ${isCreator ? '<span class="vr-role-badge owner">Owner</span>' : (mIsAdmin ? '<span class="vr-role-badge admin">Admin</span>' : '')}
                    </div>
                    <div class="vr-member-sub">@${esc(m.username)}${m.online ? ' • online' : ''}</div>
                  </div>
                </div>
                ${isAdmin && !isSelf && !isCreator ? `
                  <div class="vr-member-actions">
                    <button type="button" class="icon-btn sm" data-room-toggle-admin="${esc(m.username)}" data-next-admin="${mIsAdmin ? '0' : '1'}" title="${mIsAdmin ? 'Demote Admin' : 'Make Admin'}">
                      ${mIsAdmin ? '⬇' : '⭐'}
                    </button>
                    <button type="button" class="icon-btn sm danger" data-room-kick="${esc(m.username)}" title="Remove member">&times;</button>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="vr-room-section">
        <button type="button" class="danger-btn full-width" data-room-leave>Leave ${room.type === 'channel' ? 'Channel' : 'Group'}</button>
      </div>
    `;

    const editForm = el('room-edit-form');
    if (editForm) {
      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await core().api(`/api/groups/${encodeURIComponent(room.id)}`, {
            method: 'PATCH',
            body: {
              title: el('room-edit-title').value.trim(),
              description: el('room-edit-desc').value.trim()
            }
          });
          core().showToast('Room updated!', 'success');
        } catch (err) {
          core().showToast(err.message, 'error');
        }
      });
    }

    const addForm = el('room-add-member-form');
    if (addForm) {
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uname = (el('room-add-member-input').value || '').trim().replace(/^@+/, '').toLowerCase();
        if (!uname) return;
        try {
          await core().api(`/api/groups/${encodeURIComponent(room.id)}/members`, {
            method: 'POST',
            body: { username: uname }
          });
          el('room-add-member-input').value = '';
          core().showToast(`Added @${uname}`, 'success');
        } catch (err) {
          core().showToast(err.message, 'error');
        }
      });
    }
  }

  async function handleRoomInfoClick(e) {
    const container = el('info-room-controls');
    if (!container || !core()) return;
    const room = core().getState().activeRoom;
    if (!room) return;

    if (e.target.closest('[data-room-copy-invite]')) {
      const url = buildInviteUrl(room.inviteCode);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
        }
        core().showToast('Invite link copied!', 'success');
      } catch {
        core().showToast(`Invite code: ${room.inviteCode}`, 'success');
      }
      return;
    }

    if (e.target.closest('[data-room-regen-invite]')) {
      try {
        await core().api(`/api/groups/${encodeURIComponent(room.id)}`, {
          method: 'PATCH',
          body: { regenerateInvite: true }
        });
        core().showToast('Invite link reset!', 'success');
      } catch (err) {
        core().showToast(err.message, 'error');
      }
      return;
    }

    const toggleAdm = e.target.closest('[data-room-toggle-admin]');
    if (toggleAdm) {
      const username = toggleAdm.dataset.roomToggleAdmin;
      const isAdmin = toggleAdm.dataset.nextAdmin === '1';
      try {
        await core().api(`/api/groups/${encodeURIComponent(room.id)}/admins`, {
          method: 'POST',
          body: { username, isAdmin }
        });
        core().showToast(isAdmin ? `@${username} is now an admin` : `Removed admin from @${username}`, 'success');
      } catch (err) {
        core().showToast(err.message, 'error');
      }
      return;
    }

    const kickBtn = e.target.closest('[data-room-kick]');
    if (kickBtn) {
      const username = kickBtn.dataset.roomKick;
      try {
        await core().api(`/api/groups/${encodeURIComponent(room.id)}/members/${encodeURIComponent(username)}`, {
          method: 'DELETE'
        });
        core().showToast(`Removed @${username}`, 'success');
      } catch (err) {
        core().showToast(err.message, 'error');
      }
      return;
    }

    if (e.target.closest('[data-room-leave]')) {
      try {
        await core().api(`/api/groups/${encodeURIComponent(room.id)}/members/${encodeURIComponent(getMyUsername())}`, {
          method: 'DELETE'
        });
        core().toggleInfoDrawer(false);
        await core().refreshChats();
        core().showToast('Left room.', 'success');
      } catch (err) {
        core().showToast(err.message, 'error');
      }
      return;
    }

    const dmOpen = e.target.closest('[data-open-dm-user]');
    if (dmOpen) {
      const u = dmOpen.dataset.openDmUser;
      if (u && u !== getMyUsername()) {
        await core().openChatWithUser(u);
      }
    }
  }

  function updateMentionAutocomplete() {
    const inp = el('message-input');
    const pop = el('mention-popover');
    if (!inp || !pop || !core()) return;

    const state = core().getState();
    const pos = typeof inp.selectionStart === 'number' ? inp.selectionStart : inp.value.length;
    const before = inp.value.slice(0, pos);
    const match = /(^|\s)@([a-zA-Z0-9_]{0,24})$/.exec(before);
    if (!match) {
      pop.classList.add('hidden');
      fState.mentionMatches = [];
      return;
    }

    const q = match[2].toLowerCase();
    const candidates = [];
    const seen = new Set();
    const me = getMyUsername();

    if (state.activeRoom) {
      for (const m of getRoomMemberProfiles(state.activeRoom)) {
        if (m.username !== me && !seen.has(m.username)) {
          seen.add(m.username);
          candidates.push(m);
        }
      }
    } else if (state.activePeer && state.activePeer.username !== me) {
      seen.add(state.activePeer.username);
      candidates.push(state.activePeer);
    }

    const filtered = candidates.filter((u) => {
      if (!q) return true;
      return u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q);
    }).slice(0, 6);

    if (filtered.length === 0) {
      pop.classList.add('hidden');
      fState.mentionMatches = [];
      return;
    }

    fState.mentionMatches = filtered;
    fState.mentionActiveIdx = 0;
    fState.mentionRange = {
      start: before.length - match[2].length - 1,
      end: pos
    };

    pop.innerHTML = filtered.map((u, i) => `
      <button type="button" class="vr-mention-item ${i === 0 ? 'active' : ''}" data-pick-mention="${esc(u.username)}">
        <span class="vr-mention-name">${esc(u.displayName || u.username)}</span>
        <span class="vr-mention-handle">@${esc(u.username)}</span>
      </button>
    `).join('');
    pop.classList.remove('hidden');
  }

  function applyMentionChoice(username) {
    const inp = el('message-input');
    const pop = el('mention-popover');
    if (!inp || !pop || !fState.mentionRange) return;
    const { start, end } = fState.mentionRange;
    const nextVal = `${inp.value.slice(0, start)}@${username} ${inp.value.slice(end)}`;
    inp.value = nextVal;
    const caret = start + username.length + 2;
    if (typeof inp.setSelectionRange === 'function') {
      inp.setSelectionRange(caret, caret);
    }
    pop.classList.add('hidden');
    fState.mentionMatches = [];
    if (core() && core().getState().activeChatId) {
      core().saveChatDraft(core().getState().activeChatId, nextVal);
    }
    inp.focus();
  }

  async function handleInviteJoin(inviteCode) {
    if (!inviteCode || !core()) return;
    try {
      const data = await core().api('/api/groups/join', {
        method: 'POST',
        body: { inviteCode }
      });
      await core().refreshChats();
      if (data.chat && data.chat.id) {
        await core().openRoomById(data.chat.id);
      }
      core().showToast(`Joined ${data.chat ? data.chat.title : 'room'}!`, 'success');
    } catch (err) {
      core().showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // 2. Stranger Lounge (Anonymous Matchmaking)
  // =========================================================================
  async function openStrangerModal() {
    const modal = el('stranger-modal');
    if (!modal || !core()) return;
    modal.classList.remove('hidden');
    try {
      const data = await core().api('/api/stranger/status');
      if (data.status === 'matched' && data.session) {
        fState.strangerStatus = 'matched';
        fState.strangerSession = data.session;
        fState.strangerEndedReason = '';
      } else if (data.status === 'searching') {
        fState.strangerStatus = 'searching';
        fState.strangerInterests = data.interests || fState.strangerInterests;
        fState.strangerLanguage = data.language || fState.strangerLanguage;
      } else {
        fState.strangerStatus = 'idle';
        fState.strangerSession = null;
      }
    } catch {
      // Keep cached status
    }
    renderStrangerModal();
  }

  function closeStrangerModal() {
    const modal = el('stranger-modal');
    if (modal) modal.classList.add('hidden');
  }

  function renderStrangerModal() {
    const subEl = el('stranger-header-sub');
    const bodyEl = el('stranger-body');
    if (!bodyEl) return;

    if (fState.strangerStatus === 'searching') {
      if (subEl) subEl.textContent = 'Scanning the lounge for someone compatible...';
      bodyEl.innerHTML = `
        <div class="vr-stranger-searching">
          <div class="vr-radar-ring"><span>👻</span></div>
          <h3>Finding someone new...</h3>
          <p class="vr-hint">
            Interests: ${fState.strangerInterests.length ? fState.strangerInterests.map((t) => `#${esc(t)}`).join(', ') : 'Any'}
            • Language: ${esc(fState.strangerLanguage.toUpperCase())}
          </p>
          <button type="button" id="stranger-cancel-btn" class="secondary-btn">Cancel Search</button>
        </div>
      `;
      const cancelBtn = el('stranger-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          await core().api('/api/stranger/cancel', { method: 'POST' }).catch(() => { });
          fState.strangerStatus = 'idle';
          renderStrangerModal();
        });
      }
      return;
    }

    if ((fState.strangerStatus === 'matched' || fState.strangerStatus === 'ended') && fState.strangerSession) {
      const s = fState.strangerSession;
      const ended = fState.strangerStatus === 'ended';
      if (subEl) {
        subEl.textContent = ended
          ? 'Anonymous session ended'
          : `You are ${s.myAlias} • Talking with ${s.partnerAlias}`;
      }

      const revealBtnLabel = s.revealed
        ? 'Revealed!'
        : (s.revealByMe ? 'Waiting on Partner...' : 'Reveal Profile');

      bodyEl.innerHTML = `
        <div class="vr-stranger-chat">
          <div class="vr-stranger-topbar">
            <div class="vr-stranger-badges">
              <span class="vr-ghost-pill">👻 You: <strong>${esc(s.myAlias)}</strong></span>
              <span class="vr-ghost-pill partner">🎭 Partner: <strong>${esc(s.partnerAlias)}</strong></span>
              ${Array.isArray(s.sharedInterests) && s.sharedInterests.length > 0
                ? `<span class="vr-shared-pill">Shared: ${s.sharedInterests.map((i) => `#${esc(i)}`).join(', ')}</span>`
                : ''}
            </div>
            <div class="vr-stranger-actions">
              ${!ended ? `
                <button type="button" id="stranger-reveal-btn" class="secondary-btn sm ${s.revealByMe ? 'active' : ''}" ${s.revealByMe || s.revealed ? 'disabled' : ''}>
                  ${revealBtnLabel}
                </button>
                <button type="button" id="stranger-report-btn" class="secondary-btn sm danger">Report</button>
                <button type="button" id="stranger-skip-btn" class="primary-btn sm">Skip / Next</button>
              ` : `
                <button type="button" id="stranger-next-btn" class="primary-btn sm">Meet Next Stranger</button>
                <button type="button" id="stranger-back-btn" class="secondary-btn sm">Filters</button>
              `}
            </div>
          </div>

          ${fState.strangerRevealInfo ? `
            <div class="vr-reveal-banner">
              <div>
                <strong>Identity Revealed!</strong> You &amp; ${esc(s.partnerAlias)} matched as
                <strong>${esc(fState.strangerRevealInfo.friend.displayName || fState.strangerRevealInfo.friend.username)}</strong>
                (@${esc(fState.strangerRevealInfo.friend.username)}).
              </div>
              <button type="button" id="stranger-open-dm-btn" class="primary-btn sm">Open Friend Chat</button>
            </div>
          ` : (s.revealByPartner && !s.revealByMe && !ended ? `
            <div class="vr-reveal-prompt">
              <span>${esc(s.partnerAlias)} wants to reveal identities &amp; add you as a friend!</span>
              <button type="button" id="stranger-accept-reveal-btn" class="primary-btn sm">Accept &amp; Reveal</button>
            </div>
          ` : '')}

          <div id="stranger-msgs-box" class="vr-stranger-msgs">
            ${(s.messages || []).length === 0
              ? '<div class="vr-hint centered">Say hello! Real profiles stay hidden unless both of you tap Reveal.</div>'
              : (s.messages || []).map((m) => `
                  <div class="vr-s-msg ${m.isMine ? 'mine' : 'theirs'}">
                    <div class="vr-s-alias">${esc(m.isMine ? 'You' : m.senderAlias)}</div>
                    <div class="vr-s-bubble">${esc(m.text)}</div>
                  </div>
                `).join('')
            }
            ${ended ? `<div class="vr-s-system">${esc(fState.strangerEndedReason || 'Stranger disconnected.')}</div>` : ''}
          </div>

          ${fState.strangerTyping && !ended ? `<div class="vr-s-typing">${esc(s.partnerAlias)} is typing...</div>` : ''}

          ${!ended ? `
            <form id="stranger-send-form" class="vr-stranger-compose">
              <input id="stranger-msg-input" type="text" maxlength="1000" placeholder="Write anonymously as ${esc(s.myAlias)}..." autocomplete="off" />
              <button type="submit" class="primary-btn sm">Send</button>
            </form>
          ` : ''}
        </div>
      `;

      const box = el('stranger-msgs-box');
      if (box) box.scrollTop = box.scrollHeight;

      const sendForm = el('stranger-send-form');
      const msgInp = el('stranger-msg-input');
      if (msgInp) {
        let sTypTimer = null;
        msgInp.addEventListener('input', () => {
          core().api('/api/stranger/typing', { method: 'POST', body: { isTyping: Boolean(msgInp.value.trim()) } }).catch(() => { });
          clearTimeout(sTypTimer);
          sTypTimer = setTimeout(() => {
            core().api('/api/stranger/typing', { method: 'POST', body: { isTyping: false } }).catch(() => { });
          }, 2200);
        });
      }
      if (sendForm && msgInp) {
        sendForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const txt = msgInp.value.trim();
          if (!txt) return;
          msgInp.value = '';
          try {
            const res = await core().api('/api/stranger/message', {
              method: 'POST',
              body: { text: txt }
            });
            if (res.message && fState.strangerSession) {
              if (!fState.strangerSession.messages.some((m) => m.id === res.message.id)) {
                fState.strangerSession.messages.push(res.message);
                renderStrangerModal();
              }
            }
            const nextInp = el('stranger-msg-input');
            if (nextInp) nextInp.focus();
          } catch (err) {
            core().showToast(err.message, 'error');
          }
        });
      }

      const skipBtn = el('stranger-skip-btn');
      if (skipBtn) {
        skipBtn.addEventListener('click', () => startNextStranger(true));
      }
      const nextBtn = el('stranger-next-btn');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => startNextStranger(true));
      }
      const backBtn = el('stranger-back-btn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          fState.strangerStatus = 'idle';
          fState.strangerSession = null;
          fState.strangerRevealInfo = null;
          renderStrangerModal();
        });
      }
      const revealBtn = el('stranger-reveal-btn');
      const acceptRevealBtn = el('stranger-accept-reveal-btn');
      const triggerReveal = async () => {
        try {
          const r = await core().api('/api/stranger/reveal', { method: 'POST' });
          if (fState.strangerSession) fState.strangerSession.revealByMe = true;
          if (r.revealed && r.friend) {
            fState.strangerSession.revealed = true;
            fState.strangerRevealInfo = { friend: r.friend, dmChatId: r.dmChatId };
            await core().refreshChats();
          } else {
            core().showToast('Reveal requested — waiting for partner!', 'success');
          }
          renderStrangerModal();
        } catch (err) {
          core().showToast(err.message, 'error');
        }
      };
      if (revealBtn) revealBtn.addEventListener('click', triggerReveal);
      if (acceptRevealBtn) acceptRevealBtn.addEventListener('click', triggerReveal);

      const openDmBtn = el('stranger-open-dm-btn');
      if (openDmBtn && fState.strangerRevealInfo) {
        openDmBtn.addEventListener('click', async () => {
          const uname = fState.strangerRevealInfo.friend.username;
          closeStrangerModal();
          await core().openChatWithUser(uname);
        });
      }

      const reportBtn = el('stranger-report-btn');
      if (reportBtn) {
        reportBtn.addEventListener('click', async () => {
          try {
            await core().api('/api/stranger/report', {
              method: 'POST',
              body: { reason: 'inappropriate' }
            });
            fState.strangerStatus = 'idle';
            fState.strangerSession = null;
            core().showToast('Stranger reported and disconnected.', 'success');
            renderStrangerModal();
          } catch (err) {
            core().showToast(err.message, 'error');
          }
        });
      }
      return;
    }

    // Idle Lounge Setup View
    if (subEl) subEl.textContent = 'Chat anonymously as a random Ghost — skip anytime or mutually reveal to become friends.';
    bodyEl.innerHTML = `
      <div class="vr-stack">
        <div class="vr-lounge-hero">
          <div class="vr-lounge-icon">👻</div>
          <div>
            <strong>Your Real Profile Is Hidden</strong>
            <p class="vr-hint">You get a random Ghost alias each match. Neither person sees usernames unless both press Reveal.</p>
          </div>
        </div>

        <div class="field-group">
          <label>Interests / Vibe Tags (up to 6)</label>
          <div class="vr-chips-wrap">
            ${STRANGER_TAG_PRESETS.map((tag) => `
              <button type="button" class="vr-chip-btn ${fState.strangerInterests.includes(tag) ? 'selected' : ''}" data-stranger-tag="${esc(tag)}">#${esc(tag)}</button>
            `).join('')}
          </div>
          <div class="vr-inline-row" style="margin-top:8px;">
            <input id="stranger-custom-tag" type="text" maxlength="20" placeholder="Add custom topic..." />
            <button type="button" id="stranger-add-tag-btn" class="secondary-btn sm">Add Tag</button>
          </div>
        </div>

        <div class="field-group">
          <label for="stranger-lang-select">Language Filter</label>
          <select id="stranger-lang-select" class="vr-select">
            <option value="any" ${fState.strangerLanguage === 'any' ? 'selected' : ''}>Any Language</option>
            <option value="en" ${fState.strangerLanguage === 'en' ? 'selected' : ''}>English</option>
            <option value="bn" ${fState.strangerLanguage === 'bn' ? 'selected' : ''}>Bengali</option>
            <option value="hi" ${fState.strangerLanguage === 'hi' ? 'selected' : ''}>Hindi</option>
            <option value="es" ${fState.strangerLanguage === 'es' ? 'selected' : ''}>Spanish</option>
            <option value="fr" ${fState.strangerLanguage === 'fr' ? 'selected' : ''}>French</option>
            <option value="ar" ${fState.strangerLanguage === 'ar' ? 'selected' : ''}>Arabic</option>
          </select>
        </div>

        <button type="button" id="stranger-meet-btn" class="primary-btn full-width lg">✨ Meet Someone New</button>
      </div>
    `;

    const langSel = el('stranger-lang-select');
    if (langSel) {
      langSel.addEventListener('change', () => {
        fState.strangerLanguage = langSel.value;
      });
    }

    const addTagBtn = el('stranger-add-tag-btn');
    const customInp = el('stranger-custom-tag');
    if (addTagBtn && customInp) {
      const addCustom = () => {
        const clean = customInp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!clean) return;
        if (!fState.strangerInterests.includes(clean) && fState.strangerInterests.length < 6) {
          fState.strangerInterests.push(clean);
        }
        renderStrangerModal();
      };
      addTagBtn.addEventListener('click', addCustom);
      customInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addCustom();
        }
      });
    }

    const meetBtn = el('stranger-meet-btn');
    if (meetBtn) {
      meetBtn.addEventListener('click', async () => {
        try {
          fState.strangerRevealInfo = null;
          fState.strangerEndedReason = '';
          const data = await core().api('/api/stranger/meet', {
            method: 'POST',
            body: {
              interests: fState.strangerInterests,
              language: fState.strangerLanguage
            }
          });
          if (data.status === 'matched' && data.session) {
            fState.strangerStatus = 'matched';
            fState.strangerSession = data.session;
          } else {
            fState.strangerStatus = 'searching';
            fState.strangerSession = null;
          }
          renderStrangerModal();
        } catch (err) {
          core().showToast(err.message, 'error');
        }
      });
    }
  }

  async function startNextStranger(autoRequeue) {
    try {
      fState.strangerRevealInfo = null;
      fState.strangerEndedReason = '';
      const data = await core().api('/api/stranger/next', {
        method: 'POST',
        body: {
          autoRequeue,
          interests: fState.strangerInterests,
          language: fState.strangerLanguage
        }
      });
      if (data.status === 'matched' && data.session) {
        fState.strangerStatus = 'matched';
        fState.strangerSession = data.session;
      } else if (data.status === 'searching') {
        fState.strangerStatus = 'searching';
        fState.strangerSession = null;
      } else {
        fState.strangerStatus = 'idle';
        fState.strangerSession = null;
      }
      renderStrangerModal();
    } catch (err) {
      core().showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // 3. Playable Chat Mini-Games
  // =========================================================================
  function renderGameBubbleHtml(msg) {
    const g = msg && msg.game;
    if (!g) return '';
    const me = getMyUsername();
    const creator = g.creator || (Array.isArray(g.players) ? g.players[0] : '');
    const canCancel = g.status === 'active' && creator === me;
    const myTurn = g.status === 'active' && g.turn === me;
    let statusText = myTurn ? 'Your Turn!' : `Turn: @${g.turn}`;
    let pillCls = myTurn ? 'yours' : '';
    if (g.status === 'finished') {
      statusText = g.draw ? 'Draw!' : `Winner: @${g.winner}`;
      pillCls = 'done';
    } else if (g.status === 'cancelled') {
      statusText = 'Cancelled';
      pillCls = 'cancelled';
    }
    const emojiMap = { tictactoe: '⭕', connect4: '🔴', chess: '♟️', wordguess: '🔤' };
    const icon = emojiMap[g.type] || '🎮';

    return `
      <div class="game-card-msg ${myTurn ? 'my-turn' : ''} ${g.status === 'cancelled' ? 'is-cancelled' : ''}" data-open-game="${esc(g.id)}">
        <div class="game-card-head">
          <span class="game-card-icon">${icon}</span>
          <div class="game-card-titles">
            <div class="game-card-title">${esc(g.title || g.type)}</div>
            <div class="game-card-players">${(g.players || []).map((p) => `@${esc(p)}`).join(' vs ')}</div>
          </div>
          <span class="game-status-pill ${pillCls}">${esc(statusText)}</span>
        </div>
        <div class="game-card-footer">
          <span class="game-card-cta">${g.status === 'active' ? 'Tap to play →' : (g.status === 'cancelled' ? 'Invite cancelled' : 'View board →')}</span>
          ${canCancel ? `<button type="button" class="game-cancel-btn" data-cancel-game="${esc(g.id)}">Cancel</button>` : ''}
          ${g.status === 'finished' ? `<button type="button" class="game-rematch-btn" data-rematch-game="${esc(g.id)}">🔄 Rematch</button>` : ''}
        </div>
      </div>
    `;
  }

  function renderCallBubbleHtml(msg) {
    const c = msg && msg.call;
    if (!c) return '';
    const me = getMyUsername();
    const isOutgoing = c.caller === me;
    const isVideo = c.mode === 'video';
    const isMissedOrDeclined = c.status === 'missed' || c.status === 'declined' || c.status === 'cancelled';

    let headline = `${isOutgoing ? 'Outgoing' : 'Incoming'} ${isVideo ? 'Video' : 'Audio'} Call`;
    let sub = '';
    if (c.status === 'completed') {
      const m = Math.floor((c.durationSec || 0) / 60);
      const s = String((c.durationSec || 0) % 60).padStart(2, '0');
      sub = `Duration ${m}:${s}`;
    } else if (c.status === 'missed') {
      headline = isOutgoing ? `Cancelled / No Answer` : `Missed ${isVideo ? 'Video' : 'Audio'} Call`;
      sub = isOutgoing ? 'Unanswered' : 'Tap to call back';
    } else if (c.status === 'declined') {
      sub = 'Declined';
    } else {
      sub = 'Cancelled';
    }

    return `
      <div class="call-log-msg ${isMissedOrDeclined && !isOutgoing ? 'missed' : ''}">
        <span class="call-log-icon">${isVideo ? '📹' : '📞'}</span>
        <div class="call-log-meta">
          <div class="call-log-title">${esc(headline)}</div>
          <div class="call-log-sub">${esc(sub)}</div>
        </div>
        <button type="button" class="call-log-back-btn" data-call-back="${esc(c.mode || 'audio')}" title="Call back" aria-label="Call back">
          ${isVideo ? '📹' : '📞'}
        </button>
      </div>
    `;
  }

  async function cancelGameById(gameId, chatId) {
    if (!core() || !gameId) return;
    const targetChatId = chatId || fState.activeGameChatId || core().getState().activeChatId;
    if (!targetChatId) return;
    try {
      const res = await core().api(`/api/chats/${encodeURIComponent(targetChatId)}/games/${encodeURIComponent(gameId)}/cancel`, {
        method: 'POST'
      });
      if (res.message) {
        const msgs = core().getState().messages;
        const idx = msgs.findIndex((m) => m.id === res.message.id);
        if (idx >= 0) {
          msgs[idx] = res.message;
          core().renderMessages(false);
        }
      }
      if (fState.activeGameId === gameId) {
        fState.activeGameId = null;
        renderGamesModal();
      }
      core().showToast('Game invite cancelled.', 'success');
    } catch (err) {
      core().showToast(err.message, 'error');
    }
  }

  function findGameById(gameId) {
    if (!core()) return null;
    const msgs = core().getState().messages || [];
    const hit = msgs.find((m) => m.kind === 'game' && m.game && m.game.id === gameId);
    return hit ? hit.game : null;
  }

  function openGamesHub(gameId = null) {
    const modal = el('games-modal');
    if (!modal || !core()) return;
    const state = core().getState();
    fState.activeGameId = gameId;
    fState.activeGameChatId = state.activeChatId;
    fState.chessSelectedSq = null;
    renderGamesModal();
    modal.classList.remove('hidden');
  }

  function openGameById(gameId) {
    openGamesHub(gameId);
  }

  function closeGamesModal() {
    const modal = el('games-modal');
    if (modal) modal.classList.add('hidden');
    fState.activeGameId = null;
    fState.chessSelectedSq = null;
  }

  async function rematchGame(gameId) {
    if (!core() || !gameId) return;
    const game = findGameById(gameId);
    const chatId = fState.activeGameChatId || core().getState().activeChatId;
    if (!game || !chatId) return;
    const me = getMyUsername();
    const opponentUsername = Array.isArray(game.players) ? game.players.find((p) => p !== me) : undefined;
    try {
      const res = await core().api(`/api/chats/${encodeURIComponent(chatId)}/games`, {
        method: 'POST',
        body: { gameType: game.type, opponentUsername }
      });
      if (res.message && !core().getState().messages.some((m) => m.id === res.message.id)) {
        core().getState().messages.push(res.message);
        core().renderMessages(true);
      }
      fState.activeGameChatId = chatId;
      fState.gamesTab = 'play';
      fState.activeGameId = res.message && res.message.game ? res.message.game.id : null;
      const modal = el('games-modal');
      if (modal) {
        renderGamesModal();
        modal.classList.remove('hidden');
      }
      await core().refreshChats();
      core().showToast(`Rematch started: ${game.title}!`, 'success');
    } catch (err) {
      core().showToast(err.message || 'Could not start rematch.', 'error');
    }
  }

  async function renderLeaderboardTab(bodyEl) {
    const state = core().getState();
    const activePeerUsername = state.activePeer ? state.activePeer.username : '';
    bodyEl.innerHTML = `
      <div class="vr-stack">
        <div class="vr-seg-tabs" role="tablist">
          <button type="button" class="vr-seg-tab" data-games-tab="play">🎮 Play Games</button>
          <button type="button" class="vr-seg-tab active" data-games-tab="leaderboard">🏆 Leaderboard &amp; Streaks</button>
        </div>
        <div class="vr-hint centered">Loading scoreboard &amp; win streaks...</div>
      </div>
    `;
    try {
      const data = await core().api('/api/games/leaderboard');
      const s = data.myStats || {};
      const rows = Array.isArray(data.leaderboard) ? data.leaderboard : [];
      const h2h = activePeerUsername && s.vs ? s.vs[activePeerUsername] : null;
      const byGame = s.byGame || {};
      const gameBadges = [
        { k: 'tictactoe', label: '⭕ TTT' },
        { k: 'connect4', label: '🔴 Connect 4' },
        { k: 'chess', label: '♟️ Chess' },
        { k: 'wordguess', label: '🔤 Word Duel' }
      ].map((g) => {
        const gs = byGame[g.k] || { wins: 0, losses: 0, draws: 0 };
        return `<span class="vr-stat-chip">${g.label}: <strong>${gs.wins}W</strong>-${gs.losses}L-${gs.draws}D</span>`;
      }).join('');

      bodyEl.innerHTML = `
        <div class="vr-stack">
          <div class="vr-seg-tabs" role="tablist">
            <button type="button" class="vr-seg-tab" data-games-tab="play">🎮 Play Games</button>
            <button type="button" class="vr-seg-tab active" data-games-tab="leaderboard">🏆 Leaderboard &amp; Streaks</button>
          </div>

          <div class="vr-stats-hero">
            <div class="vr-stat-box">
              <div class="vr-stat-num">${Number(s.wins || 0)}-${Number(s.losses || 0)}-${Number(s.draws || 0)}</div>
              <div class="vr-stat-lbl">W - L - D</div>
            </div>
            <div class="vr-stat-box">
              <div class="vr-stat-num">🔥 ${Number(s.currentStreak || 0)}</div>
              <div class="vr-stat-lbl">Win Streak</div>
            </div>
            <div class="vr-stat-box">
              <div class="vr-stat-num">🏅 ${Number(s.bestStreak || 0)}</div>
              <div class="vr-stat-lbl">Best Streak</div>
            </div>
          </div>

          <div class="vr-stat-chips-row">${gameBadges}</div>

          ${h2h ? `
            <div class="vr-h2h-card">
              <span>⚔️ Rivalry vs <strong>@${esc(activePeerUsername)}</strong></span>
              <span><strong>${h2h.wins || 0}W</strong> • ${h2h.losses || 0}L • ${h2h.draws || 0}D ${h2h.currentStreak > 0 ? `• 🔥${h2h.currentStreak}` : ''}</span>
            </div>
          ` : ''}

          <div class="vr-room-section">
            <div class="info-label">Friends Leaderboard (Win = 3 pts, Draw = 1 pt)</div>
            ${rows.length === 0
              ? '<div class="vr-hint centered">Play a game with friends to appear on the leaderboard!</div>'
              : `<div class="vr-leaderboard-list">${rows.map((r, idx) => {
                  const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`));
                  return `
                    <div class="vr-lb-row ${r.isMe ? 'me' : ''}">
                      <span class="vr-lb-rank">${medal}</span>
                      <div class="vr-lb-info">
                        <strong>${esc(r.displayName || r.username)} ${r.isMe ? '(You)' : ''}</strong>
                        <span>${r.wins}W • ${r.losses}L • ${r.draws}D ${r.currentStreak > 1 ? `• 🔥 ${r.currentStreak} streak` : ''}</span>
                      </div>
                      <span class="vr-lb-pts">${r.score} pts</span>
                    </div>
                  `;
                }).join('')}</div>`}
          </div>
        </div>
      `;
    } catch (err) {
      bodyEl.innerHTML = `<div class="vr-hint centered">${esc(err.message || 'Could not load leaderboard.')}</div>`;
    }
  }

  function renderGamesModal() {
    const titleEl = el('games-modal-title');
    const bodyEl = el('games-modal-body');
    if (!bodyEl || !core()) return;
    const state = core().getState();

    if (fState.activeGameId) {
      const game = findGameById(fState.activeGameId);
      if (game) {
        renderActiveGameBoard(titleEl, bodyEl, game);
        return;
      }
      fState.activeGameId = null;
    }

    if (titleEl) titleEl.textContent = 'Chat Mini-Games';
    if (fState.gamesTab === 'leaderboard') {
      renderLeaderboardTab(bodyEl);
      return;
    }

    const tabsHtml = `
      <div class="vr-seg-tabs" role="tablist">
        <button type="button" class="vr-seg-tab active" data-games-tab="play">🎮 Play Games</button>
        <button type="button" class="vr-seg-tab" data-games-tab="leaderboard">🏆 Leaderboard &amp; Streaks</button>
      </div>
    `;

    const activeChatId = state.activeChatId;
    const existingGames = (state.messages || []).filter((m) => m.kind === 'game' && m.game).map((m) => m.game).reverse();

    const friendsList = Array.isArray(state.friends) ? state.friends : [];
    const friendSet = new Set(friendsList.map((f) => f.username));

    if (!activeChatId) {
      bodyEl.innerHTML = `
        <div class="vr-stack">
          ${tabsHtml}
          <p class="vr-hint">Pick a friend to challenge them to Tic-Tac-Toe, Connect 4, Chess, or Word Duel:</p>
          ${friendsList.length === 0
            ? '<div class="vr-hint centered">No friends added yet — search someone by exact @username or email in the sidebar and add them first!</div>'
            : `<div class="vr-member-list">${friendsList.slice(0, 12).map((f) => `
                <button type="button" class="vr-pick-chat-btn" data-game-open-chat="${esc(f.username)}">
                  <span>💬 ${esc(f.displayName || f.username)}</span>
                  <span class="vr-hint">@${esc(f.username)}</span>
                </button>
              `).join('')}</div>`
          }
        </div>
      `;
      return;
    }

    const isRoom = Boolean(state.activeRoom);
    const otherMembers = isRoom
      ? getRoomMemberProfiles(state.activeRoom).map((m) => m.username).filter((u) => u && u !== getMyUsername() && friendSet.has(u))
      : [];
    const dmNotFriend = !isRoom && state.activePeer && !friendSet.has(state.activePeer.username);

    if (dmNotFriend) {
      const peerRel = core().getRelationshipForUser ? core().getRelationshipForUser(state.activePeer.username) : 'none';
      bodyEl.innerHTML = `
        <div class="vr-stack">
          <div class="vr-lounge-hero">
            <div class="vr-lounge-icon">🎮</div>
            <div>
              <strong>Friends Only</strong>
              <p class="vr-hint">You can only play mini-games with friends. Add <strong>@${esc(state.activePeer.username)}</strong> as a friend first!</p>
            </div>
          </div>
          ${peerRel === 'outgoing_pending'
            ? '<div class="vr-hint centered">Friend request already sent — waiting for acceptance.</div>'
            : (peerRel === 'incoming_pending'
              ? `<button type="button" class="primary-btn full-width" data-game-accept-friend="${esc(state.activePeer.username)}">Accept @${esc(state.activePeer.username)}'s Friend Request</button>`
              : `<button type="button" class="primary-btn full-width" data-game-add-friend="${esc(state.activePeer.username)}">+ Add @${esc(state.activePeer.username)} as Friend</button>`)
          }
        </div>
      `;
      return;
    }

    if (isRoom && otherMembers.length === 0) {
      bodyEl.innerHTML = `
        <div class="vr-stack">
          <div class="vr-lounge-hero">
            <div class="vr-lounge-icon">🎮</div>
            <div>
              <strong>No Friend Opponents in Room</strong>
              <p class="vr-hint">You can only challenge friends to mini-games. Add a friend to this group or open a DM with a friend to play.</p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    bodyEl.innerHTML = `
      <div class="vr-stack">
        ${tabsHtml}
        ${isRoom && otherMembers.length > 0 ? `
          <div class="field-group">
            <label for="game-opponent-select">Challenge Friend</label>
            <select id="game-opponent-select" class="vr-select">
              ${otherMembers.map((u) => `<option value="${esc(u)}">@${esc(u)}</option>`).join('')}
            </select>
          </div>
        ` : ''}

        <div class="vr-game-grid">
          <button type="button" class="vr-game-tile" data-start-game="tictactoe">
            <span class="tile-ico">⭕</span>
            <strong>Tic-Tac-Toe</strong>
            <span>Classic 3x3 duel</span>
          </button>
          <button type="button" class="vr-game-tile" data-start-game="connect4">
            <span class="tile-ico">🔴</span>
            <strong>Connect 4</strong>
            <span>4-in-a-row drop grid</span>
          </button>
          <button type="button" class="vr-game-tile" data-start-game="chess">
            <span class="tile-ico">♟️</span>
            <strong>Chess</strong>
            <span>Full legal board</span>
          </button>
          <button type="button" class="vr-game-tile" data-start-game="wordguess">
            <span class="tile-ico">🔤</span>
            <strong>Word Duel</strong>
            <span>Guess the 5-letter word</span>
          </button>
        </div>

        ${existingGames.length > 0 ? `
          <div class="vr-room-section">
            <div class="info-label">Games in This Chat</div>
            <div class="vr-stack">
              ${existingGames.slice(0, 6).map((g) => {
                const creator = g.creator || (Array.isArray(g.players) ? g.players[0] : '');
                const canCancel = g.status === 'active' && creator === getMyUsername();
                const pillLabel = g.status === 'cancelled'
                  ? 'Cancelled'
                  : (g.status === 'finished'
                    ? (g.draw ? 'Draw' : `@${esc(g.winner)} won`)
                    : (g.turn === getMyUsername() ? 'Your Turn' : `@${esc(g.turn)}`));
                const pillCls = g.status === 'cancelled'
                  ? 'cancelled'
                  : (g.status === 'finished' ? 'done' : (g.turn === getMyUsername() ? 'yours' : ''));
                return `
                  <div class="vr-inline-row">
                    <button type="button" class="vr-pick-chat-btn" data-select-game="${esc(g.id)}">
                      <span>${esc(g.title)} (${(g.players || []).map((p) => `@${p}`).join(' vs ')})</span>
                      <span class="game-status-pill ${pillCls}">${pillLabel}</span>
                    </button>
                    ${canCancel ? `<button type="button" class="game-cancel-btn" data-cancel-game="${esc(g.id)}">Cancel</button>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  async function submitGameMove(gameId, movePayload) {
    if (!core() || !fState.activeGameChatId) return;
    try {
      await core().api(`/api/chats/${encodeURIComponent(fState.activeGameChatId)}/games/${encodeURIComponent(gameId)}/move`, {
        method: 'POST',
        body: { move: movePayload }
      });
    } catch (err) {
      core().showToast(err.message, 'error');
    }
  }

  function renderActiveGameBoard(titleEl, bodyEl, game) {
    const me = getMyUsername();
    const myTurn = game.status === 'active' && game.turn === me;
    const creator = game.creator || (Array.isArray(game.players) ? game.players[0] : '');
    const canCancel = game.status === 'active' && creator === me;
    if (titleEl) titleEl.textContent = game.title || 'Mini-Game';

    let statusBanner = `<div class="vr-game-banner ${myTurn ? 'yours' : ''}">${myTurn ? '🟢 Your Turn' : `⏳ Waiting for @${esc(game.turn)}`}</div>`;
    if (game.status === 'cancelled') {
      statusBanner = `<div class="vr-game-banner cancelled">🚫 Cancelled by @${esc(game.cancelledBy || creator)}</div>`;
    } else if (game.status === 'finished') {
      statusBanner = game.draw
        ? `<div class="vr-game-banner done">🤝 Draw! ${game.state && game.state.revealedWord ? `Word: <strong>${esc(game.state.revealedWord)}</strong>` : ''}</div>`
        : `<div class="vr-game-banner won">🏆 @${esc(game.winner)} wins! ${game.state && game.state.revealedWord ? `Word: <strong>${esc(game.state.revealedWord)}</strong>` : ''}</div>`;
    }

    let boardHtml = '';

    if (game.type === 'tictactoe') {
      const winSet = new Set(game.state.winLine || []);
      const marks = game.state.marks || {};
      boardHtml = `
        <div class="vr-game-meta">
          ${game.players.map((p) => `<span class="vr-player-pill">${esc(p)}: <strong>${esc(marks[p] || '')}</strong></span>`).join('')}
        </div>
        <div class="vr-ttt-grid">
          ${(game.state.board || []).map((cell, idx) => `
            <button type="button" class="vr-ttt-cell ${winSet.has(idx) ? 'win' : ''} ${cell === 'X' ? 'x' : (cell === 'O' ? 'o' : '')}"
              data-ttt-idx="${idx}" ${!myTurn || cell ? 'disabled' : ''}>
              ${esc(cell || '')}
            </button>
          `).join('')}
        </div>
      `;
    } else if (game.type === 'connect4') {
      const winSet = new Set(game.state.winLine || []);
      const marks = game.state.marks || {};
      const grid = game.state.grid || [];
      boardHtml = `
        <div class="vr-game-meta">
          ${game.players.map((p) => `<span class="vr-player-pill">@${esc(p)}: ${marks[p] === 'R' ? '🔴' : '🟡'}</span>`).join('')}
        </div>
        <div class="vr-c4-col-btns">
          ${[0, 1, 2, 3, 4, 5, 6].map((col) => `
            <button type="button" class="vr-c4-drop-btn" data-c4-col="${col}" ${!myTurn || grid[col] ? 'disabled' : ''}>⬇</button>
          `).join('')}
        </div>
        <div class="vr-c4-board">
          ${grid.map((cell, idx) => `
            <button type="button" class="vr-c4-slot ${winSet.has(idx) ? 'win' : ''} ${cell === 'R' ? 'red' : (cell === 'Y' ? 'yellow' : '')}"
              data-c4-col="${idx % 7}" ${!myTurn ? 'disabled' : ''}></button>
          `).join('')}
        </div>
      `;
    } else if (game.type === 'chess') {
      const mySide = (game.state.sides && game.state.sides[me]) || 'w';
      const flipped = mySide === 'b';
      const board = game.state.board || [];
      const lastSet = new Set(game.state.lastMove || []);
      const squares = [];
      for (let rIdx = 0; rIdx < 8; rIdx++) {
        for (let cIdx = 0; cIdx < 8; cIdx++) {
          const r = flipped ? 7 - rIdx : rIdx;
          const c = flipped ? 7 - cIdx : cIdx;
          const idx = r * 8 + c;
          const isDark = (r + c) % 2 === 1;
          const piece = board[idx] || '';
          const selected = fState.chessSelectedSq === idx;
          squares.push(`
            <button type="button"
              class="vr-chess-sq ${isDark ? 'dark' : 'light'} ${selected ? 'selected' : ''} ${lastSet.has(idx) ? 'last-move' : ''} ${piece && piece === piece.toUpperCase() ? 'white-piece' : 'black-piece'}"
              data-chess-sq="${idx}">
              ${piece ? esc(CHESS_UNICODE[piece] || piece) : ''}
            </button>
          `);
        }
      }
      boardHtml = `
        <div class="vr-game-meta">
          <span>White: @${esc(game.players[0])}</span>
          <span>Black: @${esc(game.players[1])}</span>
          ${game.state.inCheck ? '<span class="vr-check-pill">CHECK!</span>' : ''}
        </div>
        <div class="vr-chess-board">${squares.join('')}</div>
        <p class="vr-hint centered">${myTurn ? 'Tap one of your pieces, then tap destination square.' : 'Waiting for opponent move...'}</p>
      `;
    } else if (game.type === 'wordguess') {
      const guesses = game.state.guesses || [];
      const maxG = game.state.maxGuesses || 6;
      const rows = [];
      for (let r = 0; r < maxG; r++) {
        const g = guesses[r];
        const tiles = [];
        for (let c = 0; c < 5; c++) {
          const ch = g ? (g.word[c] || '') : '';
          const stateCls = g ? (g.pattern[c] || 'absent') : '';
          tiles.push(`<div class="vr-word-tile ${stateCls}">${esc(ch)}</div>`);
        }
        rows.push(`
          <div class="vr-word-row">
            <div class="vr-word-tiles">${tiles.join('')}</div>
            <span class="vr-word-who">${g ? `@${esc(g.player)}` : ''}</span>
          </div>
        `);
      }
      boardHtml = `
        <div class="vr-word-grid">${rows.join('')}</div>
        ${myTurn ? `
          <form id="wordguess-form" class="vr-inline-row" style="margin-top:12px;">
            <input id="wordguess-input" type="text" maxlength="5" minlength="5" placeholder="5-letter word" autocomplete="off" style="text-transform:uppercase;" required />
            <button type="submit" class="primary-btn">Guess</button>
          </form>
        ` : ''}
      `;
    }

    bodyEl.innerHTML = `
      <div class="vr-stack">
        <div class="vr-inline-row space-between">
          <button type="button" class="secondary-btn sm" data-games-back>← All Games</button>
          <div class="vr-inline-row">
            <span class="vr-hint">${esc(game.movesCount || 0)} moves</span>
            ${canCancel ? `<button type="button" class="game-cancel-btn" data-cancel-game="${esc(game.id)}">Cancel Game</button>` : ''}
            ${game.status === 'finished' ? `<button type="button" class="primary-btn sm" data-rematch-game="${esc(game.id)}">🔄 Rematch</button>` : ''}
          </div>
        </div>
        ${statusBanner}
        ${boardHtml}
      </div>
    `;

    const wgForm = el('wordguess-form');
    if (wgForm) {
      wgForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inp = el('wordguess-input');
        const word = (inp.value || '').trim().toUpperCase();
        if (!/^[A-Z]{5}$/.test(word)) {
          core().showToast('Enter a valid 5-letter English word.', 'error');
          return;
        }
        await submitGameMove(game.id, { word });
      });
    }
  }

  async function handleGamesBodyClick(e) {
    if (!core()) return;
    const tabBtn = e.target.closest('[data-games-tab]');
    if (tabBtn) {
      fState.gamesTab = tabBtn.dataset.gamesTab === 'leaderboard' ? 'leaderboard' : 'play';
      renderGamesModal();
      return;
    }
    const rematchBtn = e.target.closest('[data-rematch-game]');
    if (rematchBtn) {
      await rematchGame(rematchBtn.dataset.rematchGame);
      return;
    }
    const addFriendBtn = e.target.closest('[data-game-add-friend]');
    if (addFriendBtn && typeof core().performFriendAction === 'function') {
      await core().performFriendAction('request', addFriendBtn.dataset.gameAddFriend);
      renderGamesModal();
      return;
    }
    const acceptFriendBtn = e.target.closest('[data-game-accept-friend]');
    if (acceptFriendBtn && typeof core().performFriendAction === 'function') {
      await core().performFriendAction('accept', acceptFriendBtn.dataset.gameAcceptFriend);
      renderGamesModal();
      return;
    }
    const cancelBtn = e.target.closest('[data-cancel-game]');
    if (cancelBtn) {
      await cancelGameById(cancelBtn.dataset.cancelGame, fState.activeGameChatId);
      renderGamesModal();
      return;
    }
    if (e.target.closest('[data-games-back]')) {
      fState.activeGameId = null;
      fState.chessSelectedSq = null;
      renderGamesModal();
      return;
    }

    const openChatBtn = e.target.closest('[data-game-open-chat]');
    if (openChatBtn) {
      const uname = openChatBtn.dataset.gameOpenChat;
      await core().openChatWithUser(uname);
      fState.activeGameChatId = core().getState().activeChatId;
      renderGamesModal();
      return;
    }

    const selectGameBtn = e.target.closest('[data-select-game]');
    if (selectGameBtn) {
      fState.activeGameId = selectGameBtn.dataset.selectGame;
      renderGamesModal();
      return;
    }

    const startBtn = e.target.closest('[data-start-game]');
    if (startBtn) {
      const gameType = startBtn.dataset.startGame;
      const chatId = core().getState().activeChatId;
      if (!chatId) return;
      const oppSel = el('game-opponent-select');
      const opponentUsername = oppSel ? oppSel.value : undefined;
      try {
        const res = await core().api(`/api/chats/${encodeURIComponent(chatId)}/games`, {
          method: 'POST',
          body: { gameType, opponentUsername }
        });
        if (res.message && !core().getState().messages.some((m) => m.id === res.message.id)) {
          core().getState().messages.push(res.message);
          core().renderMessages(true);
        }
        fState.activeGameChatId = chatId;
        fState.activeGameId = res.message && res.message.game ? res.message.game.id : null;
        renderGamesModal();
        await core().refreshChats();
      } catch (err) {
        core().showToast(err.message, 'error');
      }
      return;
    }

    const tttBtn = e.target.closest('[data-ttt-idx]');
    if (tttBtn && fState.activeGameId) {
      await submitGameMove(fState.activeGameId, { index: Number(tttBtn.dataset.tttIdx) });
      return;
    }

    const c4Btn = e.target.closest('[data-c4-col]');
    if (c4Btn && fState.activeGameId) {
      await submitGameMove(fState.activeGameId, { col: Number(c4Btn.dataset.c4Col) });
      return;
    }

    const chessBtn = e.target.closest('[data-chess-sq]');
    if (chessBtn && fState.activeGameId) {
      const sq = Number(chessBtn.dataset.chessSq);
      const game = findGameById(fState.activeGameId);
      if (!game || game.status !== 'active' || game.turn !== getMyUsername()) return;
      const mySide = (game.state.sides && game.state.sides[getMyUsername()]) || 'w';
      const piece = (game.state.board || [])[sq] || '';
      const isMinePiece = piece && (mySide === 'w' ? piece === piece.toUpperCase() : piece === piece.toLowerCase());

      if (fState.chessSelectedSq === null) {
        if (isMinePiece) {
          fState.chessSelectedSq = sq;
          renderGamesModal();
        }
      } else if (fState.chessSelectedSq === sq) {
        fState.chessSelectedSq = null;
        renderGamesModal();
      } else if (isMinePiece) {
        fState.chessSelectedSq = sq;
        renderGamesModal();
      } else {
        const from = fState.chessSelectedSq;
        fState.chessSelectedSq = null;
        await submitGameMove(fState.activeGameId, { from, to: sq });
      }
    }
  }

  // =========================================================================
  // 4. Audio & Video Calling (WebRTC) + Floating Mini-Player
  // =========================================================================
  function stopRingtone() {
    if (fState.ringOscTimer) {
      clearInterval(fState.ringOscTimer);
      fState.ringOscTimer = null;
    }
    if (fState.ringAudioCtx) {
      try { fState.ringAudioCtx.close(); } catch { }
      fState.ringAudioCtx = null;
    }
  }

  function startRingtone() {
    stopRingtone();
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      fState.ringAudioCtx = ctx;
      const beep = () => {
        if (!fState.ringAudioCtx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.16);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.44);
      };
      beep();
      fState.ringOscTimer = setInterval(beep, 1800);
    } catch {
      // Audio playback blocked before interaction
    }
  }

  function formatCallDuration(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function startCallTimer() {
    if (fState.callTimerId) clearInterval(fState.callTimerId);
    fState.call.startedAt = fState.call.startedAt || Date.now();
    fState.callTimerId = setInterval(() => {
      if (!fState.call) return;
      const txt = formatCallDuration(Date.now() - fState.call.startedAt);
      const statusEl = el('call-stage-status');
      const miniTimer = el('call-mini-timer');
      if (statusEl && fState.call.status === 'active') statusEl.textContent = txt;
      if (miniTimer) miniTimer.textContent = fState.call.status === 'active' ? txt : 'Calling...';
    }, 500);
  }

  function cleanupCallResources(hideAll = true) {
    stopRingtone();
    if (fState.callTimerId) {
      clearInterval(fState.callTimerId);
      fState.callTimerId = null;
    }
    if (fState.pc) {
      try { fState.pc.close(); } catch { }
      fState.pc = null;
    }
    if (fState.localStream) {
      try {
        fState.localStream.getTracks().forEach((t) => t.stop());
      } catch { }
      fState.localStream = null;
    }
    fState.remoteStream = null;
    fState.pendingIce = [];
    fState.call = null;
    fState.callMuted = false;
    fState.callCamOff = false;
    fState.callMinimized = false;

    const lv = el('call-local-video');
    const rv = el('call-remote-video');
    if (lv) lv.srcObject = null;
    if (rv) rv.srcObject = null;
    if (hideAll) {
      if (el('call-ring-overlay')) el('call-ring-overlay').classList.add('hidden');
      if (el('active-call-overlay')) el('active-call-overlay').classList.add('hidden');
      if (el('call-mini-player')) el('call-mini-player').classList.add('hidden');
    }
  }

  async function acquireMediaStream(mode) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera/Microphone access requires HTTPS or supported WebView.');
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video' ? { facingMode: fState.callFacing } : false
      });
    } catch (err) {
      if (mode === 'video') {
        core().showToast('Camera unavailable — falling back to audio call.', 'error');
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      throw err;
    }
  }

  async function createPeerConnectionForCall(callId) {
    let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    try {
      const cfg = await core().api('/api/calls/config');
      if (Array.isArray(cfg.iceServers) && cfg.iceServers.length > 0) {
        iceServers = cfg.iceServers;
      }
    } catch { }

    const RTCPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!RTCPC) throw new Error('WebRTC is not supported in this browser.');

    const pc = new RTCPC({ iceServers });
    fState.pc = pc;
    fState.remoteStream = typeof MediaStream === 'function' ? new MediaStream() : null;

    if (fState.localStream) {
      fState.localStream.getTracks().forEach((track) => pc.addTrack(track, fState.localStream));
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && fState.call && fState.call.id === callId) {
        core().api(`/api/calls/${encodeURIComponent(callId)}/signal`, {
          method: 'POST',
          body: { type: 'ice', data: ev.candidate }
        }).catch(() => { });
      }
    };

    pc.ontrack = (ev) => {
      const rv = el('call-remote-video');
      const stream = (ev.streams && ev.streams[0]) || fState.remoteStream;
      if (stream && !ev.streams?.[0] && fState.remoteStream) {
        fState.remoteStream.addTrack(ev.track);
      }
      if (ev.track && ev.track.kind === 'video' && fState.call) {
        fState.call.hasRemoteVideo = true;
      }
      if (rv && stream) rv.srcObject = stream;
      renderCallUI();
    };

    pc.onconnectionstatechange = () => {
      if (!fState.call || fState.call.id !== callId) return;
      if (pc.connectionState === 'connected') {
        fState.call.status = 'active';
        startCallTimer();
        renderCallUI();
      } else if (pc.connectionState === 'failed') {
        core().showToast('Call connection lost.', 'error');
        hangupCurrentCall('disconnected');
      }
    };

    return pc;
  }

  function renderCallUI() {
    const call = fState.call;
    const ringOverlay = el('call-ring-overlay');
    const stageOverlay = el('active-call-overlay');
    const miniPlayer = el('call-mini-player');
    if (!call) {
      if (ringOverlay) ringOverlay.classList.add('hidden');
      if (stageOverlay) stageOverlay.classList.add('hidden');
      if (miniPlayer) miniPlayer.classList.add('hidden');
      return;
    }

    const peer = call.peerProfile || { username: call.peerUsername, displayName: call.peerUsername };
    const peerName = peer.displayName || peer.username;
    const hasVideo = call.mode === 'video';

    if (call.status === 'ringing' && call.role === 'callee') {
      if (ringOverlay) ringOverlay.classList.remove('hidden');
      if (stageOverlay) stageOverlay.classList.add('hidden');
      if (miniPlayer) miniPlayer.classList.add('hidden');
      if (el('call-ring-avatar')) core().renderAvatar(el('call-ring-avatar'), peer);
      if (el('call-ring-name')) el('call-ring-name').textContent = peerName;
      if (el('call-ring-sub')) el('call-ring-sub').textContent = `Incoming ${hasVideo ? 'video' : 'audio'} call...`;
      return;
    }

    if (ringOverlay) ringOverlay.classList.add('hidden');

    if (fState.callMinimized) {
      if (stageOverlay) stageOverlay.classList.add('hidden');
      if (miniPlayer) miniPlayer.classList.remove('hidden');
      if (el('call-mini-name')) el('call-mini-name').textContent = peerName;
      if (el('call-mini-mute')) el('call-mini-mute').textContent = fState.callMuted ? '🔇' : '🎙️';
    } else {
      if (miniPlayer) miniPlayer.classList.add('hidden');
      if (stageOverlay) stageOverlay.classList.remove('hidden');
      if (el('call-stage-name')) el('call-stage-name').textContent = peerName;
      if (el('call-stage-status')) {
        el('call-stage-status').textContent = call.status === 'active'
          ? formatCallDuration(Date.now() - (call.startedAt || Date.now()))
          : 'Ringing...';
      }
      const showRemoteVideo = hasVideo && Boolean(call.hasRemoteVideo) && call.status === 'active';
      if (el('call-remote-video')) el('call-remote-video').classList.toggle('hidden', !showRemoteVideo);
      if (el('call-stage-avatar')) core().renderAvatar(el('call-stage-avatar'), peer);
      if (el('call-audio-placeholder')) el('call-audio-placeholder').classList.toggle('hidden', showRemoteVideo);
      if (el('call-local-video')) el('call-local-video').classList.toggle('hidden', !hasVideo || fState.callCamOff);
      if (el('call-cam-btn')) el('call-cam-btn').classList.toggle('hidden', !hasVideo);
      if (el('call-flip-btn')) el('call-flip-btn').classList.toggle('hidden', !hasVideo);
      if (el('call-mute-btn')) {
        el('call-mute-btn').textContent = fState.callMuted ? '🔇 Unmute' : '🎙️ Mute';
        el('call-mute-btn').classList.toggle('active', fState.callMuted);
      }
      if (el('call-cam-btn')) {
        el('call-cam-btn').textContent = fState.callCamOff ? '📷 Cam On' : '📷 Cam Off';
        el('call-cam-btn').classList.toggle('active', fState.callCamOff);
      }
    }
  }

  async function initiateCall(mode) {
    if (!core()) return;
    const state = core().getState();
    if (!state.activePeer) {
      core().showToast('Open a direct chat to place a call.', 'error');
      return;
    }
    if (fState.call) {
      core().showToast('You are already in a call.', 'error');
      return;
    }

    const peer = state.activePeer;
    try {
      fState.localStream = await acquireMediaStream(mode);
      const data = await core().api('/api/calls/start', {
        method: 'POST',
        body: {
          targetUsername: peer.username,
          mode,
          chatId: state.activeChatId
        }
      });

      fState.call = {
        id: data.call.id,
        role: 'caller',
        peerUsername: peer.username,
        peerProfile: peer,
        mode: data.call.mode,
        status: 'ringing',
        startedAt: null
      };

      const lv = el('call-local-video');
      if (lv) lv.srcObject = fState.localStream;

      await createPeerConnectionForCall(data.call.id);
      renderCallUI();
    } catch (err) {
      cleanupCallResources();
      core().showToast(err.message || 'Could not start call.', 'error');
    }
  }

  async function acceptIncomingCall() {
    if (!fState.call || fState.call.role !== 'callee') return;
    const callId = fState.call.id;
    stopRingtone();
    try {
      fState.localStream = await acquireMediaStream(fState.call.mode);
      const lv = el('call-local-video');
      if (lv) lv.srcObject = fState.localStream;

      await createPeerConnectionForCall(callId);
      await core().api(`/api/calls/${encodeURIComponent(callId)}/accept`, { method: 'POST' });
      fState.call.status = 'active';
      fState.call.startedAt = Date.now();
      startCallTimer();
      renderCallUI();
    } catch (err) {
      await core().api(`/api/calls/${encodeURIComponent(callId)}/decline`, { method: 'POST' }).catch(() => { });
      cleanupCallResources();
      core().showToast(err.message || 'Could not access microphone/camera.', 'error');
    }
  }

  async function declineIncomingCall() {
    if (!fState.call) return;
    const callId = fState.call.id;
    cleanupCallResources();
    await core().api(`/api/calls/${encodeURIComponent(callId)}/decline`, { method: 'POST' }).catch(() => { });
  }

  async function hangupCurrentCall(reason = 'hangup') {
    if (!fState.call) {
      cleanupCallResources();
      return;
    }
    const callId = fState.call.id;
    cleanupCallResources();
    await core().api(`/api/calls/${encodeURIComponent(callId)}/end`, {
      method: 'POST',
      body: { reason }
    }).catch(() => { });
  }

  function toggleMuteCall() {
    if (!fState.localStream) return;
    fState.callMuted = !fState.callMuted;
    fState.localStream.getAudioTracks().forEach((t) => { t.enabled = !fState.callMuted; });
    renderCallUI();
  }

  function toggleVideoCall() {
    if (!fState.localStream) return;
    fState.callCamOff = !fState.callCamOff;
    fState.localStream.getVideoTracks().forEach((t) => { t.enabled = !fState.callCamOff; });
    renderCallUI();
  }

  async function flipCameraCall() {
    if (!fState.call || fState.call.mode !== 'video' || !fState.pc) return;
    fState.callFacing = fState.callFacing === 'user' ? 'environment' : 'user';
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: fState.callFacing },
        audio: false
      });
      const nextTrack = nextStream.getVideoTracks()[0];
      if (!nextTrack) return;
      const sender = fState.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(nextTrack);
      if (fState.localStream) {
        fState.localStream.getVideoTracks().forEach((old) => {
          old.stop();
          fState.localStream.removeTrack(old);
        });
        fState.localStream.addTrack(nextTrack);
      }
      const lv = el('call-local-video');
      if (lv && fState.localStream) lv.srcObject = fState.localStream;
    } catch {
      core().showToast('Could not switch camera.', 'error');
    }
  }

  async function handleCallSignalEvent(payload) {
    if (!fState.call || !fState.pc || payload.callId !== fState.call.id) return;
    const pc = fState.pc;
    try {
      if (payload.type === 'offer') {
        await pc.setRemoteDescription(payload.data);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await core().api(`/api/calls/${encodeURIComponent(fState.call.id)}/signal`, {
          method: 'POST',
          body: { type: 'answer', data: answer }
        });
        for (const c of fState.pendingIce) {
          await pc.addIceCandidate(c).catch(() => { });
        }
        fState.pendingIce = [];
      } else if (payload.type === 'answer') {
        await pc.setRemoteDescription(payload.data);
        for (const c of fState.pendingIce) {
          await pc.addIceCandidate(c).catch(() => { });
        }
        fState.pendingIce = [];
      } else if (payload.type === 'ice' && payload.data) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(payload.data).catch(() => { });
        } else {
          fState.pendingIce.push(payload.data);
        }
      }
    } catch {
      // Ignore transient WebRTC negotiation mismatch
    }
  }

  // =========================================================================
  // SSE Event & Hook Dispatcher
  // =========================================================================
  async function onSseEvent(eventName, data) {
    if (!core()) return;
    if (eventName === 'stranger_matched' && data.session) {
      fState.strangerStatus = 'matched';
      fState.strangerSession = data.session;
      fState.strangerEndedReason = '';
      fState.strangerRevealInfo = null;
      fState.strangerTyping = false;
      renderStrangerModal();
      core().showToast(`Matched with ${data.session.partnerAlias}!`, 'success');
    } else if (eventName === 'stranger_message' && data.message && fState.strangerSession && data.sessionId === fState.strangerSession.sessionId) {
      if (!fState.strangerSession.messages.some((m) => m.id === data.message.id)) {
        fState.strangerSession.messages.push(data.message);
        fState.strangerTyping = false;
        renderStrangerModal();
      }
    } else if (eventName === 'stranger_typing' && fState.strangerSession && data.sessionId === fState.strangerSession.sessionId) {
      fState.strangerTyping = Boolean(data.isTyping);
      clearTimeout(fState.strangerTypingTimer);
      if (fState.strangerTyping) {
        fState.strangerTypingTimer = setTimeout(() => {
          fState.strangerTyping = false;
          renderStrangerModal();
        }, 3200);
      }
      renderStrangerModal();
    } else if (eventName === 'stranger_reveal_requested' && fState.strangerSession && data.sessionId === fState.strangerSession.sessionId) {
      fState.strangerSession.revealByPartner = true;
      renderStrangerModal();
      core().showToast(`${data.partnerAlias} wants to reveal profiles!`, 'success');
    } else if (eventName === 'stranger_revealed' && fState.strangerSession && data.sessionId === fState.strangerSession.sessionId) {
      fState.strangerSession.revealed = true;
      fState.strangerRevealInfo = { friend: data.friend, dmChatId: data.dmChatId };
      renderStrangerModal();
      await core().refreshChats();
    } else if (eventName === 'stranger_ended' && fState.strangerSession && data.sessionId === fState.strangerSession.sessionId) {
      fState.strangerStatus = 'ended';
      fState.strangerEndedReason = data.reason === 'skipped'
        ? `${data.partnerAlias} skipped to someone else.`
        : `${data.partnerAlias} disconnected.`;
      renderStrangerModal();
    } else if (eventName === 'call_incoming' && data.call) {
      if (fState.call) {
        core().api(`/api/calls/${encodeURIComponent(data.call.id)}/decline`, { method: 'POST' }).catch(() => { });
        return;
      }
      fState.call = {
        id: data.call.id,
        role: 'callee',
        peerUsername: data.call.caller,
        peerProfile: data.callerProfile,
        mode: data.call.mode,
        status: 'ringing',
        startedAt: null
      };
      startRingtone();
      renderCallUI();
    } else if (eventName === 'call_accepted' && fState.call && fState.call.id === data.callId) {
      fState.call.status = 'active';
      fState.call.startedAt = Date.now();
      startCallTimer();
      renderCallUI();
      if (fState.call.role === 'caller' && fState.pc) {
        try {
          const offer = await fState.pc.createOffer();
          await fState.pc.setLocalDescription(offer);
          await core().api(`/api/calls/${encodeURIComponent(fState.call.id)}/signal`, {
            method: 'POST',
            body: { type: 'offer', data: offer }
          });
        } catch {
          core().showToast('Failed to start WebRTC offer.', 'error');
        }
      }
    } else if (eventName === 'call_signal') {
      await handleCallSignalEvent(data);
    } else if (eventName === 'call_declined' && fState.call && fState.call.id === data.callId) {
      cleanupCallResources();
      core().showToast(`@${data.by} declined the call.`);
    } else if (eventName === 'call_ended' && fState.call && fState.call.id === data.callId) {
      cleanupCallResources();
      if (data.reason === 'missed') {
        core().showToast('Call was not answered.');
      } else if (data.reason !== 'hangup') {
        core().showToast('Call ended.');
      }
    }
  }

  function onNewMessage(chatId, message) {
    if (message && message.kind === 'game' && message.game && fState.activeGameId === message.game.id) {
      renderGamesModal();
    }
  }

  function onMessageUpdated(chatId, message) {
    if (message && message.kind === 'game' && message.game && fState.activeGameId === message.game.id) {
      renderGamesModal();
    }
  }

  async function onAuthenticated() {
    if (typeof window !== 'undefined' && window.location && typeof URLSearchParams === 'function') {
      const qs = new URLSearchParams(window.location.search || '');
      const joinCode = qs.get('join');
      if (joinCode) {
        if (window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState({}, document.title, '/');
        }
        await handleInviteJoin(joinCode);
      }
    }
  }

  function onLogout() {
    cleanupCallResources();
    closeStrangerModal();
    closeGroupModal();
    closeGamesModal();
    fState.strangerStatus = 'idle';
    fState.strangerSession = null;
  }

  // =========================================================================
  // 5. In-Chat Polls & Quizzes
  // =========================================================================
  let pollDraft = {
    mode: 'poll',
    question: '',
    options: ['', ''],
    multiple: false,
    anonymous: false,
    correctIndex: 0,
    explanation: ''
  };

  function openPollModal() {
    const modal = el('poll-modal');
    if (!modal || !core()) return;
    if (!core().getState().activeChatId) {
      core().showToast('Open a chat or group first to create a poll.', 'info');
      return;
    }
    pollDraft = {
      mode: 'poll',
      question: '',
      options: ['', ''],
      multiple: false,
      anonymous: false,
      correctIndex: 0,
      explanation: ''
    };
    renderPollModal();
    modal.classList.remove('hidden');
  }

  function closePollModal() {
    const modal = el('poll-modal');
    if (modal) modal.classList.add('hidden');
  }

  function renderPollModal() {
    const titleEl = el('poll-modal-title');
    const bodyEl = el('poll-modal-body');
    if (!bodyEl) return;
    const isQuiz = pollDraft.mode === 'quiz';
    if (titleEl) titleEl.textContent = isQuiz ? 'Create Quiz Question' : 'Create Poll';

    bodyEl.innerHTML = `
      <form id="poll-create-form" class="vr-stack">
        <div class="vr-seg-tabs" role="tablist">
          <button type="button" class="vr-seg-tab ${!isQuiz ? 'active' : ''}" data-poll-mode="poll">📊 Poll</button>
          <button type="button" class="vr-seg-tab ${isQuiz ? 'active' : ''}" data-poll-mode="quiz">🧠 Quiz</button>
        </div>

        <div class="field-group">
          <label for="poll-question-input">Question</label>
          <input id="poll-question-input" type="text" maxlength="280" required placeholder="${isQuiz ? 'Ask a trivia or quiz question...' : 'Ask a question...'}" value="${esc(pollDraft.question)}" />
        </div>

        <div class="field-group">
          <label>Options ${isQuiz ? '(Select the correct answer)' : ''}</label>
          <div class="poll-draft-options">
            ${pollDraft.options.map((opt, idx) => `
              <div class="poll-draft-opt-row">
                ${isQuiz ? `<input type="radio" name="poll-correct-opt" value="${idx}" ${pollDraft.correctIndex === idx ? 'checked' : ''} title="Mark as correct answer" />` : ''}
                <input type="text" class="poll-opt-input" data-poll-opt-idx="${idx}" maxlength="120" required placeholder="Option ${idx + 1}" value="${esc(opt)}" />
                ${pollDraft.options.length > 2 ? `<button type="button" class="icon-btn-sm" data-poll-del-opt="${idx}" aria-label="Remove option">✕</button>` : ''}
              </div>
            `).join('')}
          </div>
          ${pollDraft.options.length < 8 ? '<button type="button" class="secondary-btn sm" id="poll-add-opt-btn">+ Add Option</button>' : ''}
        </div>

        ${isQuiz ? `
          <div class="field-group">
            <label for="poll-explanation-input">Answer Explanation (optional)</label>
            <input id="poll-explanation-input" type="text" maxlength="300" placeholder="Shown after someone answers..." value="${esc(pollDraft.explanation)}" />
          </div>
        ` : `
          <label class="poll-check-row">
            <input type="checkbox" id="poll-multi-check" ${pollDraft.multiple ? 'checked' : ''} />
            <span>Allow multiple answers</span>
          </label>
        `}

        <label class="poll-check-row">
          <input type="checkbox" id="poll-anon-check" ${pollDraft.anonymous ? 'checked' : ''} />
          <span>Anonymous voting</span>
        </label>

        <div class="modal-actions">
          <button type="submit" class="primary-btn full-width">${isQuiz ? 'Send Quiz' : 'Send Poll'}</button>
        </div>
      </form>
    `;

    const qInput = el('poll-question-input');
    if (qInput) qInput.addEventListener('input', () => { pollDraft.question = qInput.value; });
    bodyEl.querySelectorAll('.poll-opt-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = Number(inp.dataset.pollOptIdx);
        if (Number.isInteger(i)) pollDraft.options[i] = inp.value;
      });
    });
    const expInp = el('poll-explanation-input');
    if (expInp) expInp.addEventListener('input', () => { pollDraft.explanation = expInp.value; });
    const multiChk = el('poll-multi-check');
    if (multiChk) multiChk.addEventListener('change', () => { pollDraft.multiple = multiChk.checked; });
    const anonChk = el('poll-anon-check');
    if (anonChk) anonChk.addEventListener('change', () => { pollDraft.anonymous = anonChk.checked; });
    bodyEl.querySelectorAll('input[name="poll-correct-opt"]').forEach((rad) => {
      rad.addEventListener('change', () => {
        if (rad.checked) pollDraft.correctIndex = Number(rad.value) || 0;
      });
    });

    const addBtn = el('poll-add-opt-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (pollDraft.options.length < 8) {
          pollDraft.options.push('');
          renderPollModal();
        }
      });
    }

    const form = el('poll-create-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const chatId = core().getState().activeChatId;
        if (!chatId) return;
        const cleanOpts = pollDraft.options.map((s) => s.trim()).filter(Boolean);
        if (!pollDraft.question.trim() || cleanOpts.length < 2) {
          core().showToast('Enter a question and at least 2 options.', 'error');
          return;
        }
        try {
          const res = await core().api(`/api/chats/${encodeURIComponent(chatId)}/polls`, {
            method: 'POST',
            body: {
              question: pollDraft.question.trim(),
              options: cleanOpts,
              mode: pollDraft.mode,
              multiple: pollDraft.multiple,
              anonymous: pollDraft.anonymous,
              correctOptionIndex: pollDraft.mode === 'quiz' ? Math.min(pollDraft.correctIndex, cleanOpts.length - 1) : null,
              explanation: pollDraft.explanation.trim()
            }
          });
          closePollModal();
          if (res.message && !core().getState().messages.some((m) => m.id === res.message.id)) {
            core().getState().messages.push(res.message);
            core().renderMessages(true);
          }
          await core().refreshChats();
        } catch (err) {
          core().showToast(err.message || 'Could not create poll.', 'error');
        }
      });
    }
  }

  function handlePollModalClick(e) {
    const modeBtn = e.target.closest('[data-poll-mode]');
    if (modeBtn) {
      pollDraft.mode = modeBtn.dataset.pollMode === 'quiz' ? 'quiz' : 'poll';
      renderPollModal();
      return;
    }
    const delOpt = e.target.closest('[data-poll-del-opt]');
    if (delOpt && pollDraft.options.length > 2) {
      const idx = Number(delOpt.dataset.pollDelOpt);
      pollDraft.options.splice(idx, 1);
      if (pollDraft.correctIndex >= pollDraft.options.length) pollDraft.correctIndex = 0;
      renderPollModal();
    }
  }

  async function votePollOption(chatId, pollId, optionIdx) {
    if (!core() || !chatId || !pollId) return;
    const msg = (core().getState().messages || []).find((m) => m.kind === 'poll' && m.poll && m.poll.id === pollId);
    if (!msg || !msg.poll) return;
    const poll = msg.poll;
    const me = getMyUsername();
    let nextIndexes = [optionIdx];

    if (poll.multiple && poll.mode !== 'quiz') {
      const curSet = new Set();
      (poll.options || []).forEach((opt, i) => {
        const voted = typeof opt.votedByMe === 'boolean'
          ? opt.votedByMe
          : (Array.isArray(opt.votes) && opt.votes.includes(me));
        if (voted) curSet.add(i);
      });
      if (curSet.has(optionIdx)) curSet.delete(optionIdx);
      else curSet.add(optionIdx);
      nextIndexes = Array.from(curSet);
    }

    try {
      const res = await core().api(`/api/chats/${encodeURIComponent(chatId)}/polls/${encodeURIComponent(pollId)}/vote`, {
        method: 'POST',
        body: { optionIndexes: nextIndexes }
      });
      if (res.message) {
        const msgs = core().getState().messages;
        const idx = msgs.findIndex((m) => m.id === res.message.id);
        if (idx >= 0) {
          msgs[idx] = res.message;
          core().renderMessages(false);
        }
      }
    } catch (err) {
      core().showToast(err.message || 'Vote failed.', 'error');
    }
  }

  async function closePollById(chatId, pollId) {
    if (!core() || !chatId || !pollId) return;
    try {
      const res = await core().api(`/api/chats/${encodeURIComponent(chatId)}/polls/${encodeURIComponent(pollId)}/close`, {
        method: 'POST'
      });
      if (res.message) {
        const msgs = core().getState().messages;
        const idx = msgs.findIndex((m) => m.id === res.message.id);
        if (idx >= 0) {
          msgs[idx] = res.message;
          core().renderMessages(false);
        }
      }
    } catch (err) {
      core().showToast(err.message || 'Could not close poll.', 'error');
    }
  }

  function renderPollBubbleHtml(msg) {
    const p = msg && msg.poll;
    if (!p) return '';
    const me = getMyUsername();
    const isQuiz = p.mode === 'quiz';
    const opts = Array.isArray(p.options) ? p.options : [];
    const totalVotes = opts.reduce((sum, o) => sum + (typeof o.voteCount === 'number' ? o.voteCount : (Array.isArray(o.votes) ? o.votes.length : 0)), 0);
    const hasVoted = opts.some((o) => (typeof o.votedByMe === 'boolean' ? o.votedByMe : (Array.isArray(o.votes) && o.votes.includes(me))));
    const showResults = !isQuiz || hasVoted || Boolean(p.closed);
    const canClose = !p.closed && p.creator === me;

    const tags = [isQuiz ? '🧠 QUIZ' : '📊 POLL'];
    if (p.multiple) tags.push('Multiple');
    if (p.anonymous) tags.push('Anonymous');
    if (p.closed) tags.push('Closed');

    const optionsHtml = opts.map((opt, idx) => {
      const count = typeof opt.voteCount === 'number' ? opt.voteCount : (Array.isArray(opt.votes) ? opt.votes.length : 0);
      const voted = typeof opt.votedByMe === 'boolean' ? opt.votedByMe : (Array.isArray(opt.votes) && opt.votes.includes(me));
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

      let quizCls = '';
      let markIcon = voted ? '✓' : '';
      if (isQuiz && showResults && p.correctOptionIndex !== null && p.correctOptionIndex !== undefined) {
        if (idx === p.correctOptionIndex) {
          quizCls = 'quiz-correct';
          markIcon = '✅';
        } else if (voted) {
          quizCls = 'quiz-wrong';
          markIcon = '❌';
        }
      }

      return `
        <button type="button" class="poll-option-btn ${voted ? 'voted' : ''} ${quizCls}" data-poll-id="${esc(p.id)}" data-poll-vote="${idx}" ${p.closed || (isQuiz && hasVoted) ? 'disabled' : ''}>
          <span class="poll-opt-fill" style="width:${showResults ? pct : 0}%"></span>
          <span class="poll-opt-row">
            <span class="poll-opt-check">${markIcon}</span>
            <span class="poll-opt-text">${esc(opt.text)}</span>
            ${showResults ? `<span class="poll-opt-pct">${pct}%</span>` : ''}
          </span>
        </button>
      `;
    }).join('');

    const explanationHtml = isQuiz && showResults && p.explanation
      ? `<div class="poll-explanation">💡 ${esc(p.explanation)}</div>`
      : '';

    return `
      <div class="poll-card">
        <div class="poll-card-badges">${tags.map((t) => `<span class="poll-tag">${esc(t)}</span>`).join('')}</div>
        <div class="poll-question">${esc(p.question)}</div>
        <div class="poll-options-list">${optionsHtml}</div>
        ${explanationHtml}
        <div class="poll-footer">
          <span>${totalVotes} vote${totalVotes === 1 ? '' : 's'}</span>
          ${canClose ? `<button type="button" class="poll-close-btn" data-poll-close="${esc(p.id)}">Close ${isQuiz ? 'Quiz' : 'Poll'}</button>` : ''}
        </div>
      </div>
    `;
  }

  function handleEscape() {
    const pm = el('poll-modal');
    if (pm && !pm.classList.contains('hidden')) { closePollModal(); return true; }
    const gm = el('games-modal');
    if (gm && !gm.classList.contains('hidden')) { closeGamesModal(); return true; }
    const grm = el('group-modal');
    if (grm && !grm.classList.contains('hidden')) { closeGroupModal(); return true; }
    const sm = el('stranger-modal');
    if (sm && !sm.classList.contains('hidden')) { closeStrangerModal(); return true; }
    const stage = el('active-call-overlay');
    if (stage && !stage.classList.contains('hidden')) {
      fState.callMinimized = true;
      renderCallUI();
      return true;
    }
    return false;
  }

  function bindEvents() {
    if (el('menu-stranger')) {
      el('menu-stranger').addEventListener('click', () => {
        if (core()) core().closeDrawer();
        openStrangerModal();
      });
    }
    if (el('menu-new-group')) {
      el('menu-new-group').addEventListener('click', () => {
        if (core()) core().closeDrawer();
        openGroupModal('create');
      });
    }
    if (el('menu-games')) {
      el('menu-games').addEventListener('click', () => {
        if (core()) core().closeDrawer();
        openGamesHub(null);
      });
    }
    if (el('open-games-btn')) {
      el('open-games-btn').addEventListener('click', () => openGamesHub(null));
    }
    if (el('call-audio-btn')) {
      el('call-audio-btn').addEventListener('click', () => initiateCall('audio'));
    }
    if (el('call-video-btn')) {
      el('call-video-btn').addEventListener('click', () => initiateCall('video'));
    }

    if (el('stranger-modal-close')) el('stranger-modal-close').addEventListener('click', closeStrangerModal);
    if (el('stranger-modal-backdrop')) el('stranger-modal-backdrop').addEventListener('click', closeStrangerModal);
    if (el('stranger-body')) {
      el('stranger-body').addEventListener('click', (e) => {
        const tagBtn = e.target.closest('[data-stranger-tag]');
        if (tagBtn) {
          const tag = tagBtn.dataset.strangerTag;
          if (fState.strangerInterests.includes(tag)) {
            fState.strangerInterests = fState.strangerInterests.filter((t) => t !== tag);
          } else if (fState.strangerInterests.length < 6) {
            fState.strangerInterests.push(tag);
          }
          renderStrangerModal();
        }
      });
    }

    if (el('group-modal-close')) el('group-modal-close').addEventListener('click', closeGroupModal);
    if (el('group-modal-backdrop')) el('group-modal-backdrop').addEventListener('click', closeGroupModal);
    if (el('group-modal-body')) {
      el('group-modal-body').addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-grp-tab]');
        if (tabBtn) {
          groupModalTab = tabBtn.dataset.grpTab;
          renderGroupModal();
          return;
        }
        const typeBtn = e.target.closest('[data-grp-type]');
        if (typeBtn) {
          groupCreateType = typeBtn.dataset.grpType;
          renderGroupModal();
          return;
        }
        const pickBtn = e.target.closest('[data-grp-pick]');
        if (pickBtn) {
          const u = pickBtn.dataset.grpPick;
          if (selectedGroupMembers.has(u)) selectedGroupMembers.delete(u);
          else selectedGroupMembers.add(u);
          renderGroupModal();
          return;
        }
        const rmBtn = e.target.closest('[data-grp-remove-chip]');
        if (rmBtn) {
          selectedGroupMembers.delete(rmBtn.dataset.grpRemoveChip);
          renderGroupModal();
        }
      });
    }

    if (el('games-modal-close')) el('games-modal-close').addEventListener('click', closeGamesModal);
    if (el('games-modal-backdrop')) el('games-modal-backdrop').addEventListener('click', closeGamesModal);
    if (el('games-modal-body')) el('games-modal-body').addEventListener('click', handleGamesBodyClick);

    if (el('poll-modal-close')) el('poll-modal-close').addEventListener('click', closePollModal);
    if (el('poll-backdrop')) el('poll-backdrop').addEventListener('click', closePollModal);
    if (el('poll-modal-body')) el('poll-modal-body').addEventListener('click', handlePollModalClick);

    if (el('info-room-controls')) {
      el('info-room-controls').addEventListener('click', handleRoomInfoClick);
    }

    // Call controls
    if (el('call-accept-btn')) el('call-accept-btn').addEventListener('click', acceptIncomingCall);
    if (el('call-decline-btn')) el('call-decline-btn').addEventListener('click', declineIncomingCall);
    if (el('call-hangup-btn')) el('call-hangup-btn').addEventListener('click', () => hangupCurrentCall('hangup'));
    if (el('call-mini-hangup')) el('call-mini-hangup').addEventListener('click', () => hangupCurrentCall('hangup'));
    if (el('call-mute-btn')) el('call-mute-btn').addEventListener('click', toggleMuteCall);
    if (el('call-mini-mute')) el('call-mini-mute').addEventListener('click', toggleMuteCall);
    if (el('call-cam-btn')) el('call-cam-btn').addEventListener('click', toggleVideoCall);
    if (el('call-flip-btn')) el('call-flip-btn').addEventListener('click', flipCameraCall);
    if (el('call-minimize-btn')) {
      el('call-minimize-btn').addEventListener('click', () => {
        fState.callMinimized = true;
        renderCallUI();
      });
    }
    if (el('call-mini-expand')) {
      el('call-mini-expand').addEventListener('click', () => {
        fState.callMinimized = false;
        renderCallUI();
      });
    }

    // @Mention autocomplete
    const msgInput = el('message-input');
    const mentionPop = el('mention-popover');
    if (msgInput && mentionPop) {
      msgInput.addEventListener('input', updateMentionAutocomplete);
      msgInput.addEventListener('keydown', (e) => {
        if (mentionPop.classList.contains('hidden') || fState.mentionMatches.length === 0) return;
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const picked = fState.mentionMatches[fState.mentionActiveIdx] || fState.mentionMatches[0];
          if (picked) applyMentionChoice(picked.username);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          fState.mentionActiveIdx = (fState.mentionActiveIdx + 1) % fState.mentionMatches.length;
          Array.from(mentionPop.children).forEach((ch, idx) => ch.classList.toggle('active', idx === fState.mentionActiveIdx));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          fState.mentionActiveIdx = (fState.mentionActiveIdx - 1 + fState.mentionMatches.length) % fState.mentionMatches.length;
          Array.from(mentionPop.children).forEach((ch, idx) => ch.classList.toggle('active', idx === fState.mentionActiveIdx));
        }
      }, true);
      mentionPop.addEventListener('click', (e) => {
        const item = e.target.closest('[data-pick-mention]');
        if (item) applyMentionChoice(item.dataset.pickMention);
      });
    }
  }

  window.VibeRoomFeatures = {
    onSseEvent,
    onNewMessage,
    onMessageUpdated,
    onAuthenticated,
    onLogout,
    handleEscape,
    handleInviteJoin,
    renderRoomInfo,
    renderGameBubbleHtml,
    renderCallBubbleHtml,
    renderPollBubbleHtml,
    openPollModal,
    votePollOption,
    closePollById,
    rematchGame,
    cancelGameById,
    openGameById,
    openStrangerModal,
    openGroupModal,
    openGamesHub,
    initiateCall
  };

  if (typeof document !== 'undefined') {
    bindEvents();
  }
})();
