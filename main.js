// main.js (updated)
// Electron + Steg integration (uses steg-robust.js)
const { app, BrowserWindow, globalShortcut, Tray, Menu, clipboard, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
// require the full steg module (steg-robust.js)
const steg = require('./steg-robust');
const { spawn } = require('child_process');

// ========== Defaults & Settings ==========
const defaultSettings = {
  imageSize: { width: 800, height: 450 },
  autoSize: true,
  aspectRatio: '1.777',
  backgroundPattern: 'random',
  showTextOnImage: true,
  dynamicFontSize: true,
  textPosition: 'center',
  textColor: '#FFFFFF',
  randomTextColor: false,
  textBackgroundColor: 'rgba(0,0,0,0.7)',
  randomTextBgColor: false,
  textShadow: true,
  roundedBackground: true,
  fontSize: 24,
  cornerIcons: true,
  randomizeIconPositions: false,
  iconShapes: ['circle', 'square', 'triangle', 'diamond', 'star'],
  iconColors: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#F39C12', '#E74C3C'],
  compressionLevel: 6,
};

let settings = { ...defaultSettings };
let mainWindow = null;
let tray = null;

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      settings = { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

// ========== Helpers for Icon & UI ==========
function createDefaultIcon() {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 64, 64);
  gradient.addColorStop(0, '#4A90E2');
  gradient.addColorStop(1, '#7B68EE');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(20, 30, 24, 20);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.strokeRect(25, 25, 14, 10);
  ctx.fillRect(30, 35, 4, 8);
  return canvas.toBuffer('image/png');
}

function getIconPath() {
  const assetsDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  const ico = path.join(assetsDir, 'icon.ico');
  const png = path.join(assetsDir, 'icon.png');
  if (fs.existsSync(ico)) return ico;
  if (!fs.existsSync(png)) fs.writeFileSync(png, createDefaultIcon());
  return png;
}

// ========== Window & Tray ==========
function createWindow() {
  const icon = getIconPath();
  mainWindow = new BrowserWindow({
    width: 500,
    height: 700,
    show: false,
    icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    resizable: true,
    minWidth: 400,
    minHeight: 600
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (e) => {
    // minimize to tray behaviour
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('settings-loaded', settings);
  });
}

function createTray() {
  try {
    tray = new Tray(getIconPath());
    const menu = Menu.buildFromTemplate([
      { label: 'Show Window', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      { label: 'Embed Clipboard (Ctrl+Shift+V)', click: processClipboard },
      { label: 'Extract from Clipboard (Ctrl+Shift+E)', click: extractFromClipboard },
      { label: 'Extract from File', click: extractFromFile },
      { type: 'separator' },
      { label: 'Settings', click: () => { mainWindow.show(); mainWindow.webContents.send('show-settings'); } },
      { label: 'Exit', click: () => app.quit() }
    ]);
    tray.setToolTip('Steganography Clipboard');
    tray.setContextMenu(menu);
    tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
  } catch (err) {
    console.error('Failed to create tray:', err);
  }
}

function showNotification(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notification', { message, type });
  if (tray && tray.displayBalloon) {
    // windows only
    tray.displayBalloon({ title: 'Steganography Tool', content: message.replace(/✅|❌|🔍|🔄/g, '') });
  }
}

// ========== Drawing Helpers (copied from your earlier main.js) ==========
function drawStar(ctx, centerX, centerY, spikes, outerRadius, innerRadius) {
  let rotation = Math.PI / 2 * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - outerRadius);
  for (let i = 0; i < spikes; i++) {
    const x = centerX + Math.cos(rotation) * outerRadius;
    const y = centerY + Math.sin(rotation) * outerRadius;
    ctx.lineTo(x, y);
    rotation += step;
    const x2 = centerX + Math.cos(rotation) * innerRadius;
    const y2 = centerY + Math.sin(rotation) * innerRadius;
    ctx.lineTo(x2, y2);
    rotation += step;
  }
  ctx.lineTo(centerX, centerY - outerRadius);
  ctx.closePath();
}

function drawCornerIcons(ctx, canvas) {
  if (!settings.cornerIcons) return;
  const iconSize = 40;
  const margin = 15;
  const positions = [
    { x: margin, y: margin },
    { x: canvas.width - margin - iconSize, y: margin },
    { x: margin, y: canvas.height - margin - iconSize },
    { x: canvas.width - margin - iconSize, y: canvas.height - margin - iconSize }
  ];
  positions.forEach((pos, index) => {
    const shape = settings.iconShapes[index % settings.iconShapes.length];
    const color = settings.iconColors[index % settings.iconColors.length];
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    const centerX = pos.x + iconSize / 2;
    const centerY = pos.y + iconSize / 2;
    switch (shape) {
      case 'circle':
        ctx.beginPath(); ctx.arc(centerX, centerY, iconSize / 2 - 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
      case 'square':
        ctx.fillRect(pos.x, pos.y, iconSize, iconSize); ctx.strokeRect(pos.x, pos.y, iconSize, iconSize); break;
      case 'triangle':
        ctx.beginPath(); ctx.moveTo(centerX, pos.y + 2); ctx.lineTo(pos.x + iconSize - 2, pos.y + iconSize - 2); ctx.lineTo(pos.x + 2, pos.y + iconSize - 2); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'diamond':
        ctx.beginPath(); ctx.moveTo(centerX, pos.y + 2); ctx.lineTo(pos.x + iconSize - 2, centerY); ctx.lineTo(centerX, pos.y + iconSize - 2); ctx.lineTo(pos.x + 2, centerY); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 'star':
        drawStar(ctx, centerX, centerY, 5, iconSize / 2 - 2, iconSize / 4); ctx.fill(); ctx.stroke(); break;
    }
    ctx.restore();
  });
}

function getOptimalFontSize(text, canvasWidth) {
  if (!settings.dynamicFontSize) return settings.fontSize;
  const baseSize = settings.fontSize || 24;
  let size = baseSize;
  const textLength = (text || '').length;
  if (textLength < 50) size += 8;
  else if (textLength < 150) size += 4;
  else if (textLength > 400) size -= 4;
  const widthScaleFactor = Math.sqrt(canvasWidth / 800);
  const clampedScaleFactor = Math.min(1.5, widthScaleFactor);
  size *= clampedScaleFactor;
  return Math.round(Math.max(14, Math.min(size, 72)));
}

function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0] || '';
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + " " + word).width;
    if (width < maxWidth) currentLine += " " + word;
    else { lines.push(currentLine); currentLine = word; }
  }
  lines.push(currentLine);
  return lines;
}

function drawRoundedRect(ctx, x, y, width, height, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function drawTextOnCanvas(ctx, canvas, text) {
  if (!settings.showTextOnImage || !text) return null;
  const fontSize = getOptimalFontSize(text, canvas.width);
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  const lines = wrapText(ctx, text, canvas.width - (fontSize * 2.5));
  if (!lines.length) return null;
  const longestLine = lines.reduce((a, b) => (ctx.measureText(a).width > ctx.measureText(b).width ? a : b));
  const textBlockWidth = ctx.measureText(longestLine).width;
  const lineHeight = fontSize * 1.2;
  const padding = fontSize;
  const backgroundWidth = textBlockWidth + (padding * 2);
  const backgroundHeight = (lines.length * lineHeight) + padding;
  let startY;
  switch (settings.textPosition) {
    case 'top': startY = 50; break;
    case 'bottom': startY = canvas.height - backgroundHeight - 50; break;
    default: startY = (canvas.height - backgroundHeight) / 2; break;
  }
  let textColor = settings.textColor;
  let textBgColor = settings.textBackgroundColor;
  // keep it simple here; randomization handled elsewhere if needed
  const startX = (canvas.width - backgroundWidth) / 2;
  if (settings.roundedBackground) drawRoundedRect(ctx, startX, startY, backgroundWidth, backgroundHeight, 15, textBgColor);
  else { ctx.fillStyle = textBgColor; ctx.fillRect(startX, startY, backgroundWidth, backgroundHeight); }
  if (settings.textShadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
  }
  ctx.fillStyle = textColor; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((line, idx) => {
    const yPos = startY + (padding / 2) + (idx * lineHeight) + (lineHeight / 2);
    ctx.fillText(line, canvas.width / 2, yPos);
  });
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  return {
    x: startX,
    y: startY,
    w: backgroundWidth,
    h: backgroundHeight
  };
}

// generateRandomBackground same as your implementation (kept minimal)
function generateRandomBackground(canvas, ctx) {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#FF6B6B');
  gradient.addColorStop(1, '#4ECDC4');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ========== MAIN: processClipboard (embed) ==========
// (Place this function into your existing main.js, replacing the old processClipboard)
async function processClipboard() {
  try {
    const text = clipboard.readText();
    if (!text || text.trim().length === 0) {
      showNotification('❌ No text in clipboard', 'error');
      return;
    }

    // compute canvas size
    let canvasWidth, canvasHeight;
    if (settings.autoSize) {
      const charCount = text.length;
      const baseArea = 800 * 450;
      const extraAreaPerChar = charCount < 300 ? 500 : 350;
      const totalArea = baseArea + (charCount * extraAreaPerChar);
      const aspectRatio = parseFloat(settings.aspectRatio) || 1.777;
      canvasHeight = Math.sqrt(totalArea / aspectRatio);
      canvasWidth = canvasHeight * aspectRatio;
      canvasWidth = Math.round(Math.max(600, Math.min(canvasWidth, 1920)));
      canvasHeight = Math.round(Math.max(400, Math.min(canvasHeight, 1080)));
    } else {
      canvasWidth = settings.imageSize.width;
      canvasHeight = settings.imageSize.height;
    }

    showNotification('🔄 Processing (embedding)...', 'info');

    // 1. create base canvas (background + icons) but do NOT draw the visible text yet (we'll use steg workflow)
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    generateRandomBackground(canvas, ctx);
    drawCornerIcons(ctx, canvas);

    // Convert base canvas to buffer (PNG)
    const baseBuffer = canvas.toBuffer('image/png');

    // 2. map UI compression slider to jpeg quality for compress-first step
    const sliderVal = Number.isInteger(settings.compressionLevel) ? settings.compressionLevel : 6;
    const jpegQuality = typeof steg.mapCompressionSliderToJpegQuality === 'function'
      ? steg.mapCompressionSliderToJpegQuality(sliderVal)
      : Math.max(0.4, 1 - (sliderVal / 10) * 0.6);

    // Decide compression options (compress before embedding to simulate recompression)
    const compressionOpts = {
      type: 'jpeg',         // compress-first to JPEG to simulate lossy re-encode
      quality: jpegQuality,
      pngCompressionLevel: settings.compressionLevel
    };

    // visible text options (draw AFTER compression to avoid blur)
    const visibleTextOptions = {
      enabled: settings.showTextOnImage,
      text,
      fontSize: settings.fontSize || 24,
      color: settings.textColor || '#FFFFFF',
      bgColor: settings.textBackgroundColor || 'rgba(0,0,0,0.7)',
      position: settings.textPosition || 'center',
      rounded: settings.roundedBackground,
      padding: Math.round((settings.fontSize || 24) * 0.6),
      fontFamily: 'Arial',
      fontWeight: 'bold'
    };

    // We'll try several repeatCount values until the embedded image verifies.
    // Lower values give larger capacity but are less robust. Because clipboard/OS can re-encode,
    // we must try increasingly robust repeat counts.
    const attemptRepeatCounts = [5, 7, 9, 12, 16]; // progressive redundancy attempts
    let finalResult = null;
    let usedRepeat = null;

    // iterate attempts
    for (let attempt of attemptRepeatCounts) {
      showNotification(`🔁 Embedding attempt with repeatCount=${attempt}...`, 'info');

      const embedOpts = {
        compressBeforeEmbed: true,
        compression: {
          type: compressionOpts.type,
          quality: compressionOpts.quality,
          pngCompressionLevel: compressionOpts.pngCompressionLevel
        },
        drawVisibleText: visibleTextOptions,
        embed: { repeatCount: attempt, seed: null, passphrase: null },
        output: { type: 'png', pngCompressionLevel: settings.compressionLevel || 6 }
      };

      if (typeof steg.embedTextInBufferWithCompression !== 'function') {
        throw new Error('steg module missing embedTextInBufferWithCompression');
      }

      const attemptResult = await steg.embedTextInBufferWithCompression(baseBuffer, text, embedOpts);

      if (!attemptResult || !attemptResult.success) {
        console.error(`Embed failed for repeatCount=${attempt}:`, attemptResult && attemptResult.error);
        // try next attempt (maybe capacity issues or other)
        continue;
      }

      // verify by attempting to extract from the produced buffer immediately
      try {
        const verifyRes = await steg.extractTextFromBuffer(attemptResult.buffer);
        if (verifyRes && verifyRes.success && verifyRes.text === text) {
          // success: we can write to clipboard
          finalResult = attemptResult;
          usedRepeat = attempt;
          showNotification(`✅ Embed verified with repeatCount=${attempt}`, 'success');
          break;
        } else {
          // not matching: log details
          console.warn(`Verification failed at repeatCount=${attempt}:`, verifyRes && verifyRes.error ? verifyRes.error : `extracted length=${verifyRes && verifyRes.text ? verifyRes.text.length : 'nil'}`);
          // continue to try larger repeatCount
        }
      } catch (err) {
        console.error('Error verifying embedded buffer:', err);
      }
    }

    if (!finalResult) {
      showNotification('❌ Embedding could not be verified after multiple attempts — extraction may fail later.', 'error');
      console.error('Embedding verification failed for all repeatCounts:', attemptRepeatCounts);
      return;
    }

    // copy verified result to clipboard as image
    const outBuffer = finalResult.buffer;
    clipboard.writeImage(nativeImage.createFromBuffer(outBuffer));

    const sizeKB = (outBuffer.length / 1024).toFixed(1);
    showNotification(`✅ Embedded ${text.length} chars (${sizeKB}KB) — repeat=${usedRepeat}`, 'success');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('text-processed', {
        originalText: text,
        imageSize: outBuffer.length,
        meta: finalResult.meta || {},
        visibleRect: finalResult.visibleRect || null,
        usedRepeat
      });
    }

  } catch (err) {
    console.error('Error in processClipboard:', err);
    showNotification('❌ Error: ' + (err.message || String(err)), 'error');
  }
}


// ========== Extraction ==========
async function extractFromClipboard() {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      showNotification('❌ No image in clipboard', 'error');
      return { success: false, error: 'No image in clipboard' };
    }
    showNotification('🔍 Extracting...', 'info');

    // prefer PNG buffer for stable decode
    const buffer = image.toPNG();
    // delegate to steg module
    const res = await steg.extractTextFromBuffer(buffer);

    if (res && res.success) {
      clipboard.writeText(res.text);
      showNotification(`✅ Extracted ${res.text.length} characters`, 'success');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-extracted', {
          extractedText: res.text,
          success: true,
          source: 'clipboard'
        });
      }
      return { success: true, extractedText: res.text };
    } else {
      const errMsg = res && res.error ? res.error : 'Unknown extraction failure';
      showNotification('❌ ' + errMsg, 'error');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-extracted', { error: errMsg, success: false, source: 'clipboard' });
      }
      return { success: false, error: errMsg };
    }
  } catch (err) {
    console.error('Error in extractFromClipboard:', err);
    showNotification('❌ Extraction failed: ' + (err.message || String(err)), 'error');
    return { success: false, error: err.message || String(err) };
  }
}

async function extractFromFile() {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select image to extract text from',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    showNotification('🔍 Extracting from file...', 'info');
    const buffer = fs.readFileSync(filePath);
    const extracted = await steg.extractTextFromBuffer(buffer);
    if (extracted && extracted.success) {
      clipboard.writeText(extracted.text);
      showNotification(`✅ Extracted ${extracted.text.length} characters from ${path.basename(filePath)}`, 'success');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-extracted', {
          extractedText: extracted.text, success: true, source: 'file', fileName: path.basename(filePath)
        });
      }
      return extracted;
    } else {
      const errMsg = (extracted && extracted.error) ? extracted.error : 'Extraction failed';
      showNotification('❌ ' + errMsg, 'error');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-extracted', { error: errMsg, success: false, source: 'file', fileName: path.basename(filePath) });
      }
      return extracted;
    }
  } catch (err) {
    console.error('extractFromFile error:', err);
    showNotification('❌ File extraction failed: ' + (err.message || String(err)), 'error');
    return { success: false, error: err.message || String(err) };
  }
}

// Save clipboard image to disk
async function saveImageFromClipboard() {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      showNotification('❌ No image found on the clipboard.', 'error');
      return { success: false, message: 'No image on clipboard.' };
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Image As...',
      defaultPath: path.join(app.getPath('downloads'), 'clipboard-image.png'),
      filters: [{ name: 'PNG Image', extensions: ['png'] }, { name: 'JPEG', extensions: ['jpg', 'jpeg'] }]
    });
    if (result.canceled || !result.filePath) return { success: true, message: 'Save cancelled.' };
    const filePath = result.filePath;
    const buffer = filePath.toLowerCase().endsWith('.png') ? image.toPNG() : image.toJPEG(90);
    fs.writeFileSync(filePath, buffer);
    showNotification(`✅ Image saved successfully as ${path.basename(filePath)}`, 'success');
    return { success: true, message: `Saved as ${path.basename(filePath)}` };
  } catch (err) {
    console.error('Failed to save image from clipboard:', err);
    showNotification('❌ Failed to save image: ' + (err.message || String(err)), 'error');
    return { success: false, message: err.message || String(err) };
  }
}

// ========== IPC Handlers ==========
ipcMain.handle('update-settings', (event, newSettings) => {
  settings = newSettings === null ? { ...defaultSettings } : { ...settings, ...newSettings };
  saveSettings();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings-loaded', settings);
  return settings;
});
ipcMain.handle('get-settings', async () => settings);

// allow renderer to call process clipboard
ipcMain.handle('process-clipboard', async () => {
  await processClipboard();
  return { success: true };
});

// main.js — replace the existing handler for 'extract-from-clipboard' with this
ipcMain.handle("extract-from-clipboard", async () => {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return { success: false, error: "No image found in clipboard" };
    }

    const dataUrl = image.toDataURL(); // used for preview in renderer
    const buffer = image.toPNG();

    // call steg extractor and await result (correct function + shape)
    const res = await steg.extractTextFromBuffer(buffer);

    if (res && res.success) {
      return {
        success: true,
        extractedText: res.text,   // match renderer expectation
        error: null,
        image: dataUrl
      };
    } else {
      return {
        success: false,
        extractedText: null,
        error: (res && res.error) ? res.error : 'Extraction failed',
        image: dataUrl
      };
    }
  } catch (err) {
    return {
      success: false,
      extractedText: null,
      error: "Extraction failed: " + err.message,
      image: null
    };
  }
});



// return clipboard image as array of bytes (renderer creates Blob/File)
ipcMain.handle('get-clipboard-image', async () => {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) return { success: false, error: 'No image in clipboard' };
    const buffer = image.toPNG();
    // return plain array (IPC will serialize)
    return { success: true, imageData: Array.from(buffer), width: image.getSize().width, height: image.getSize().height };
  } catch (err) {
    console.error('get-clipboard-image error:', err);
    return { success: false, error: err.message || String(err) };
  }
});

// extract-from-buffer: bufferArray from renderer -> convert to Buffer and decode
ipcMain.handle('extract-from-buffer', async (event, bufferArray) => {
  try {
    const buffer = Buffer.from(bufferArray);
    const res = await steg.extractTextFromBuffer(buffer);
    if (res && res.success) {
      // convenience: copy to clipboard
      clipboard.writeText(res.text);
      return { success: true, text: res.text };
    } else {
      return { success: false, error: res && res.error ? res.error : 'Extraction failed' };
    }
  } catch (err) {
    console.error('extract-from-buffer IPC error:', err);
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('save-clipboard-image', async () => saveImageFromClipboard());
ipcMain.handle('extract-from-file', async () => extractFromFile());

// ========== CLI extraction helper (keeps backward compatibility) ==========
async function handleCliExtraction(imagePath) {
  return new Promise((resolve, reject) => {
    const decoder = spawn(process.execPath, [path.join(__dirname, 'decoder.js'), imagePath], {
      stdio: ['inherit', 'pipe', 'pipe']
    });
    let out = '', err = '';
    decoder.stdout.on('data', d => out += d.toString());
    decoder.stderr.on('data', d => err += d.toString());
    decoder.on('close', code => {
      if (code === 0) { console.log(out.trim()); resolve(); }
      else { console.error(err.trim()); reject(new Error(err || 'decoder failed')); }
    });
  });
}

// ========== App startup ==========
function startGuiApp() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    loadSettings();
    createWindow();
    createTray();

    // register global shortcuts
    const ok1 = globalShortcut.register('CommandOrControl+Shift+V', processClipboard);
    const ok2 = globalShortcut.register('CommandOrControl+Shift+E', extractFromClipboard);
    if (ok1 && ok2) showNotification('🚀 Ready! Ctrl+Shift+V: Embed | Ctrl+Shift+E: Extract', 'success');
    else showNotification('⚠️ Some global shortcuts failed to register.', 'error');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });

  app.on('window-all-closed', (e) => { e.preventDefault(); /* keep app running in tray */ });
}

const extractFlagIndex = process.argv.indexOf('--extract');
if (extractFlagIndex !== -1) {
  const imagePath = process.argv[extractFlagIndex + 1];
  if (!imagePath) { console.error('Usage: --extract /path/to/image'); process.exit(1); }
  app.whenReady().then(() => handleCliExtraction(imagePath));
} else {
  startGuiApp();
}

app.on('will-quit', () => globalShortcut.unregisterAll());

// Uncaught handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  try { dialog.showErrorBox('Unexpected Error', err.message || String(err)); } catch (e) { /* ignore */ }
  app.quit();
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  try { dialog.showErrorBox('Unhandled Rejection', String(reason)); } catch (e) { /* ignore */ }
});
