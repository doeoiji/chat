const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function createGroupService({ config, storage, friends = null }) {
  function isGroupOrChannelId(chatId) {
    return /^(?:grp|chn)_[a-z0-9]{10,24}$/.test(String(chatId || ''));
  }

  function newRoomId(type) {
    const prefix = type === 'channel' ? 'chn' : 'grp';
    return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
  }

  function newInviteCode() {
    return crypto.randomBytes(6).toString('base64url');
  }

  async function enrichRoomChat(meta, viewerUsername = '') {
    if (!meta) return null;
    const memberProfiles = [];
    for (const uname of meta.participants || []) {
      const u = await storage.getUserByUsername(uname);
      if (u) {
        memberProfiles.push({
          ...storage.toPublicUser(u),
          isAdmin: Array.isArray(meta.admins) && meta.admins.includes(uname),
          isCreator: meta.createdBy === uname
        });
      }
    }
    return {
      id: meta.id,
      type: meta.type,
      title: meta.title,
      description: meta.description || '',
      inviteCode: meta.inviteCode,
      avatarColor: meta.avatarColor,
      admins: meta.admins || [],
      createdBy: meta.createdBy,
      participants: meta.participants || [],
      members: memberProfiles,
      memberCount: (meta.participants || []).length,
      peer: null,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastMessage: meta.lastMessage || null,
      unreadCount: viewerUsername && meta.unreadCounts ? (meta.unreadCounts[viewerUsername] || 0) : 0
    };
  }

  async function createGroupOrChannel({ creator, type = 'group', title, description = '', memberUsernames = [] }) {
    const cleanType = type === 'channel' ? 'channel' : 'group';
    const cleanTitle = String(title || '').trim().slice(0, 64);
    if (!cleanTitle || cleanTitle.length < 2) {
      const err = new Error('Please enter a title (at least 2 characters).');
      err.statusCode = 400;
      throw err;
    }

    const cleanDesc = String(description || '').trim().slice(0, 240);
    const participantsSet = new Set([creator]);
    if (Array.isArray(memberUsernames)) {
      for (const raw of memberUsernames) {
        const clean = String(raw || '').trim().replace(/^@+/, '').toLowerCase();
        if (!clean || clean === creator) continue;
        const found = await storage.getUserByUsername(clean);
        if (!found) continue;
        if (friends && !(await friends.areFriends(creator, found.username))) {
          const err = new Error(`You can only add friends to a group. Add @${found.username} as a friend or share the invite link!`);
          err.statusCode = 403;
          throw err;
        }
        participantsSet.add(found.username);
      }
    }

    const chatId = newRoomId(cleanType);
    const folder = storage.chatFolder(chatId);
    const participants = Array.from(participantsSet);
    const unreadCounts = {};
    for (const p of participants) unreadCounts[p] = 0;

    const now = new Date().toISOString();
    const colorIdx = Math.abs(
      cleanTitle.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    ) % storage.AVATAR_GRADIENTS.length;

    const meta = {
      id: chatId,
      type: cleanType,
      title: cleanTitle,
      description: cleanDesc,
      inviteCode: newInviteCode(),
      avatarColor: storage.AVATAR_GRADIENTS[colorIdx],
      admins: [creator],
      createdBy: creator,
      participants,
      createdAt: now,
      updatedAt: now,
      lastMessage: null,
      unreadCounts
    };

    await storage.withLock(`chat:${chatId}`, async () => {
      await fsp.mkdir(path.join(folder, 'files'), { recursive: true });
      await storage.writeJsonAtomic(path.join(folder, 'meta.json'), meta);
      await storage.writeJsonAtomic(path.join(folder, 'messages.json'), []);
      await fsp.writeFile(
        path.join(folder, 'chat.log'),
        `# VibeRoom ${cleanType === 'channel' ? 'Channel' : 'Group'}: ${cleanTitle} (${chatId})\n# Created by: ${creator} at ${now}\n`,
        'utf8'
      );
    });

    const welcomeText = cleanType === 'channel'
      ? `Channel "${cleanTitle}" created.`
      : `Group "${cleanTitle}" created.`;
    await storage.appendChatMessage(chatId, creator, {
      text: welcomeText,
      kind: 'system',
      allowChannelSystem: true
    });

    const updatedMeta = await storage.getChatMeta(chatId);
    return enrichRoomChat(updatedMeta, creator);
  }

  async function openRoom(chatId, username) {
    if (!isGroupOrChannelId(chatId)) {
      const err = new Error('Invalid room ID.');
      err.statusCode = 400;
      throw err;
    }
    const { meta, messages } = await storage.getMessages(chatId, username);
    return {
      chat: await enrichRoomChat(meta, username),
      messages
    };
  }

  async function findByInviteCode(code) {
    const cleanCode = String(code || '').trim();
    if (!cleanCode) return null;
    const entries = await fsp.readdir(config.chatsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !isGroupOrChannelId(entry.name)) continue;
      const meta = await storage.readJson(path.join(config.chatsDir, entry.name, 'meta.json'));
      if (meta && meta.inviteCode === cleanCode) {
        return meta;
      }
    }
    return null;
  }

  async function joinByInvite(code, username) {
    const target = await findByInviteCode(code);
    if (!target) {
      const err = new Error('Invalid or expired invite link.');
      err.statusCode = 404;
      throw err;
    }

    let joinedNew = false;
    await storage.withLock(`chat:${target.id}`, async () => {
      const folder = storage.chatFolder(target.id);
      const metaPath = path.join(folder, 'meta.json');
      const meta = await storage.readJson(metaPath);
      if (!meta) return;
      if (!meta.participants.includes(username)) {
        meta.participants.push(username);
        meta.unreadCounts = meta.unreadCounts || {};
        meta.unreadCounts[username] = 0;
        meta.updatedAt = new Date().toISOString();
        await storage.writeJsonAtomic(metaPath, meta);
        joinedNew = true;
      }
    });

    if (joinedNew) {
      await storage.appendChatMessage(target.id, username, {
        text: `@${username} joined via invite link.`,
        kind: 'system',
        allowChannelSystem: true
      }).catch(() => {});
    }

    const updatedMeta = await storage.getChatMeta(target.id);
    return {
      chat: await enrichRoomChat(updatedMeta, username),
      joinedNew
    };
  }

  function assertAdmin(meta, actorUsername) {
    if (!Array.isArray(meta.admins) || !meta.admins.includes(actorUsername)) {
      const err = new Error('Admin permission required.');
      err.statusCode = 403;
      throw err;
    }
  }

  async function updateRoom(chatId, actorUsername, updates = {}) {
    if (!isGroupOrChannelId(chatId)) {
      const err = new Error('Invalid room ID.');
      err.statusCode = 400;
      throw err;
    }
    return storage.withLock(`chat:${chatId}`, async () => {
      const folder = storage.chatFolder(chatId);
      const metaPath = path.join(folder, 'meta.json');
      const meta = await storage.readJson(metaPath);
      if (!meta || !meta.participants.includes(actorUsername)) {
        const err = new Error('Room not found.');
        err.statusCode = 404;
        throw err;
      }
      assertAdmin(meta, actorUsername);

      if (typeof updates.title === 'string') {
        const cleanTitle = updates.title.trim().slice(0, 64);
        if (cleanTitle.length >= 2) meta.title = cleanTitle;
      }
      if (typeof updates.description === 'string') {
        meta.description = updates.description.trim().slice(0, 240);
      }
      if (updates.regenerateInvite) {
        meta.inviteCode = newInviteCode();
      }
      meta.updatedAt = new Date().toISOString();
      await storage.writeJsonAtomic(metaPath, meta);
      return enrichRoomChat(meta, actorUsername);
    });
  }

  async function addMember(chatId, actorUsername, targetUsername) {
    const cleanTarget = String(targetUsername || '').trim().replace(/^@+/, '').toLowerCase();
    const user = await storage.getUserByUsername(cleanTarget);
    if (!user) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }
    if (cleanTarget !== actorUsername && friends && !(await friends.areFriends(actorUsername, cleanTarget))) {
      const err = new Error(`You can only add friends to a group or channel. Send @${cleanTarget} a friend request or share the invite link!`);
      err.statusCode = 403;
      throw err;
    }

    let added = false;
    await storage.withLock(`chat:${chatId}`, async () => {
      const folder = storage.chatFolder(chatId);
      const metaPath = path.join(folder, 'meta.json');
      const meta = await storage.readJson(metaPath);
      if (!meta || !meta.participants.includes(actorUsername)) {
        const err = new Error('Room not found.');
        err.statusCode = 404;
        throw err;
      }
      if (meta.type === 'channel') {
        assertAdmin(meta, actorUsername);
      }
      if (!meta.participants.includes(cleanTarget)) {
        meta.participants.push(cleanTarget);
        meta.unreadCounts = meta.unreadCounts || {};
        meta.unreadCounts[cleanTarget] = 0;
        meta.updatedAt = new Date().toISOString();
        await storage.writeJsonAtomic(metaPath, meta);
        added = true;
      }
    });

    if (added) {
      await storage.appendChatMessage(chatId, actorUsername, {
        text: `@${actorUsername} added @${cleanTarget}.`,
        kind: 'system',
        allowChannelSystem: true
      }).catch(() => {});
    }

    const updatedMeta = await storage.getChatMeta(chatId);
    return enrichRoomChat(updatedMeta, actorUsername);
  }

  async function removeMember(chatId, actorUsername, targetUsername) {
    const cleanTarget = String(targetUsername || '').trim().toLowerCase();
    let removedMeta = null;
    await storage.withLock(`chat:${chatId}`, async () => {
      const folder = storage.chatFolder(chatId);
      const metaPath = path.join(folder, 'meta.json');
      const meta = await storage.readJson(metaPath);
      if (!meta || !meta.participants.includes(actorUsername)) {
        const err = new Error('Room not found.');
        err.statusCode = 404;
        throw err;
      }
      const isSelfLeave = actorUsername === cleanTarget;
      if (!isSelfLeave) {
        assertAdmin(meta, actorUsername);
        if (cleanTarget === meta.createdBy) {
          const err = new Error('Cannot remove the room creator.');
          err.statusCode = 403;
          throw err;
        }
      }
      meta.participants = meta.participants.filter((p) => p !== cleanTarget);
      meta.admins = (meta.admins || []).filter((a) => a !== cleanTarget);
      if (meta.unreadCounts) delete meta.unreadCounts[cleanTarget];
      if (meta.participants.length > 0 && meta.admins.length === 0) {
        meta.admins.push(meta.participants[0]);
      }
      meta.updatedAt = new Date().toISOString();
      await storage.writeJsonAtomic(metaPath, meta);
      removedMeta = meta;
    });

    if (removedMeta && removedMeta.participants.length > 0 && removedMeta.admins.length > 0) {
      await storage.appendChatMessage(chatId, removedMeta.admins[0], {
        text: actorUsername === cleanTarget
          ? `@${cleanTarget} left the room.`
          : `@${actorUsername} removed @${cleanTarget}.`,
        kind: 'system',
        allowChannelSystem: true
      }).catch(() => {});
    }

    const freshMeta = await storage.getChatMeta(chatId);
    return {
      chat: await enrichRoomChat(freshMeta, actorUsername),
      removedUsername: cleanTarget
    };
  }

  async function setMemberAdmin(chatId, actorUsername, targetUsername, makeAdmin) {
    const cleanTarget = String(targetUsername || '').trim().toLowerCase();
    return storage.withLock(`chat:${chatId}`, async () => {
      const folder = storage.chatFolder(chatId);
      const metaPath = path.join(folder, 'meta.json');
      const meta = await storage.readJson(metaPath);
      if (!meta || !meta.participants.includes(actorUsername)) {
        const err = new Error('Room not found.');
        err.statusCode = 404;
        throw err;
      }
      assertAdmin(meta, actorUsername);
      if (!meta.participants.includes(cleanTarget)) {
        const err = new Error('User is not a member of this room.');
        err.statusCode = 404;
        throw err;
      }
      if (cleanTarget === meta.createdBy && !makeAdmin) {
        const err = new Error('Cannot demote the room creator.');
        err.statusCode = 403;
        throw err;
      }
      const adminsSet = new Set(meta.admins || []);
      if (makeAdmin) adminsSet.add(cleanTarget);
      else adminsSet.delete(cleanTarget);
      meta.admins = Array.from(adminsSet);
      meta.updatedAt = new Date().toISOString();
      await storage.writeJsonAtomic(metaPath, meta);
      return enrichRoomChat(meta, actorUsername);
    });
  }

  return {
    isGroupOrChannelId,
    enrichRoomChat,
    createGroupOrChannel,
    openRoom,
    findByInviteCode,
    joinByInvite,
    updateRoom,
    addMember,
    removeMember,
    setMemberAdmin
  };
}

module.exports = { createGroupService };
