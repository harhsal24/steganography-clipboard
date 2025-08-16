#!/usr/bin/env node
/**
 * decoder.js
 *
 * Standalone steganography decoder for this project.
 * Usage:
 *   node decoder.js <image-path>
 *   cat image.png | node decoder.js -    # read image from stdin when path is "-"
 *
 * This version loads the project's steg module (steg-robust.js) and calls
 * its extractTextFromBuffer() function. It prints the recovered text to stdout
 * on success, and a descriptive error to stderr on failure (non-zero exit).
 */

'use strict';

const fs = require('fs');
const path = require('path');

async function loadStegModule() {
  // Try to require the robust steg module name used by main.js
  const candidates = ['./steg-robust', './steganography', './steg'];
  for (const c of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(c);
      // prefer a module that exposes extractTextFromBuffer
      if (mod && typeof mod.extractTextFromBuffer === 'function') return mod;
    } catch (e) {
      // ignore and try next
    }
  }
  throw new Error('Could not find a steg module exporting extractTextFromBuffer. Make sure steg-robust.js (or steganography.js) is present.');
}

async function readStdinAsBuffer() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

async function decodeFromPathOrStdin(filePath) {
  const steg = await loadStegModule();

  let buffer;
  if (filePath === '-' || filePath === undefined) {
    // Read from stdin
    if (process.stdin.isTTY) {
      throw new Error('Reading from stdin requested but stdin is a TTY. Use: cat image.png | node decoder.js -');
    }
    buffer = await readStdinAsBuffer();
  } else {
    const absolute = path.resolve(filePath);
    if (!fs.existsSync(absolute)) {
      throw new Error(`File not found: ${absolute}`);
    }
    buffer = fs.readFileSync(absolute);
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('Input buffer is empty.');
  }

  // Delegate to module
  const result = await steg.extractTextFromBuffer(buffer);
  return result;
}

// CLI entry
if (require.main === module) {
  (async () => {
    try {
      const arg = process.argv[2];

      if (!arg) {
        console.error('Usage: node decoder.js <image-path>');
        console.error('   or: cat image.png | node decoder.js -   (use "-" to read stdin)');
        process.exitCode = 2;
        return;
      }

      const res = await decodeFromPathOrStdin(arg);

      if (res && res.success) {
        // Print only the extracted text to stdout (so it can be piped)
        process.stdout.write(res.text + '\n');
        process.exitCode = 0;
      } else {
        const errMsg = (res && res.error) ? res.error : 'Unknown extraction failure';
        console.error('Extraction failed:', errMsg);
        process.exitCode = 3;
      }
    } catch (err) {
      console.error('Critical error:', err.message || err);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  decodeFromPathOrStdin,
};
