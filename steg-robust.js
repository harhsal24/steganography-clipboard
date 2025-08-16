// steg-robust.js
// Robust LSB steganography + helpers for "compress first, draw text after, protect that area" workflow
const { createCanvas, loadImage } = require('canvas');
const crypto = require('crypto');

// ---------- CRC32 implementation ----------
function makeCRCTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = makeCRCTable();
function crc32(str) {
  let crc = 0 ^ -1;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ code) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}
function uint32ToBytes(n) {
  return [
    (n >>> 24) & 0xFF,
    (n >>> 16) & 0xFF,
    (n >>> 8) & 0xFF,
    n & 0xFF
  ].map(x => String.fromCharCode(x)).join('');
}
function bytesToUint32(chars) {
  let n = 0;
  for (let i = 0; i < 4; i++) n = (n << 8) | (chars.charCodeAt(i) & 0xFF);
  return n >>> 0;
}

// ---------- PRNG (xorshift32) and shuffle ----------
function xorshift32(seed) {
  let x = seed >>> 0;
  return function() {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}
function seededShuffle(arr, seed) {
  const rnd = xorshift32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

// ---------- binary helpers ----------
function stringToBinary(str) {
  return str.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');
}
function binaryToString(bin) {
  const bytes = bin.match(/.{1,8}/g) || [];
  return bytes.map(b => String.fromCharCode(parseInt(b, 2))).join('');
}

// ---------- utilities ----------
function deriveSeedFromPassphrase(passphrase) {
  if (!passphrase) return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
  const hash = crypto.createHash('sha256').update(passphrase).digest();
  return hash.readUInt32BE(0) >>> 0;
}

function pixelIndexFromByteIndex(byteIndex) {
  return Math.floor(byteIndex / 4);
}
function xyFromPixelIndex(pixelIndex, width) {
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  return { x, y };
}
function isPointInRects(x, y, rects) {
  if (!rects || rects.length === 0) return false;
  for (const r of rects) {
    if (x >= r.x && x < (r.x + r.w) && y >= r.y && y < (r.y + r.h)) return true;
  }
  return false;
}

// ---------- Core embedding/extraction (LSB robust) ----------
function embedTextInImage(imageData, text, opts = {}) {
  // opts:
  //   repeatCount (default 5),
  //   seed (optional),
  //   passphrase (optional) - if provided, overrides seed
  // NOTE: For correctness we use the same ordering for embed & extract:
  // both operate on ALL non-alpha bytes in raster order (so extractor can find header).
  // (This version does NOT skip 'excludeRects' when choosing positions —
  // skipping would require the extractor to know the same excludeRects.)
  const repeatCount = Number.isInteger(opts.repeatCount) ? opts.repeatCount : 5;
  const headerRepeat = 8; // repeats for header bits (robust header)
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  // Build positions: all non-alpha byte indices in raster order (same for embed & extract)
  const allPositions = [];
  for (let byteIndex = 0; byteIndex < data.length; byteIndex++) {
    if ((byteIndex % 4) === 3) continue; // skip alpha channel bytes
    allPositions.push(byteIndex);
  }

  // Prepare payload: append CRC32 (4 bytes)
  const crc = crc32(text);
  const textWithCrc = text + uint32ToBytes(crc);
  const payloadBinary = stringToBinary(textWithCrc);
  const payloadBits = payloadBinary.length;

  // Header layout: [MAGIC(8 bytes)][payloadBits:32][seed:32][repeatCount:8]
  const MAGIC = "STEG" + String.fromCharCode(0x1F,0x2F,0x3F,0x4F); // 8 chars
  const seed = opts.passphrase ? deriveSeedFromPassphrase(opts.passphrase) :
               (Number.isInteger(opts.seed) ? opts.seed >>> 0 : (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0));
  const headerBinParts = [
    stringToBinary(MAGIC),
    payloadBits.toString(2).padStart(32, '0'),
    (seed >>> 0).toString(2).padStart(32, '0'),
    (repeatCount & 0xFF).toString(2).padStart(8, '0')
  ];
  const headerBinary = headerBinParts.join('');
  const headerBits = headerBinary.length;

  // Capacity check:
  const headerNeeded = headerBits * headerRepeat;
  const payloadNeeded = payloadBits * repeatCount;
  const totalNeeded = headerNeeded + payloadNeeded;
  if (totalNeeded > allPositions.length) {
    return { success: false, error: `Insufficient capacity: need ${totalNeeded} usable bytes, have ${allPositions.length}` };
  }

  // Embed header into the first chunk of allPositions (no shuffle) with redundancy
  let posIdx = 0;
  for (let i = 0; i < headerBits; i++) {
    const bit = headerBinary[i] === '1' ? 1 : 0;
    for (let r = 0; r < headerRepeat; r++) {
      const p = allPositions[posIdx++];
      data[p] = (data[p] & 0xFE) | bit;
    }
  }

  // Build payload positions from the remaining positions (deterministically shuffled by seed)
  const payloadPositions = allPositions.slice(posIdx);
  seededShuffle(payloadPositions, seed);

  // Embed payload with repeatCount across positions
  let payloadPosIndex = 0;
  for (let i = 0; i < payloadBits; i++) {
    const bit = payloadBinary[i] === '1' ? 1 : 0;
    for (let r = 0; r < repeatCount; r++) {
      const p = payloadPositions[payloadPosIndex++];
      data[p] = (data[p] & 0xFE) | bit;
    }
  }

  return { success: true, imageData, meta: { seed, repeatCount, payloadBits } };
}

function extractTextFromImage(imageData) {
  try {
    const data = imageData.data;

    // build same ordering: all non-alpha bytes, raster order
    const usablePositions = [];
    for (let byteIndex = 0; byteIndex < data.length; byteIndex++) {
      if ((byteIndex % 4) === 3) continue;
      usablePositions.push(byteIndex);
    }

    const headerRepeat = 8;
    const MAGIC = "STEG" + String.fromCharCode(0x1F,0x2F,0x3F,0x4F);

    // header bits: 8 chars * 8 + 32 + 32 + 8 = 72 bits
    const headerBits = (8 * 8) + 32 + 32 + 8; // 72
    const headerPositionsNeeded = headerBits * headerRepeat;
    if (headerPositionsNeeded > usablePositions.length) {
      return { success: false, error: "Image too small or not stego data" };
    }

    // Read header by majority voting across headerRepeat copies
    let headerBinary = '';
    let posIdx = 0;
    for (let i = 0; i < headerBits; i++) {
      let votes0 = 0, votes1 = 0;
      for (let r = 0; r < headerRepeat; r++) {
        const p = usablePositions[posIdx++];
        const bit = data[p] & 1;
        if (bit) votes1++; else votes0++;
      }
      headerBinary += (votes1 > votes0 ? '1' : '0');
    }

    // Parse header
    const magicBits = headerBinary.slice(0, 64);
    const magicStr = binaryToString(magicBits);
    if (!magicStr.startsWith("STEG")) {
      return { success: false, error: "Not a steganographic image from this tool (magic not found)" };
    }
    const ptrAfterMagic = 64;
    const payloadBitsBin = headerBinary.slice(ptrAfterMagic, ptrAfterMagic + 32);
    const seedBin = headerBinary.slice(ptrAfterMagic + 32, ptrAfterMagic + 64);
    const repeatCountBin = headerBinary.slice(ptrAfterMagic + 64, ptrAfterMagic + 72);

    const payloadBits = parseInt(payloadBitsBin, 2);
    const seed = parseInt(seedBin, 2) >>> 0;
    const repeatCount = parseInt(repeatCountBin, 2);

    if (!(payloadBits > 0 && payloadBits < 20000000)) {
      return { success: false, error: "Invalid payload length in header" };
    }

    // Now build payloadPositions (the remainder after header positions) and shuffle with seed
    const payloadPositions = usablePositions.slice(headerPositionsNeeded);
    seededShuffle(payloadPositions, seed);

    // Extract payload by reading repeatCount positions per bit and taking majority
    let payloadBinary = '';
    let posPointer = 0;
    for (let i = 0; i < payloadBits; i++) {
      let votes0 = 0, votes1 = 0;
      for (let r = 0; r < repeatCount; r++) {
        const p = payloadPositions[posPointer++];
        if (p === undefined) {
          return { success: false, error: "Payload truncated / out of bounds" };
        }
        const bit = data[p] & 1;
        if (bit) votes1++; else votes0++;
      }
      payloadBinary += (votes1 > votes0 ? '1' : '0');
    }

    // Convert binary to string and extract CRC (last 4 chars)
    const recovered = binaryToString(payloadBinary);
    if (recovered.length < 4) return { success: false, error: "Recovered data too short" };
    const payloadText = recovered.slice(0, -4);
    const crcBytes = recovered.slice(-4);
    const receivedCrc = bytesToUint32(crcBytes);
    const calcCrc = crc32(payloadText);
    if (receivedCrc !== calcCrc) {
      return { success: false, error: "CRC mismatch; data corrupted" };
    }

    return { success: true, text: payloadText, meta: { seed, repeatCount } };
  } catch (err) {
    return { success: false, error: "Extraction failed: " + err.message };
  }
}

// ---------- Buffer helpers (load/save) ----------
async function extractTextFromBuffer(imageBuffer) {
  try {
    const img = await loadImage(imageBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return extractTextFromImage(imageData);
  } catch (error) {
    return { success: false, error: "Failed to load image: " + error.message };
  }
}

// ---------- Compression / Draw-then-embed workflow ----------
function mapCompressionSliderToJpegQuality(sliderVal) {
  const s = Math.max(0, Math.min(9, sliderVal));
  return Math.max(0.35, 1 - (s / 10) * 0.6);
}

async function compressBuffer(imageBuffer, opts = {}) {
  const type = opts.type || 'none';
  if (type === 'none') return imageBuffer;

  const img = await loadImage(imageBuffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  if (type === 'jpeg') {
    const quality = typeof opts.quality === 'number' ? Math.max(0.0, Math.min(1.0, opts.quality)) : 0.9;
    return canvas.toBuffer('image/jpeg', { quality });
  } else if (type === 'png') {
    const level = Number.isInteger(opts.pngCompressionLevel) ? opts.pngCompressionLevel : 6;
    return canvas.toBuffer('image/png', { compressionLevel: Math.max(0, Math.min(9, level)) });
  } else {
    throw new Error('Unsupported compression type: ' + type);
  }
}

function drawVisibleTextAndReturnRect(ctx, canvas, text, opts = {}) {
  if (!text || text.length === 0) return null;
  const fontSize = opts.fontSize || 24;
  const fontFamily = opts.fontFamily || 'Arial';
  ctx.font = `${opts.fontWeight || 'bold'} ${fontSize}px ${fontFamily}`;
  const padding = (typeof opts.padding === 'number') ? opts.padding : Math.round(fontSize * 0.6);
  const maxWidth = Math.max(50, canvas.width - padding * 2);
  const words = text.split(' ');
  const lines = [];
  let current = words[0] || '';
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const test = current + ' ' + w;
    if (ctx.measureText(test).width < maxWidth) current = test;
    else { lines.push(current); current = w; }
  }
  lines.push(current);
  const lineHeight = fontSize * 1.2;
  const blockH = lines.length * lineHeight + padding;
  const blockW = Math.min(maxWidth, Math.max(...lines.map(l => ctx.measureText(l).width)) + padding);

  let y;
  if (opts.position === 'top') y = padding;
  else if (opts.position === 'bottom') y = canvas.height - blockH - padding;
  else y = Math.round((canvas.height - blockH) / 2);

  const x = Math.round((canvas.width - blockW) / 2);

  if (opts.bgColor) {
    ctx.fillStyle = opts.bgColor;
    const radius = opts.rounded ? Math.min(20, Math.round(fontSize / 2)) : 0;
    if (radius > 0) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + blockW - radius, y);
      ctx.quadraticCurveTo(x + blockW, y, x + blockW, y + radius);
      ctx.lineTo(x + blockW, y + blockH - radius);
      ctx.quadraticCurveTo(x + blockW, y + blockH, x + blockW - radius, y + blockH);
      ctx.lineTo(x + radius, y + blockH);
      ctx.quadraticCurveTo(x, y + blockH, x, y + blockH - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(x, y, blockW, blockH);
    }
  }

  ctx.fillStyle = opts.color || '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let textX = x + Math.round(padding / 2);
  let textY = y + Math.round(padding / 4);
  for (const line of lines) {
    ctx.fillText(line, textX, textY);
    textY += lineHeight;
  }

  return { x, y, w: blockW, h: blockH };
}

async function embedTextInBufferWithCompression(imageBuffer, hiddenText, opts = {}) {
  try {
    const compression = opts.compression || { type: 'none' };
    const compressBeforeEmbed = (typeof opts.compressBeforeEmbed === 'boolean') ? opts.compressBeforeEmbed : (compression.type && compression.type !== 'none');
    let workingBuffer = imageBuffer;

    if (compressBeforeEmbed) {
      workingBuffer = await compressBuffer(imageBuffer, compression);
    }
    const img = await loadImage(workingBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    let visibleRect = null;
    if (opts.drawVisibleText && opts.drawVisibleText.enabled) {
      visibleRect = drawVisibleTextAndReturnRect(ctx, canvas, opts.drawVisibleText.text || '', opts.drawVisibleText);
    }

    // NOTE: For deterministic embedding/extraction we do NOT pass excludeRects to embedTextInImage
    // (payload/header positions are chosen from ALL non-alpha bytes in raster order).
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const embedResult = embedTextInImage(imageData, hiddenText, {
      repeatCount: opts.embed && opts.embed.repeatCount,
      seed: opts.embed && opts.embed.seed,
      passphrase: opts.embed && opts.embed.passphrase
      // excludeRects intentionally not used here to keep ordering deterministic
    });

    if (!embedResult || embedResult.success === false) {
      return { success: false, error: (embedResult && embedResult.error) ? embedResult.error : 'Embedding failed (unknown)' };
    }

    ctx.putImageData(embedResult.imageData, 0, 0);

    const output = opts.output || {};
    const outType = output.type || 'png';
    if (outType === 'png') {
      const level = (typeof output.pngCompressionLevel === 'number') ? output.pngCompressionLevel : (compression.pngCompressionLevel || 6);
      const buffer = canvas.toBuffer('image/png', { compressionLevel: Math.max(0, Math.min(9, level)) });
      return { success: true, buffer, meta: embedResult.meta, visibleRect };
    } else if (outType === 'jpeg') {
      const quality = (typeof output.jpegQuality === 'number') ? output.jpegQuality : (compression.jpegQuality || 0.9);
      const buffer = canvas.toBuffer('image/jpeg', { quality: Math.max(0.01, Math.min(1, quality)) });
      return { success: true, buffer, meta: embedResult.meta, visibleRect };
    } else {
      const buffer = canvas.toBuffer();
      return { success: true, buffer, meta: embedResult.meta, visibleRect };
    }
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ---------- Capacity estimator ----------
async function getCapacity(imageBuffer, repeatCount = 5, /*excludeRects ignored for estimation*/ ) {
  try {
    const img = await loadImage(imageBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const usable = [];
    for (let byteIndex = 0; byteIndex < data.length; byteIndex++) {
      if ((byteIndex % 4) === 3) continue;
      usable.push(byteIndex);
    }
    const headerBits = (8 * 8) + 32 + 32 + 8;
    const headerRepeat = 8;
    const headerNeeded = headerBits * headerRepeat;
    const payloadBitsAvailable = (usable.length - headerNeeded);
    if (payloadBitsAvailable <= 0) return { success: true, chars: 0 };
    const availableBitsForPayload = Math.floor(payloadBitsAvailable / repeatCount);
    const availableBytes = Math.floor(availableBitsForPayload / 8);
    return { success: true, chars: availableBytes };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ---------- Exports ----------
module.exports = {
  embedTextInImage,
  extractTextFromImage,
  extractTextFromBuffer,
  embedTextInBufferWithCompression,
  compressBuffer,
  drawVisibleTextAndReturnRect,
  deriveSeedFromPassphrase,
  getCapacity,
  mapCompressionSliderToJpegQuality
};
