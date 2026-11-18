const crypto = require('node:crypto');

function createPollsService({ storage }) {
  function sanitizePollForViewer(poll, viewerUsername) {
    if (!poll) return null;
    const cleanViewer = String(viewerUsername || '').trim().toLowerCase();
    const isQuiz = poll.mode === 'quiz';
    const hasVoted = Array.isArray(poll.options) && poll.options.some(
      (opt) => Array.isArray(opt.votes) && opt.votes.includes(cleanViewer)
    );
    const canSeeAnswer = !isQuiz || Boolean(poll.closed) || poll.creator === cleanViewer || hasVoted;

    return {
      ...poll,
      correctOptionIndex: canSeeAnswer ? poll.correctOptionIndex : null,
      explanation: canSeeAnswer ? (poll.explanation || '') : '',
      options: (poll.options || []).map((opt) => ({
        id: opt.id,
        text: opt.text,
        votes: poll.anonymous ? [] : (Array.isArray(opt.votes) ? opt.votes.slice() : []),
        voteCount: Array.isArray(opt.votes) ? opt.votes.length : 0,
        votedByMe: Array.isArray(opt.votes) ? opt.votes.includes(cleanViewer) : false
      }))
    };
  }

  async function createPoll({
    chatId,
    creatorUsername,
    question,
    options,
    mode = 'poll',
    multiple = false,
    anonymous = false,
    correctOptionIndex = null,
    explanation = ''
  }) {
    const cleanQ = String(question || '').trim().slice(0, 280);
    if (!cleanQ) {
      const err = new Error('Poll question is required.');
      err.statusCode = 400;
      throw err;
    }

    const cleanOptions = Array.isArray(options)
      ? options.map((o) => String(o || '').trim().slice(0, 120)).filter(Boolean)
      : [];
    if (cleanOptions.length < 2 || cleanOptions.length > 10) {
      const err = new Error('Please provide between 2 and 10 options.');
      err.statusCode = 400;
      throw err;
    }

    const cleanMode = mode === 'quiz' ? 'quiz' : 'poll';
    let cleanCorrect = null;
    if (cleanMode === 'quiz') {
      const idx = Number(correctOptionIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cleanOptions.length) {
        const err = new Error('Quiz mode requires a valid correct option.');
        err.statusCode = 400;
        throw err;
      }
      cleanCorrect = idx;
    }

    const poll = {
      id: `poll_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      mode: cleanMode,
      question: cleanQ,
      multiple: cleanMode === 'quiz' ? false : Boolean(multiple),
      anonymous: Boolean(anonymous),
      correctOptionIndex: cleanCorrect,
      explanation: cleanMode === 'quiz' ? String(explanation || '').trim().slice(0, 300) : '',
      options: cleanOptions.map((text, idx) => ({
        id: `opt_${idx}_${crypto.randomBytes(2).toString('hex')}`,
        text,
        votes: []
      })),
      creator: creatorUsername,
      closed: false,
      createdAt: new Date().toISOString()
    };

    const previewPrefix = cleanMode === 'quiz' ? '🧠 Quiz' : '📊 Poll';
    return storage.appendChatMessage(chatId, creatorUsername, {
      text: `${previewPrefix}: ${cleanQ}`,
      kind: 'poll',
      poll
    });
  }

  async function votePoll({ chatId, pollId, voterUsername, optionIndexes }) {
    const indexes = Array.isArray(optionIndexes)
      ? Array.from(new Set(optionIndexes.map((n) => Number(n)).filter((n) => Number.isInteger(n))))
      : [];

    const result = await storage.mutateChatMessages(chatId, ({ meta, messages }) => {
      if (!meta.participants.includes(voterUsername)) {
        const err = new Error('Chat not found.');
        err.statusCode = 404;
        throw err;
      }
      const msg = messages.find((m) => m.kind === 'poll' && m.poll && m.poll.id === pollId);
      if (!msg) {
        const err = new Error('Poll not found.');
        err.statusCode = 404;
        throw err;
      }
      const poll = msg.poll;
      if (poll.closed) {
        const err = new Error('This poll is closed.');
        err.statusCode = 400;
        throw err;
      }
      for (const idx of indexes) {
        if (idx < 0 || idx >= poll.options.length) {
          const err = new Error('Invalid option selected.');
          err.statusCode = 400;
          throw err;
        }
      }

      if (poll.mode === 'quiz') {
        const alreadyVoted = poll.options.some((o) => Array.isArray(o.votes) && o.votes.includes(voterUsername));
        if (alreadyVoted) {
          const err = new Error('You already answered this quiz.');
          err.statusCode = 400;
          throw err;
        }
        if (indexes.length !== 1) {
          const err = new Error('Choose one option for the quiz.');
          err.statusCode = 400;
          throw err;
        }
      } else if (!poll.multiple && indexes.length > 1) {
        const err = new Error('Only one option can be selected.');
        err.statusCode = 400;
        throw err;
      }

      for (let i = 0; i < poll.options.length; i++) {
        const opt = poll.options[i];
        if (!Array.isArray(opt.votes)) opt.votes = [];
        const has = opt.votes.includes(voterUsername);
        const want = indexes.includes(i);
        if (want && !has) opt.votes.push(voterUsername);
        else if (!want && has) opt.votes = opt.votes.filter((u) => u !== voterUsername);
      }

      poll.updatedAt = new Date().toISOString();
      return { message: msg, saveMessages: true, saveMeta: false };
    });

    if (!result) {
      const err = new Error('Poll not found.');
      err.statusCode = 404;
      throw err;
    }
    return result;
  }

  async function closePoll({ chatId, pollId, requesterUsername }) {
    const result = await storage.mutateChatMessages(chatId, ({ meta, messages }) => {
      if (!meta.participants.includes(requesterUsername)) {
        const err = new Error('Chat not found.');
        err.statusCode = 404;
        throw err;
      }
      const msg = messages.find((m) => m.kind === 'poll' && m.poll && m.poll.id === pollId);
      if (!msg) {
        const err = new Error('Poll not found.');
        err.statusCode = 404;
        throw err;
      }
      if (msg.poll.creator !== requesterUsername) {
        const err = new Error('Only the creator can close this poll.');
        err.statusCode = 403;
        throw err;
      }
      msg.poll.closed = true;
      msg.poll.closedAt = new Date().toISOString();
      return { message: msg, saveMessages: true, saveMeta: false };
    });

    if (!result) {
      const err = new Error('Poll not found.');
      err.statusCode = 404;
      throw err;
    }
    return result;
  }

  return {
    createPoll,
    votePoll,
    closePoll,
    sanitizePollForViewer
  };
}

module.exports = { createPollsService };
