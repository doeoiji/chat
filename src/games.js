const crypto = require('node:crypto');
const path = require('node:path');

const FIVE_LETTER_WORDS = [
  'APPLE', 'BEACH', 'BRAIN', 'BREAD', 'BRICK', 'CHAIR', 'CHEST', 'CLOUD',
  'COAST', 'CRAFT', 'CROWN', 'DANCE', 'DREAM', 'DRINK', 'EARTH', 'FEAST',
  'FIELD', 'FLAME', 'FLASH', 'FLOAT', 'FLOOR', 'FOCUS', 'FORCE', 'FRAME',
  'FRANK', 'FRUIT', 'GHOST', 'GIANT', 'GLASS', 'GLOBE', 'GRACE', 'GRAPE',
  'GREEN', 'HEART', 'HOUSE', 'JUICE', 'KNIFE', 'LAUGH', 'LIGHT', 'LUCKY',
  'MAGIC', 'MAPLE', 'MATCH', 'METAL', 'MONEY', 'MONTH', 'MUSIC', 'NIGHT',
  'NOISE', 'NORTH', 'OCEAN', 'OLIVE', 'PAINT', 'PAPER', 'PARTY', 'PEACE',
  'PEARL', 'PHONE', 'PIANO', 'PILOT', 'PIZZA', 'PLANE', 'PLANT', 'PLATE',
  'POINT', 'POWER', 'PRIDE', 'PRIZE', 'QUEEN', 'QUICK', 'QUIET', 'RADIO',
  'RANGE', 'RIVER', 'ROBIN', 'ROBOT', 'ROUND', 'ROYAL', 'SCALE', 'SCOPE',
  'SCORE', 'SHADE', 'SHAPE', 'SHARE', 'SHARK', 'SHEEP', 'SHELL', 'SHINE',
  'SHIRT', 'SHOOT', 'SHORE', 'SHORT', 'SIGHT', 'SKILL', 'SLEEP', 'SLICE',
  'SMILE', 'SMOKE', 'SNAKE', 'SOLAR', 'SOLID', 'SOUND', 'SOUTH', 'SPACE',
  'SPARK', 'SPEAK', 'SPEED', 'SPICE', 'SPORT', 'STAGE', 'STAMP', 'STAND',
  'STARR', 'START', 'STATE', 'STEAM', 'STEEL', 'STICK', 'STONE', 'STORE',
  'STORM', 'STORY', 'SUGAR', 'SUPER', 'SWEET', 'SWING', 'TABLE', 'TASTE',
  'TEACH', 'THANK', 'THEME', 'TIGER', 'TOAST', 'TODAY', 'TOUCH', 'TOWER',
  'TRACK', 'TRADE', 'TRAIN', 'TREAT', 'TREND', 'TRIAL', 'TRICK', 'TRUCK',
  'TRUST', 'TRUTH', 'UNDER', 'UNITY', 'VALUE', 'VIDEO', 'VOICE', 'WATCH',
  'WATER', 'WHALE', 'WHEEL', 'WHITE', 'WHOLE', 'WORLD', 'WORTH', 'WRITE',
  'YOUTH', 'ZEBRA'
].map((w) => (w === 'STARR' ? 'STARS' : w));

const INITIAL_CHESS_BOARD = [
  'r', 'n', 'b', 'q', 'k', 'b', 'n', 'r',
  'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p',
  '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '',
  'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P',
  'R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'
];

function isWhitePiece(p) {
  return Boolean(p) && p === p.toUpperCase();
}

function isBlackPiece(p) {
  return Boolean(p) && p === p.toLowerCase();
}

function belongsToSide(p, side) {
  if (!p) return false;
  return side === 'w' ? isWhitePiece(p) : isBlackPiece(p);
}

function generatePseudoChessMoves(board, fromIdx, side) {
  const piece = board[fromIdx];
  if (!belongsToSide(piece, side)) return [];
  const r0 = Math.floor(fromIdx / 8);
  const c0 = fromIdx % 8;
  const type = piece.toLowerCase();
  const targets = [];

  const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const addSlide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let r = r0 + dr;
      let c = c0 + dc;
      while (inBounds(r, c)) {
        const idx = r * 8 + c;
        const occ = board[idx];
        if (!occ) {
          targets.push(idx);
        } else {
          if (!belongsToSide(occ, side)) targets.push(idx);
          break;
        }
        r += dr;
        c += dc;
      }
    }
  };

  if (type === 'p') {
    const dir = side === 'w' ? -1 : 1;
    const startRow = side === 'w' ? 6 : 1;
    if (inBounds(r0 + dir, c0) && !board[(r0 + dir) * 8 + c0]) {
      targets.push((r0 + dir) * 8 + c0);
      if (r0 === startRow && !board[(r0 + 2 * dir) * 8 + c0]) {
        targets.push((r0 + 2 * dir) * 8 + c0);
      }
    }
    for (const dc of [-1, 1]) {
      const r = r0 + dir;
      const c = c0 + dc;
      if (inBounds(r, c)) {
        const occ = board[r * 8 + c];
        if (occ && !belongsToSide(occ, side)) {
          targets.push(r * 8 + c);
        }
      }
    }
  } else if (type === 'n') {
    const jumps = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    for (const [dr, dc] of jumps) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (inBounds(r, c)) {
        const occ = board[r * 8 + c];
        if (!occ || !belongsToSide(occ, side)) targets.push(r * 8 + c);
      }
    }
  } else if (type === 'b') {
    addSlide([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  } else if (type === 'r') {
    addSlide([[-1, 0], [1, 0], [0, -1], [0, 1]]);
  } else if (type === 'q') {
    addSlide([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]);
  } else if (type === 'k') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = r0 + dr;
        const c = c0 + dc;
        if (inBounds(r, c)) {
          const occ = board[r * 8 + c];
          if (!occ || !belongsToSide(occ, side)) targets.push(r * 8 + c);
        }
      }
    }
  }

  return targets;
}

function applyChessMoveToBoard(board, fromIdx, toIdx, side) {
  const next = board.slice();
  let moving = next[fromIdx];
  next[fromIdx] = '';
  const toRow = Math.floor(toIdx / 8);
  if (moving === 'P' && toRow === 0) moving = 'Q';
  if (moving === 'p' && toRow === 7) moving = 'q';
  next[toIdx] = moving;
  return next;
}

function isKingInCheck(board, side) {
  const kingChar = side === 'w' ? 'K' : 'k';
  const kingIdx = board.indexOf(kingChar);
  if (kingIdx < 0) return true;
  const enemy = side === 'w' ? 'b' : 'w';
  for (let i = 0; i < 64; i++) {
    if (belongsToSide(board[i], enemy)) {
      const moves = generatePseudoChessMoves(board, i, enemy);
      if (moves.includes(kingIdx)) return true;
    }
  }
  return false;
}

function hasAnyLegalChessMove(board, side) {
  for (let i = 0; i < 64; i++) {
    if (!belongsToSide(board[i], side)) continue;
    const candidates = generatePseudoChessMoves(board, i, side);
    for (const toIdx of candidates) {
      const next = applyChessMoveToBoard(board, i, toIdx, side);
      if (!isKingInCheck(next, side)) return true;
    }
  }
  return false;
}

function checkTicTacToeWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winnerMark: board[a], line: [a, b, c] };
    }
  }
  return null;
}

function checkConnect4Winner(grid) {
  const rows = 6;
  const cols = 7;
  const at = (r, c) => grid[r * cols + c];
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mark = at(r, c);
      if (!mark) continue;
      for (const [dr, dc] of dirs) {
        const line = [[r, c]];
        for (let k = 1; k < 4; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || at(nr, nc) !== mark) break;
          line.push([nr, nc]);
        }
        if (line.length === 4) {
          return { winnerMark: mark, line: line.map(([rr, cc]) => rr * cols + cc) };
        }
      }
    }
  }
  return null;
}

function scoreWordGuess(secret, guess) {
  const res = Array(5).fill('absent');
  const remaining = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === secret[i]) {
      res[i] = 'exact';
    } else {
      remaining[secret[i]] = (remaining[secret[i]] || 0) + 1;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'exact') continue;
    if (remaining[guess[i]] > 0) {
      res[i] = 'present';
      remaining[guess[i]]--;
    }
  }
  return res;
}

function createGamesService({ storage, friends = null }) {
  const TITLES = {
    tictactoe: 'Tic-Tac-Toe',
    connect4: 'Connect 4',
    chess: 'Chess',
    wordguess: 'Word Duel'
  };

  async function pickOpponent(chatId, creatorUsername, requestedOpponent) {
    const meta = await storage.getChatMeta(chatId);
    if (!meta || !meta.participants.includes(creatorUsername)) {
      const err = new Error('Chat not found.');
      err.statusCode = 404;
      throw err;
    }
    const others = meta.participants.filter((p) => p !== creatorUsername);
    const cleanReq = String(requestedOpponent || '').trim().toLowerCase();
    let opponent = null;
    if (cleanReq && others.includes(cleanReq)) {
      opponent = cleanReq;
    } else if (others.length > 0) {
      opponent = others[0];
    }
    if (!opponent) {
      const err = new Error('Invite another member first to play a 2-player game.');
      err.statusCode = 400;
      throw err;
    }
    return { meta, opponent };
  }

  async function createGame({ chatId, creatorUsername, gameType, opponentUsername }) {
    const cleanType = String(gameType || '').trim().toLowerCase();
    if (!TITLES[cleanType]) {
      const err = new Error('Unsupported game type.');
      err.statusCode = 400;
      throw err;
    }

    const { opponent } = await pickOpponent(chatId, creatorUsername, opponentUsername);
    if (friends && !(await friends.areFriends(creatorUsername, opponent))) {
      const err = new Error(`You can only play mini-games with friends. Add @${opponent} as a friend first!`);
      err.statusCode = 403;
      throw err;
    }
    const gameId = `game_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    let initialState = {};
    let secretWord = null;

    if (cleanType === 'tictactoe') {
      initialState = {
        board: Array(9).fill(''),
        marks: { [creatorUsername]: 'X', [opponent]: 'O' },
        winLine: null
      };
    } else if (cleanType === 'connect4') {
      initialState = {
        grid: Array(42).fill(''),
        marks: { [creatorUsername]: 'R', [opponent]: 'Y' },
        winLine: null
      };
    } else if (cleanType === 'chess') {
      initialState = {
        board: INITIAL_CHESS_BOARD.slice(),
        sides: { [creatorUsername]: 'w', [opponent]: 'b' },
        inCheck: false,
        lastMove: null
      };
    } else if (cleanType === 'wordguess') {
      secretWord = FIVE_LETTER_WORDS[crypto.randomInt(0, FIVE_LETTER_WORDS.length)];
      initialState = {
        guesses: [],
        maxGuesses: 6,
        revealedWord: null
      };
    }

    const game = {
      id: gameId,
      type: cleanType,
      title: TITLES[cleanType],
      creator: creatorUsername,
      players: [creatorUsername, opponent],
      turn: creatorUsername,
      status: 'active',
      winner: null,
      draw: false,
      movesCount: 0,
      state: initialState,
      createdAt: now,
      updatedAt: now
    };

    if (secretWord) {
      const folder = storage.chatFolder(chatId);
      const secretsPath = path.join(folder, 'game_secrets.json');
      await storage.withLock(`gamesecret:${chatId}`, async () => {
        const secrets = (await storage.readJson(secretsPath, {})) || {};
        secrets[gameId] = secretWord;
        await storage.writeJsonAtomic(secretsPath, secrets);
      });
    }

    const { message, meta } = await storage.appendChatMessage(chatId, creatorUsername, {
      text: `🎮 ${TITLES[cleanType]} match started: @${creatorUsername} vs @${opponent}`,
      kind: 'game',
      game
    });

    return { message, meta };
  }

  async function makeMove({ chatId, gameId, playerUsername, move }) {
    let secretWord = null;
    const folder = storage.chatFolder(chatId);
    if (!folder) {
      const err = new Error('Chat not found.');
      err.statusCode = 404;
      throw err;
    }

    const secretsPath = path.join(folder, 'game_secrets.json');
    const secretsSnapshot = await storage.readJson(secretsPath, {});
    if (secretsSnapshot && secretsSnapshot[gameId]) {
      secretWord = secretsSnapshot[gameId];
    }

    const result = await storage.mutateChatMessages(chatId, async ({ meta, messages }) => {
      if (!meta.participants.includes(playerUsername)) {
        const err = new Error('Chat not found.');
        err.statusCode = 404;
        throw err;
      }
      const msg = messages.find((m) => m.game && m.game.id === gameId);
      if (!msg) {
        const err = new Error('Game not found.');
        err.statusCode = 404;
        throw err;
      }

      const game = msg.game;
      if (!game.players.includes(playerUsername)) {
        const err = new Error('You are not a player in this match.');
        err.statusCode = 403;
        throw err;
      }
      if (game.status !== 'active') {
        const err = new Error('This match has already finished.');
        err.statusCode = 400;
        throw err;
      }

      const otherPlayer = game.players.find((p) => p !== playerUsername) || playerUsername;

      if (move && move.resign) {
        game.status = 'finished';
        game.winner = otherPlayer;
        game.draw = false;
        game.updatedAt = new Date().toISOString();
        msg.text = `🏁 ${game.title}: @${otherPlayer} wins (by resignation)!`;
        return { message: msg, saveMessages: true, saveMeta: false };
      }

      if (game.turn !== playerUsername) {
        const err = new Error(`It is @${game.turn}'s turn.`);
        err.statusCode = 400;
        throw err;
      }

      if (game.type === 'tictactoe') {
        const idx = Number(move && move.index);
        if (!Number.isInteger(idx) || idx < 0 || idx > 8 || game.state.board[idx]) {
          const err = new Error('Invalid cell.');
          err.statusCode = 400;
          throw err;
        }
        const mark = game.state.marks[playerUsername];
        game.state.board[idx] = mark;
        game.movesCount += 1;

        const win = checkTicTacToeWinner(game.state.board);
        if (win) {
          game.status = 'finished';
          game.winner = playerUsername;
          game.state.winLine = win.line;
          msg.text = `🏆 Tic-Tac-Toe: @${playerUsername} wins!`;
        } else if (game.state.board.every(Boolean)) {
          game.status = 'finished';
          game.draw = true;
          msg.text = `🤝 Tic-Tac-Toe ended in a draw!`;
        } else {
          game.turn = otherPlayer;
        }
      } else if (game.type === 'connect4') {
        const col = Number(move && move.col);
        if (!Number.isInteger(col) || col < 0 || col > 6) {
          const err = new Error('Invalid column.');
          err.statusCode = 400;
          throw err;
        }
        let placedRow = -1;
        for (let r = 5; r >= 0; r--) {
          if (!game.state.grid[r * 7 + col]) {
            placedRow = r;
            break;
          }
        }
        if (placedRow < 0) {
          const err = new Error('Column is full.');
          err.statusCode = 400;
          throw err;
        }
        const mark = game.state.marks[playerUsername];
        game.state.grid[placedRow * 7 + col] = mark;
        game.movesCount += 1;

        const win = checkConnect4Winner(game.state.grid);
        if (win) {
          game.status = 'finished';
          game.winner = playerUsername;
          game.state.winLine = win.line;
          msg.text = `🏆 Connect 4: @${playerUsername} wins!`;
        } else if (game.state.grid.every(Boolean)) {
          game.status = 'finished';
          game.draw = true;
          msg.text = `🤝 Connect 4 ended in a draw!`;
        } else {
          game.turn = otherPlayer;
        }
      } else if (game.type === 'chess') {
        const from = Number(move && move.from);
        const to = Number(move && move.to);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 63 || to < 0 || to > 63 || from === to) {
          const err = new Error('Invalid chess move.');
          err.statusCode = 400;
          throw err;
        }
        const mySide = game.state.sides[playerUsername];
        const enemySide = mySide === 'w' ? 'b' : 'w';
        const pseudoTargets = generatePseudoChessMoves(game.state.board, from, mySide);
        if (!pseudoTargets.includes(to)) {
          const err = new Error('Illegal chess move for that piece.');
          err.statusCode = 400;
          throw err;
        }
        const nextBoard = applyChessMoveToBoard(game.state.board, from, to, mySide);
        if (isKingInCheck(nextBoard, mySide)) {
          const err = new Error('That move would leave your King in check.');
          err.statusCode = 400;
          throw err;
        }

        game.state.board = nextBoard;
        game.state.lastMove = [from, to];
        game.movesCount += 1;

        const enemyInCheck = isKingInCheck(nextBoard, enemySide);
        game.state.inCheck = enemyInCheck;
        const enemyHasMove = hasAnyLegalChessMove(nextBoard, enemySide);

        if (!enemyHasMove) {
          game.status = 'finished';
          if (enemyInCheck) {
            game.winner = playerUsername;
            msg.text = `♚ Checkmate! @${playerUsername} wins at Chess!`;
          } else {
            game.draw = true;
            msg.text = `🤝 Chess ended in a stalemate draw!`;
          }
        } else {
          game.turn = otherPlayer;
          msg.text = enemyInCheck
            ? `♟️ Chess: Check on @${otherPlayer}!`
            : `♟️ Chess: @${otherPlayer}'s turn`;
        }
      } else if (game.type === 'wordguess') {
        const guess = String(move && move.word || '').trim().toUpperCase();
        if (!/^[A-Z]{5}$/.test(guess)) {
          const err = new Error('Please enter a valid 5-letter word.');
          err.statusCode = 400;
          throw err;
        }
        if (!secretWord) {
          const err = new Error('Game word unavailable.');
          err.statusCode = 500;
          throw err;
        }
        const pattern = scoreWordGuess(secretWord, guess);
        game.state.guesses.push({
          player: playerUsername,
          word: guess,
          pattern
        });
        game.movesCount += 1;

        if (guess === secretWord) {
          game.status = 'finished';
          game.winner = playerUsername;
          game.state.revealedWord = secretWord;
          msg.text = `🏆 Word Duel: @${playerUsername} guessed "${secretWord}"!`;
        } else if (game.state.guesses.length >= game.state.maxGuesses) {
          game.status = 'finished';
          game.draw = true;
          game.state.revealedWord = secretWord;
          msg.text = `🔤 Word Duel finished — the word was "${secretWord}"!`;
        } else {
          game.turn = otherPlayer;
        }
      }

      game.updatedAt = new Date().toISOString();
      return { message: msg, saveMessages: true, saveMeta: false };
    });

    if (!result) {
      const err = new Error('Game not found.');
      err.statusCode = 404;
      throw err;
    }

    if (result.message && result.message.game && result.message.game.status === 'finished' && typeof storage.recordGameOutcome === 'function') {
      await storage.recordGameOutcome(result.message.game).catch(() => {});
    }

    return result;
  }

  async function cancelGame({ chatId, gameId, requesterUsername }) {
    const result = await storage.mutateChatMessages(chatId, ({ meta, messages }) => {
      if (!meta.participants.includes(requesterUsername)) {
        const err = new Error('Chat not found.');
        err.statusCode = 404;
        throw err;
      }
      const msg = messages.find((m) => m.kind === 'game' && m.game && m.game.id === gameId);
      if (!msg) {
        const err = new Error('Game not found.');
        err.statusCode = 404;
        throw err;
      }
      const game = msg.game;
      const inviteSender = game.creator || (Array.isArray(game.players) ? game.players[0] : null);
      if (inviteSender !== requesterUsername) {
        const err = new Error('Only the user who sent the game invite can cancel it.');
        err.statusCode = 403;
        throw err;
      }
      if (game.status !== 'active') {
        const err = new Error('Only an active game can be cancelled.');
        err.statusCode = 400;
        throw err;
      }

      game.status = 'cancelled';
      game.cancelledBy = requesterUsername;
      game.turn = null;
      game.updatedAt = new Date().toISOString();
      msg.text = `🚫 ${game.title} invite cancelled by @${requesterUsername}`;
      return { message: msg, saveMessages: true, saveMeta: false };
    });

    if (!result) {
      const err = new Error('Game not found.');
      err.statusCode = 404;
      throw err;
    }

    if (result.message && result.message.game && result.message.game.status === 'finished' && typeof storage.recordGameOutcome === 'function') {
      await storage.recordGameOutcome(result.message.game).catch(() => {});
    }

    return result;
  }

  return {
    TITLES,
    createGame,
    makeMove,
    cancelGame
  };
}

module.exports = { createGamesService };
