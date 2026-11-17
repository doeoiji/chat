/**
 * Zero-dependency ISO/IEC 18004 Byte-mode QR Code SVG encoder (Versions 1–7, EC Level M).
 */
(function (root) {
  'use strict';

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGf() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      EXP[i] = EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGeneratorPoly(ecCount) {
    let poly = [1];
    for (let i = 0; i < ecCount; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsComputeRemainder(data, ecCount) {
    const gen = rsGeneratorPoly(ecCount);
    const res = new Array(ecCount).fill(0);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (let j = 0; j < ecCount; j++) {
        res[j] ^= gfMul(gen[j + 1], factor);
      }
    }
    return res;
  }

  // Version 1..7 at EC Level M (00)
  const VERSIONS_M = [
    null,
    { size: 21, totalData: 16, ecPerBlock: 10, blocks: [16], align: [] },
    { size: 25, totalData: 28, ecPerBlock: 16, blocks: [28], align: [6, 18] },
    { size: 29, totalData: 44, ecPerBlock: 26, blocks: [44], align: [6, 22] },
    { size: 33, totalData: 64, ecPerBlock: 18, blocks: [32, 32], align: [6, 26] },
    { size: 37, totalData: 86, ecPerBlock: 24, blocks: [43, 43], align: [6, 30] },
    { size: 41, totalData: 108, ecPerBlock: 16, blocks: [27, 27, 27, 27], align: [6, 34] },
    { size: 45, totalData: 124, ecPerBlock: 18, blocks: [31, 31, 31, 31], align: [6, 22, 38] }
  ];

  // Precomputed BCH format info strings for EC Level M (00) masks 0..7 XOR 0x5412
  const FORMAT_BITS_M = [
    0x5412, 0x5125, 0x5e7c, 0x5b4b,
    0x45f9, 0x40ce, 0x4f97, 0x4aa0
  ];

  function toUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(str));
    }
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return bytes;
  }

  function buildDataAndEc(bytes) {
    let ver = -1;
    for (let v = 1; v < VERSIONS_M.length; v++) {
      // 4 bits mode + 8 bits len + 8*N bytes -> max bytes = totalData - 2
      if (bytes.length <= VERSIONS_M[v].totalData - 2) {
        ver = v;
        break;
      }
    }
    if (ver < 0) {
      throw new Error('Text too long for QR code');
    }

    const spec = VERSIONS_M[ver];
    const bits = [];
    const pushBits = (val, count) => {
      for (let i = count - 1; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    };

    pushBits(0b0100, 4); // Byte mode
    pushBits(bytes.length, 8);
    for (const b of bytes) pushBits(b, 8);

    const maxDataBits = spec.totalData * 8;
    const term = Math.min(4, maxDataBits - bits.length);
    for (let i = 0; i < term; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataCodewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
      dataCodewords.push(byte);
    }
    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (dataCodewords.length < spec.totalData) {
      dataCodewords.push(padBytes[padIdx % 2]);
      padIdx++;
    }

    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (const blockLen of spec.blocks) {
      const slice = dataCodewords.slice(offset, offset + blockLen);
      offset += blockLen;
      dataBlocks.push(slice);
      ecBlocks.push(rsComputeRemainder(slice, spec.ecPerBlock));
    }

    const interleaved = [];
    const maxDataLen = Math.max(...spec.blocks);
    for (let i = 0; i < maxDataLen; i++) {
      for (const blk of dataBlocks) {
        if (i < blk.length) interleaved.push(blk[i]);
      }
    }
    for (let i = 0; i < spec.ecPerBlock; i++) {
      for (const ec of ecBlocks) {
        if (i < ec.length) interleaved.push(ec[i]);
      }
    }

    return { version: ver, spec, codewords: interleaved };
  }

  function createMatrix(size) {
    return Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  }

  function placeFinder(modules, isFunc, top, left) {
    const size = modules.length;
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const isBorder = dr === -1 || dr === 7 || dc === -1 || dc === 7;
        const isOuter = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const isCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        modules[r][c] = !isBorder && (isOuter || isCore) ? 1 : 0;
        isFunc[r][c] = 1;
      }
    }
  }

  function placeAlignment(modules, isFunc, cr, cc) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (isFunc[r][c]) return;
      }
    }
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        modules[cr + dr][cc + dc] = dist !== 1 ? 1 : 0;
        isFunc[cr + dr][cc + dc] = 1;
      }
    }
  }

  function reserveFunctionPatterns(modules, isFunc, spec) {
    const size = spec.size;
    placeFinder(modules, isFunc, 0, 0);
    placeFinder(modules, isFunc, 0, size - 7);
    placeFinder(modules, isFunc, size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      modules[6][i] = i % 2 === 0 ? 1 : 0;
      isFunc[6][i] = 1;
      modules[i][6] = i % 2 === 0 ? 1 : 0;
      isFunc[i][6] = 1;
    }

    for (const r of spec.align) {
      for (const c of spec.align) {
        placeAlignment(modules, isFunc, r, c);
      }
    }

    // Reserve format info cells & dark module
    for (let i = 0; i < 9; i++) {
      if (i !== 6) {
        isFunc[8][i] = 1;
        isFunc[i][8] = 1;
      }
    }
    for (let i = size - 8; i < size; i++) {
      isFunc[8][i] = 1;
      isFunc[i][8] = 1;
    }
    modules[size - 8][8] = 1;
    isFunc[size - 8][8] = 1;

    // Version 7 includes 3x6 version info blocks
    if (spec.size >= 45) {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
          isFunc[i][size - 11 + j] = 1;
          isFunc[size - 11 + j][i] = 1;
        }
      }
    }
  }

  function placeDataBits(modules, isFunc, codewords) {
    const size = modules.length;
    const allBits = [];
    for (const cw of codewords) {
      for (let b = 7; b >= 0; b--) allBits.push((cw >> b) & 1);
    }
    let bitIdx = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let lr = 0; lr < 2; lr++) {
          const c = right - lr;
          if (!isFunc[r][c]) {
            modules[r][c] = bitIdx < allBits.length ? allBits[bitIdx] : 0;
            bitIdx++;
          }
        }
      }
      upward = !upward;
    }
  }

  function applyMask(modules, isFunc, maskId) {
    const size = modules.length;
    const out = modules.map((row) => new Int8Array(row));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isFunc[r][c]) continue;
        let invert = false;
        switch (maskId) {
          case 0: invert = (r + c) % 2 === 0; break;
          case 1: invert = r % 2 === 0; break;
          case 2: invert = c % 3 === 0; break;
          case 3: invert = (r + c) % 3 === 0; break;
          case 4: invert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
          case 5: invert = ((r * c) % 2 + (r * c) % 3) === 0; break;
          case 6: invert = (((r * c) % 2 + (r * c) % 3) % 2) === 0; break;
          case 7: invert = (((r + c) % 2 + (r * c) % 3) % 2) === 0; break;
        }
        if (invert) out[r][c] ^= 1;
      }
    }
    return out;
  }

  function writeFormatBits(modules, maskId) {
    const size = modules.length;
    const bits = FORMAT_BITS_M[maskId];
    for (let i = 0; i <= 5; i++) modules[8][i] = (bits >> i) & 1;
    modules[8][7] = (bits >> 6) & 1;
    modules[8][8] = (bits >> 7) & 1;
    modules[7][8] = (bits >> 8) & 1;
    for (let i = 9; i < 15; i++) modules[14 - i][8] = (bits >> i) & 1;

    for (let i = 0; i < 8; i++) modules[size - 1 - i][8] = (bits >> i) & 1;
    for (let i = 8; i < 15; i++) modules[8][size - 15 + i] = (bits >> i) & 1;
  }

  function writeVersionBits(modules, version) {
    if (version < 7) return;
    // Version 7 BCH(18,6) = 0x07C94
    const verBits = 0x07c94;
    const size = modules.length;
    for (let i = 0; i < 18; i++) {
      const bit = (verBits >> i) & 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      modules[r][c] = bit;
      modules[c][r] = bit;
    }
  }

  function scoreMatrix(modules) {
    const size = modules.length;
    let score = 0;
    let dark = 0;
    for (let r = 0; r < size; r++) {
      let runRow = 1;
      let runCol = 1;
      for (let c = 0; c < size; c++) {
        if (modules[r][c]) dark++;
        if (c > 0) {
          if (modules[r][c] === modules[r][c - 1]) runRow++;
          else {
            if (runRow >= 5) score += 3 + (runRow - 5);
            runRow = 1;
          }
          if (modules[c][r] === modules[c - 1][r]) runCol++;
          else {
            if (runCol >= 5) score += 3 + (runCol - 5);
            runCol = 1;
          }
        }
        if (r < size - 1 && c < size - 1) {
          const v = modules[r][c];
          if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
            score += 3;
          }
        }
      }
      if (runRow >= 5) score += 3 + (runRow - 5);
      if (runCol >= 5) score += 3 + (runCol - 5);
    }
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function encodeMatrix(text) {
    const bytes = toUtf8Bytes(String(text || ''));
    const { version, spec, codewords } = buildDataAndEc(bytes);
    const base = createMatrix(spec.size);
    const isFunc = createMatrix(spec.size).map((r) => r.fill(0));
    reserveFunctionPatterns(base, isFunc, spec);
    placeDataBits(base, isFunc, codewords);

    let bestModules = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const masked = applyMask(base, isFunc, mask);
      writeFormatBits(masked, mask);
      writeVersionBits(masked, version);
      const s = scoreMatrix(masked);
      if (s < bestScore) {
        bestScore = s;
        bestModules = masked;
      }
    }
    return { size: spec.size, version, modules: bestModules };
  }

  function renderSvg(text, { margin = 4, darkColor = '#0E1621', lightColor = '#FFFFFF' } = {}) {
    const { size, modules } = encodeMatrix(text);
    const full = size + margin * 2;
    let pathD = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (modules[r][c] === 1) {
          pathD += `M${c + margin},${r + margin}h1v1h-1z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="Profile QR code"><rect width="${full}" height="${full}" fill="${lightColor}"/><path d="${pathD}" fill="${darkColor}"/></svg>`;
  }

  const api = { encodeMatrix, renderSvg };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.VibeRoomQR = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
