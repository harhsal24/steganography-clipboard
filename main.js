const { app, BrowserWindow, globalShortcut, Tray, Menu, clipboard, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const { embedTextInImage, extractTextFromBuffer } = require('./steganography');

let tray = null;
let mainWindow = null;
// --- Default Settings Object with New Options ---
const defaultSettings = {
  imageSize: { width: 800, height: 450 },
  autoSize: false,
  aspectRatio: '1.777', // 16:9
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
  iconShapes: ['circle', 'square', 'triangle'],
  iconColors: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#F39C12', '#E74C3C'],
  compressionLevel: 6,
};

let settings = { ...defaultSettings };

// Load settings from file
function loadSettings() {
  try {
    const settingsPath = path.join(__dirname, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      settings = { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

/**
 * Checks if a hex color is perceived as dark.
 * @param {string} hex - The hex color code (e.g., "#RRGGBB").
 * @returns {boolean} True if the color is dark.
 */
function isColorDark(hex) {
  const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16));
  // Using the luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
  return luminance < 128;
}

/**
 * Generates a random background color and a text color with high contrast.
 * @returns {{bgColor: string, textColor: string}}
 */
function getRandomHighContrastColors() {
    const lightColors = ['#FFFFFF', '#F2F2F2', '#E6E6E6'];
    const darkColors = ['#000000', '#1A1A1A', '#2C2C2C'];
    
    // Generate a truly random background color
    const randomBg = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    
    // Pick text color from predefined palettes for guaranteed contrast
    const textColor = isColorDark(randomBg)
        ? lightColors[Math.floor(Math.random() * lightColors.length)]
        : darkColors[Math.floor(Math.random() * darkColors.length)];
        
    return { bgColor: randomBg, textColor: textColor };
}

// Save settings to file
function saveSettings() {
  try {
    const settingsPath = path.join(__dirname, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

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
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const pngIconPath = path.join(__dirname, 'assets', 'icon.png');
  
  const assetsDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  
  if (!fs.existsSync(iconPath) && !fs.existsSync(pngIconPath)) {
    const iconBuffer = createDefaultIcon();
    fs.writeFileSync(pngIconPath, iconBuffer);
    return pngIconPath;
  }
  
  return fs.existsSync(iconPath) ? iconPath : pngIconPath;
}

function createWindow() {
  const iconPath = getIconPath();
  
  mainWindow = new BrowserWindow({
    width: 500,
    height: 700,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: iconPath,
    autoHideMenuBar: true,
    resizable: true,
    minWidth: 400,
    minHeight: 600
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.on('close', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
  
  // Send settings to renderer when ready
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('settings-loaded', settings);
  });
}

function createTray() {
  try {
    const iconPath = getIconPath();
    tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '🖥️ Show Window',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        }
      },
      {
        type: 'separator'
      },
      {
        label: '📝 Embed Text (Ctrl+Shift+V)',
        click: processClipboard
      },
      {
        label: '🔍 Extract from Clipboard (Ctrl+Shift+E)',
        click: extractFromClipboard
      },
      {
        label: '📁 Extract from File',
        click: extractFromFile
      },
      {
        type: 'separator'
      },
      {
        label: '⚙️ Settings',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('show-settings');
        }
      },
      {
        label: '❌ Exit',
        click: () => {
          app.quit();
        }
      }
    ]);
    
    tray.setToolTip('Steganography Tool - Embed & Extract Hidden Text');
    tray.setContextMenu(contextMenu);
    
    tray.on('double-click', () => {
      mainWindow.show();
      mainWindow.focus();
    });
    
  } catch (error) {
    console.error('Failed to create system tray:', error);
  }
}

function drawCornerIcons(ctx, canvas) {
  if (!settings.cornerIcons) return;
  
  const iconSize = 40;
  const margin = 15;
  
  const positions = [
    { x: margin, y: margin }, // Top-left
    { x: canvas.width - margin - iconSize, y: margin }, // Top-right
    { x: margin, y: canvas.height - margin - iconSize }, // Bottom-left
    { x: canvas.width - margin - iconSize, y: canvas.height - margin - iconSize } // Bottom-right
  ];
  
  positions.forEach((pos, index) => {
    const shapeIndex = index % settings.iconShapes.length;
    const colorIndex = index % settings.iconColors.length;
    const shape = settings.iconShapes[shapeIndex];
    const color = settings.iconColors[colorIndex];
    
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    
    const centerX = pos.x + iconSize / 2;
    const centerY = pos.y + iconSize / 2;
    
    switch (shape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(centerX, centerY, iconSize / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'square':
        ctx.fillRect(pos.x, pos.y, iconSize, iconSize);
        ctx.strokeRect(pos.x, pos.y, iconSize, iconSize);
        break;
        
      case 'triangle':
        ctx.beginPath();
        ctx.moveTo(centerX, pos.y + 2);
        ctx.lineTo(pos.x + iconSize - 2, pos.y + iconSize - 2);
        ctx.lineTo(pos.x + 2, pos.y + iconSize - 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'diamond':
        ctx.beginPath();
        ctx.moveTo(centerX, pos.y + 2);
        ctx.lineTo(pos.x + iconSize - 2, centerY);
        ctx.lineTo(centerX, pos.y + iconSize - 2);
        ctx.lineTo(pos.x + 2, centerY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'star':
        drawStar(ctx, centerX, centerY, 5, iconSize / 2 - 2, iconSize / 4);
        ctx.fill();
        ctx.stroke();
        break;
    }
    
    ctx.restore();
  });
}

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

// Add this function after the other drawing functions
function getOptimalFontSize(text, maxWidth, canvasSize = { width: 600, height: 400 }) {
  const baseSize = settings.fontSize;
  const canvasArea = canvasSize.width * canvasSize.height;
  const scaleFactor = Math.sqrt(canvasArea / (600 * 400)); // Scale based on canvas size
  
  let optimalSize;
  
  // Dynamic sizing based on text length
  if (text.length < 20) {
    optimalSize = baseSize + 16; // Very short text = much bigger
  } else if (text.length < 50) {
    optimalSize = baseSize + 10; // Short text = bigger
  } else if (text.length < 100) {
    optimalSize = baseSize + 4;  // Medium text = slightly bigger
  } else if (text.length < 200) {
    optimalSize = baseSize;      // Long text = base size
  } else {
    optimalSize = baseSize - 4;  // Very long text = smaller
  }
  
  // Apply canvas scale factor
  optimalSize = Math.round(optimalSize * scaleFactor);
  
  // Ensure reasonable bounds
  return Math.max(14, Math.min(optimalSize, 48));
}

function drawTextOnImage(ctx, canvas, text) {
  if (!settings.showTextOnImage || !text) return;

  const fontSize = settings.dynamicFontSize ? getOptimalFontSize(text, maxWidth, { width: canvas.width, height: canvas.height }) : settings.fontSize;
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  
  const lines = wrapText(ctx, text, canvas.width - 100); // Helper to wrap text
  
  // FIXED: Overflow issue by calculating background size from actual text metrics.
  const longestLine = lines.reduce((a, b) => (ctx.measureText(a).width > ctx.measureText(b).width) ? a : b);
  const textMetrics = ctx.measureText(longestLine);
  const textBlockWidth = textMetrics.width;
  
  const lineHeight = fontSize * 1.2;
  const padding = fontSize; // Generous padding
  const backgroundWidth = textBlockWidth + (padding * 2);
  const backgroundHeight = (lines.length * lineHeight) + (padding * 2);

  let startY;
  switch (settings.textPosition) {
    case 'top':
      startY = 30;
      break;
    case 'center':
      startY = (canvas.height - backgroundHeight) / 2;
      break;
    case 'bottom':
    default:
      startY = canvas.height - backgroundHeight - 30;
      break;
  }
  
  // Draw background with rounded corners for better look
  if (settings.roundedBackground) {
    drawRoundedRect(ctx, 50, startY, canvas.width - 100, backgroundHeight, 12);
  } else {
    ctx.fillStyle = settings.textBackgroundColor;
    ctx.fillRect(50, startY, canvas.width - 100, backgroundHeight);
  }
  
  // NEW: Random color logic
  let textColor = settings.textColor;
  let textBgColor = settings.textBackgroundColor;

  if (settings.randomTextBgColor || settings.randomTextColor) {
      const { bgColor, textColor: highContrastColor } = getRandomHighContrastColors();
      if (settings.randomTextBgColor) {
          const opacity = settings.textBackgroundColor.split(',')[3] || '0.7)';
          const rgb = bgColor.match(/\w\w/g).map(x => parseInt(x, 16));
          textBgColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${opacity}`;
      }
      if (settings.randomTextColor) {
          textColor = highContrastColor;
      }
  }
  
  // Draw background with calculated size
  if (settings.roundedBackground) {
      drawRoundedRect(ctx, (canvas.width - backgroundWidth) / 2, startY, backgroundWidth, backgroundHeight, 15, textBgColor);
  } else {
      ctx.fillStyle = textBgColor;
      ctx.fillRect((canvas.width - backgroundWidth) / 2, startY, backgroundWidth, backgroundHeight);
  }

  // Draw text
  ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  lines.forEach((line, index) => {
    ctx.fillText(line, canvas.width / 2, startY + padding + (index * lineHeight) + (lineHeight / 2));
  });

  
  // Add text shadow if enabled
  if (settings.textShadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }
  
  displayLines.forEach((line, index) => {
    const y = startY + padding + (index * lineHeight) + (fontSize / 2); // ✅ FIXED: use fontSize instead of optimalFontSize
    ctx.fillText(line, canvas.width / 2, y);
  });
  
  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  
  // ✅ FIXED: use fontSize instead of optimalFontSize
  console.log(`Text: "${text.substring(0, 30)}..." | Length: ${text.length} | Font Size: ${fontSize}px | Dynamic: ${settings.dynamicFontSize}`);
}

// NEW: Helper for drawTextOnImage
function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

// Helper function for rounded rectangles
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.fillStyle = settings.textBackgroundColor;
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

function generateRandomBackground(canvas, ctx) {
  const patterns = ['gradient', 'noise', 'geometric', 'wave', 'circles', 'stripes'];
  const pattern = settings.backgroundPattern === 'random' ? 
    patterns[Math.floor(Math.random() * patterns.length)] : settings.backgroundPattern;
  
  const colors = [
    ['#FF6B6B', '#4ECDC4'], ['#A8E6CF', '#FFD93D'], ['#6C5CE7', '#A29BFE'],
    ['#FD79A8', '#FDCB6E'], ['#00CEC9', '#81ECEC'], ['#E17055', '#FDCB6E'],
    ['#00B894', '#00CEC9'], ['#6C5CE7', '#74B9FF'], ['#FD79A8', '#E84393']
  ];
  
  const colorSet = colors[Math.floor(Math.random() * colors.length)];
  
  switch (pattern) {
    case 'gradient':
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, colorSet[0]);
      gradient.addColorStop(1, colorSet[1]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      break;
      
    case 'noise':
      ctx.fillStyle = colorSet[0];
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 0.1;
      for (let i = 0; i < 2000; i++) {
        ctx.fillStyle = `hsl(${Math.random() * 360}, 70%, 60%)`;
        ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 
                    Math.random() * 3 + 1, Math.random() * 3 + 1);
      }
      ctx.globalAlpha = 1;
      break;
      
    case 'geometric':
      ctx.fillStyle = colorSet[0];
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = colorSet[1];
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 30; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const size = Math.random() * 80 + 20;
        const shape = Math.random();
        
        if (shape < 0.33) {
          ctx.fillRect(x - size/2, y - size/2, size, size);
        } else if (shape < 0.66) {
          ctx.beginPath();
          ctx.arc(x, y, size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(x, y - size/2);
          ctx.lineTo(x + size/2, y + size/2);
          ctx.lineTo(x - size/2, y + size/2);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      break;
      
    case 'wave':
      const waveGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      waveGradient.addColorStop(0, colorSet[0]);
      waveGradient.addColorStop(1, colorSet[1]);
      ctx.fillStyle = waveGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2 + i * 15);
        for (let x = 0; x < canvas.width; x += 2) {
          const y = canvas.height / 2 + 
                   Math.sin(x * 0.02 + i * 0.8) * 40 + 
                   Math.sin(x * 0.01 + i * 1.2) * 20 + 
                   i * 15;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
      
    case 'circles':
      const circleGradient = ctx.createRadialGradient(
        canvas.width/2, canvas.height/2, 0,
        canvas.width/2, canvas.height/2, Math.max(canvas.width, canvas.height)/2
      );
      circleGradient.addColorStop(0, colorSet[0]);
      circleGradient.addColorStop(1, colorSet[1]);
      ctx.fillStyle = circleGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.globalAlpha = 0.2;
      for (let i = 0; i < 20; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, 
               Math.random() * 100 + 20, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${Math.random() * 360}, 70%, 60%)`;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
      
    case 'stripes':
      ctx.fillStyle = colorSet[0];
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = colorSet[1];
      const stripeWidth = 20;
      for (let x = 0; x < canvas.width; x += stripeWidth * 2) {
        ctx.fillRect(x, 0, stripeWidth, canvas.height);
      }
      break;
      
    default:
      // Default gradient
      const defaultGradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      defaultGradient.addColorStop(0, colorSet[0]);
      defaultGradient.addColorStop(1, colorSet[1]);
      ctx.fillStyle = defaultGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  
  // Add subtle texture
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#FFFFFF' : '#000000';
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
  }
  ctx.globalAlpha = 1;
}

async function processClipboard() {
  try {
    const text = clipboard.readText();
    
    if (!text || text.trim().length === 0) {
      showNotification('❌ No text found in clipboard', 'error');
      return;
    }
    
    if (text.length > 2000) {
      showNotification('❌ Text too long (max 2000 characters)', 'error');
      return;
    }

     let canvasWidth, canvasHeight;

    // NEW: Auto-size logic
    if (settings.autoSize) {
        const charCount = text.length;
        // Formula: Start with a base area, then add area per character.
        const baseArea = 800 * 450;
        const extraArea = charCount * 400; // Adjust this multiplier to control growth
        const totalArea = baseArea + extraArea;
        
        const aspectRatio = parseFloat(settings.aspectRatio);
        
        canvasHeight = Math.sqrt(totalArea / aspectRatio);
        canvasWidth = canvasHeight * aspectRatio;

        // Enforce min/max dimensions
        canvasWidth = Math.max(600, Math.min(canvasWidth, 1920));
        canvasHeight = Math.max(400, Math.min(canvasHeight, 1080));
    } else {
        canvasWidth = settings.imageSize.width;
        canvasHeight = settings.imageSize.height;
    }
    
    showNotification('🔄 Processing...', 'info');
    
    const canvas = createCanvas(settings.imageSize.width, settings.imageSize.height);
    const ctx = canvas.getContext('2d');
    
    // Generate background
    generateRandomBackground(canvas, ctx);
    
    // Draw corner icons
    drawCornerIcons(ctx, canvas);
    
    // Draw text on image
    drawTextOnImage(ctx, canvas, text);
    
    // Get image data for steganography
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Embed text using steganography
    const modifiedImageData = embedTextInImage(imageData, text);
    
    if (!modifiedImageData) {
      showNotification('❌ Failed to embed text - text too long for image size', 'error');
      return;
    }
    
    // Put modified image data back to canvas
    ctx.putImageData(modifiedImageData, 0, 0);
    
    // Convert to buffer and copy to clipboard
    const buffer = canvas.toBuffer('image/png', { compressionLevel: settings.compressionLevel });
    const image = nativeImage.createFromBuffer(buffer);
    
    clipboard.writeImage(image);
    
    const sizeKB = (buffer.length / 1024).toFixed(1);
    showNotification(`✅ Embedded ${text.length} chars (${sizeKB}KB)`, 'success');
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('text-processed', {
        originalText: text,
        imageSize: buffer.length,
        settings: settings
      });
    }
    
  } catch (error) {
    console.error('Error processing clipboard:', error);
    showNotification('❌ Error: ' + error.message, 'error');
  }
}

async function extractFromClipboard() {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      showNotification('❌ No image in clipboard', 'error');
      return;
    }
    
    showNotification('🔍 Extracting text...', 'info');
    
    const buffer = image.toPNG();
    const result = await extractTextFromBuffer(buffer);
    
    if (result.success) {
      clipboard.writeText(result.text);
      showNotification(`✅ Extracted ${result.text.length} characters`, 'success');
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-extracted', {
          extractedText: result.text,
          success: true,
          source: 'clipboard'
        });
      }
    } else {
      showNotification(`❌ ${result.error}`, 'error');
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-extracted', {
          error: result.error,
          success: false,
          source: 'clipboard'
        });
      }
    }
    
  } catch (error) {
    console.error('Error extracting from clipboard:', error);
    showNotification('❌ Extraction failed: ' + error.message, 'error');
  }
}

async function extractFromFile() {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select image to extract text from',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif'] }
      ],
      properties: ['openFile']
    });
    
    if (result.canceled || !result.filePaths[0]) {
      return null; // Return null instead of undefined for better handling
    }
    
    const filePath = result.filePaths[0];
    showNotification('🔍 Extracting from file...', 'info');
    
    const imageBuffer = fs.readFileSync(filePath);
    const extractResult = await extractTextFromBuffer(imageBuffer);
    
    if (extractResult.success) {
      clipboard.writeText(extractResult.text);
      showNotification(`✅ Extracted ${extractResult.text.length} characters from ${path.basename(filePath)}`, 'success');
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-extracted', {
          extractedText: extractResult.text,
          success: true,
          source: 'file',
          fileName: path.basename(filePath)
        });
      }
      
      return extractResult;
    } else {
      showNotification(`❌ ${extractResult.error}`, 'error');
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-extracted', {
          error: extractResult.error,
          success: false,
          source: 'file',
          fileName: path.basename(filePath)
        });
      }
      
      return extractResult;
    }
    
  } catch (error) {
    console.error('Error extracting from file:', error);
    const errorResult = { success: false, error: 'File extraction failed: ' + error.message };
    showNotification(`❌ ${errorResult.error}`, 'error');
    return errorResult;
  }
}

function showNotification(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notification', { message, type });
  }
  
  if (tray) {
    tray.displayBalloon({
      title: 'Steganography Tool',
      content: message.replace(/❌|✅|🔍|🔄|⚠️/g, '') // Remove emojis for system notifications
    });
  }
}

// IPC Handlers - Define once only
ipcMain.handle('update-settings', (event, newSettings) => {
    // If null, reset to defaults. Otherwise, merge with current settings.
    settings = newSettings === null ? { ...defaultSettings } : { ...settings, ...newSettings };
    saveSettings();
    return settings;
});

ipcMain.handle('get-settings', async () => {
  return settings;
});

ipcMain.handle('extract-from-file', async () => {
  return await extractFromFile();
});

ipcMain.handle('process-clipboard', async () => {
  return await processClipboard();
});

ipcMain.handle('extract-clipboard', async () => {
  return await extractFromClipboard();
});

// Add this with your other IPC handlers
ipcMain.handle('extract-from-clipboard', async () => {
  try {
    console.log('IPC: extract-from-clipboard called');
    
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return { success: false, error: 'No image found in clipboard' };
    }
    
    const buffer = image.toPNG();
    const result = await extractTextFromBuffer(buffer);
    
    if (result.success) {
      // Copy extracted text to clipboard
      clipboard.writeText(result.text);
      
      // Send to main window for UI update
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-extracted', {
          extractedText: result.text,
          success: true,
          source: 'clipboard'
        });
      }
      
      return {
        success: true,
        extractedText: result.text
      };
    } else {
      return {
        success: false,
        error: result.error
      };
    }
  } catch (error) {
    console.error('Error in extract-from-clipboard IPC:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('get-clipboard-image', async () => {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return { success: false, error: 'No image in clipboard' };
    }
    
    const buffer = image.toPNG();
    return {
      success: true,
      imageData: Array.from(buffer) // Convert buffer to array for transfer
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('extract-from-buffer', async (event, bufferArray) => {
  try {
    const buffer = Buffer.from(bufferArray);
    const result = await extractTextFromBuffer(buffer);
    
    if (result.success) {
      // Copy extracted text to clipboard
      clipboard.writeText(result.text);
      
      return {
        success: true,
        text: result.text
      };
    } else {
      return {
        success: false,
        error: result.error
      };
    }
  } catch (error) {
    console.error('Error in extract-from-buffer IPC:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// App Event Handlers
app.whenReady().then(() => {
  loadSettings();
  createWindow();
  createTray();
  
  // Register global shortcuts
  const embedRet = globalShortcut.register('CommandOrControl+Shift+V', processClipboard);
  const extractRet = globalShortcut.register('CommandOrControl+Shift+E', extractFromClipboard);
  
  if (embedRet && extractRet) {
    showNotification('🚀 Ready! Ctrl+Shift+V: Embed | Ctrl+Shift+E: Extract', 'success');
  } else {
    showNotification('⚠️ Some shortcuts failed to register', 'error');
  }
  
  console.log('✅ Application initialized successfully');
});

app.on('window-all-closed', (event) => {
  event.preventDefault(); // Prevent app from quitting
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

// Ensure single instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  showNotification('❌ Unexpected error occurred', 'error');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  showNotification('❌ Unexpected error occurred', 'error');
});