const fs = require('node:fs');
const path = require('node:path');

function createFriendsService({ config, storage }) {
  function friendsFilePath(username) {
    const folder = storage.userFolder(username);
    return folder ? path.join(folder, 'friends.json') : null;
  }

  async function readUserFriendsRaw(username) {
    const filePath = friendsFilePath(username);
    if (!filePath) return { friends: [], sent: [], received: [] };
    const data = await storage.readJson(filePath, {});
    return {
      friends: Array.isArray(data && data.friends) ? data.friends : [],
      sent: Array.isArray(data && data.sent) ? data.sent : [],
      received: Array.isArray(data && data.received) ? data.received : []
    };
  }

  async function writeUserFriendsRaw(username, data) {
    const filePath = friendsFilePath(username);
    if (!filePath) return;
    await storage.writeJsonAtomic(filePath, {
      friends: Array.from(new Set(data.friends || [])),
      sent: Array.isArray(data.sent) ? data.sent : [],
      received: Array.isArray(data.received) ? data.received : []
    });
  }

  function withSortedPairLock(userA, userB, fn) {
    const pair = [String(userA).trim().toLowerCase(), String(userB).trim().toLowerCase()].sort();
    if (pair[0] === pair[1]) {
      return storage.withLock(`friends:${pair[0]}`, fn);
    }
    return storage.withLock(`friends:${pair[0]}`, () =>
      storage.withLock(`friends:${pair[1]}`, fn)
    );
  }

  async function areFriends(userA, userB) {
    const a = String(userA || '').trim().toLowerCase();
    const b = String(userB || '').trim().toLowerCase();
    if (!a || !b || a === b) return false;
    const data = await readUserFriendsRaw(a);
    return data.friends.includes(b);
  }

  async function getRelationship(viewerUsername, otherUsername) {
    const me = String(viewerUsername || '').trim().toLowerCase();
    const other = String(otherUsername || '').trim().toLowerCase();
    if (!me || !other) return 'none';
    if (me === other) return 'self';
    const data = await readUserFriendsRaw(me);
    if (data.friends.includes(other)) return 'friends';
    if (data.sent.some((r) => r.to === other)) return 'outgoing_pending';
    if (data.received.some((r) => r.from === other)) return 'incoming_pending';
    return 'none';
  }

  async function listFriendsData(username) {
    const clean = String(username || '').trim().toLowerCase();
    const raw = await readUserFriendsRaw(clean);

    const friends = [];
    for (const uname of raw.friends) {
      const u = await storage.getUserByUsername(uname);
      if (u) friends.push({ ...storage.toPublicUser(u), relationship: 'friends' });
    }
    friends.sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));

    const sent = [];
    for (const item of raw.sent) {
      const u = await storage.getUserByUsername(item.to);
      if (u) sent.push({ user: { ...storage.toPublicUser(u), relationship: 'outgoing_pending' }, at: item.at });
    }

    const received = [];
    for (const item of raw.received) {
      const u = await storage.getUserByUsername(item.from);
      if (u) received.push({ user: { ...storage.toPublicUser(u), relationship: 'incoming_pending' }, at: item.at });
    }

    return { friends, sent, received };
  }

  async function addDirectFriendship(userA, userB) {
    const a = String(userA || '').trim().toLowerCase();
    const b = String(userB || '').trim().toLowerCase();
    if (!a || !b || a === b) return false;
    return withSortedPairLock(a, b, async () => {
      const [dataA, dataB] = await Promise.all([readUserFriendsRaw(a), readUserFriendsRaw(b)]);
      if (!dataA.friends.includes(b)) dataA.friends.push(b);
      if (!dataB.friends.includes(a)) dataB.friends.push(a);
      dataA.sent = dataA.sent.filter((r) => r.to !== b);
      dataA.received = dataA.received.filter((r) => r.from !== b);
      dataB.sent = dataB.sent.filter((r) => r.to !== a);
      dataB.received = dataB.received.filter((r) => r.from !== a);
      await Promise.all([writeUserFriendsRaw(a, dataA), writeUserFriendsRaw(b, dataB)]);
      return true;
    });
  }

  async function sendFriendRequest(fromUsername, targetUsername) {
    const from = String(fromUsername || '').trim().toLowerCase();
    const target = String(targetUsername || '').trim().toLowerCase();
    if (!from || !target || from === target) {
      const err = new Error('You cannot send a friend request to yourself.');
      err.statusCode = 400;
      throw err;
    }
    const targetUser = await storage.getUserByUsername(target);
    if (!targetUser) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }

    return withSortedPairLock(from, target, async () => {
      const [dataFrom, dataTarget] = await Promise.all([
        readUserFriendsRaw(from),
        readUserFriendsRaw(target)
      ]);

      if (dataFrom.friends.includes(target)) {
        return { status: 'friends', target: storage.toPublicUser(targetUser), autoAccepted: false };
      }

      // If target already sent us a request, accept it mutually right away
      const reverseReq = dataFrom.received.some((r) => r.from === target);
      if (reverseReq) {
        dataFrom.friends.push(target);
        dataTarget.friends.push(from);
        dataFrom.received = dataFrom.received.filter((r) => r.from !== target);
        dataTarget.sent = dataTarget.sent.filter((r) => r.to !== from);
        await Promise.all([writeUserFriendsRaw(from, dataFrom), writeUserFriendsRaw(target, dataTarget)]);
        return { status: 'friends', target: storage.toPublicUser(targetUser), autoAccepted: true };
      }

      const now = new Date().toISOString();
      if (!dataFrom.sent.some((r) => r.to === target)) {
        dataFrom.sent.unshift({ to: target, at: now });
      }
      if (!dataTarget.received.some((r) => r.from === from)) {
        dataTarget.received.unshift({ from, at: now });
      }
      await Promise.all([writeUserFriendsRaw(from, dataFrom), writeUserFriendsRaw(target, dataTarget)]);
      return { status: 'outgoing_pending', target: storage.toPublicUser(targetUser), autoAccepted: false };
    });
  }

  async function acceptFriendRequest(accepterUsername, requesterUsername) {
    const accepter = String(accepterUsername || '').trim().toLowerCase();
    const requester = String(requesterUsername || '').trim().toLowerCase();
    const reqUser = await storage.getUserByUsername(requester);
    if (!reqUser) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }

    return withSortedPairLock(accepter, requester, async () => {
      const [dataAcc, dataReq] = await Promise.all([
        readUserFriendsRaw(accepter),
        readUserFriendsRaw(requester)
      ]);
      const hasIncoming = dataAcc.received.some((r) => r.from === requester);
      if (!hasIncoming && !dataAcc.friends.includes(requester)) {
        const err = new Error('Friend request not found.');
        err.statusCode = 404;
        throw err;
      }

      if (!dataAcc.friends.includes(requester)) dataAcc.friends.push(requester);
      if (!dataReq.friends.includes(accepter)) dataReq.friends.push(accepter);
      dataAcc.received = dataAcc.received.filter((r) => r.from !== requester);
      dataAcc.sent = dataAcc.sent.filter((r) => r.to !== requester);
      dataReq.sent = dataReq.sent.filter((r) => r.to !== accepter);
      dataReq.received = dataReq.received.filter((r) => r.from !== accepter);

      await Promise.all([writeUserFriendsRaw(accepter, dataAcc), writeUserFriendsRaw(requester, dataReq)]);
      return { status: 'friends', friend: storage.toPublicUser(reqUser) };
    });
  }

  async function declineFriendRequest(declinerUsername, requesterUsername) {
    const decliner = String(declinerUsername || '').trim().toLowerCase();
    const requester = String(requesterUsername || '').trim().toLowerCase();
    return withSortedPairLock(decliner, requester, async () => {
      const [dataDec, dataReq] = await Promise.all([
        readUserFriendsRaw(decliner),
        readUserFriendsRaw(requester)
      ]);
      dataDec.received = dataDec.received.filter((r) => r.from !== requester);
      dataReq.sent = dataReq.sent.filter((r) => r.to !== decliner);
      await Promise.all([writeUserFriendsRaw(decliner, dataDec), writeUserFriendsRaw(requester, dataReq)]);
      return { ok: true };
    });
  }

  async function cancelFriendRequest(senderUsername, targetUsername) {
    const sender = String(senderUsername || '').trim().toLowerCase();
    const target = String(targetUsername || '').trim().toLowerCase();
    return withSortedPairLock(sender, target, async () => {
      const [dataSender, dataTarget] = await Promise.all([
        readUserFriendsRaw(sender),
        readUserFriendsRaw(target)
      ]);
      dataSender.sent = dataSender.sent.filter((r) => r.to !== target);
      dataTarget.received = dataTarget.received.filter((r) => r.from !== sender);
      await Promise.all([writeUserFriendsRaw(sender, dataSender), writeUserFriendsRaw(target, dataTarget)]);
      return { ok: true };
    });
  }

  async function removeFriend(actorUsername, targetUsername) {
    const actor = String(actorUsername || '').trim().toLowerCase();
    const target = String(targetUsername || '').trim().toLowerCase();
    return withSortedPairLock(actor, target, async () => {
      const [dataActor, dataTarget] = await Promise.all([
        readUserFriendsRaw(actor),
        readUserFriendsRaw(target)
      ]);
      dataActor.friends = dataActor.friends.filter((u) => u !== target);
      dataTarget.friends = dataTarget.friends.filter((u) => u !== actor);
      await Promise.all([writeUserFriendsRaw(actor, dataActor), writeUserFriendsRaw(target, dataTarget)]);
      return { ok: true };
    });
  }

  async function renameUsername(oldUsername, newUsername) {
    const oldClean = String(oldUsername || '').trim().toLowerCase();
    const newClean = String(newUsername || '').trim().toLowerCase();
    if (!oldClean || !newClean || oldClean === newClean) return;

    const mine = await readUserFriendsRaw(newClean);
    const affected = new Set([
      ...mine.friends,
      ...mine.sent.map((r) => r.to),
      ...mine.received.map((r) => r.from)
    ]);

    for (const other of affected) {
      if (!other || other === oldClean || other === newClean) continue;
      if (!fs.existsSync(path.join(config.usersDir, other))) continue;
      await storage.withLock(`friends:${other}`, async () => {
        const d = await readUserFriendsRaw(other);
        let changed = false;
        const mapStr = (u) => {
          if (u === oldClean) { changed = true; return newClean; }
          return u;
        };
        d.friends = d.friends.map(mapStr);
        d.sent = d.sent.map((r) => (r.to === oldClean ? (changed = true, { ...r, to: newClean }) : r));
        d.received = d.received.map((r) => (r.from === oldClean ? (changed = true, { ...r, from: newClean }) : r));
        if (changed) {
          await writeUserFriendsRaw(other, d);
        }
      });
    }
  }

  return {
    areFriends,
    getRelationship,
    listFriendsData,
    addDirectFriendship,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
    renameUsername
  };
}

module.exports = { createFriendsService };
