const { app, BrowserWindow, globalShortcut, Tray, Menu, clipboard, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');
const { embedTextInImage, extractTextFromBuffer } = require('./steganography');
const { spawn } = require('child_process');

// ===================================================================
// START: Command-Line Interface (CLI) Handler
// ===================================================================

/**
 * Handles the command-line extraction process.
 * This function runs in a "headless" mode without launching the GUI.
 * @param {string} imagePath The path to the image file.
 */
// async function handleCliExtraction(imagePath) {
//     if (!fs.existsSync(imagePath)) {
//         console.error(`Error: File not found at path: ${imagePath}`);
//         process.exit(1); // Exit with an error code
//     }

//     try {
//         const imageBuffer = fs.readFileSync(imagePath);
//         const result = await extractTextFromBuffer(imageBuffer);

//         if (result.success) {
//             console.log(result.text); // Print the decoded text to stdout
//             process.exit(0); // Success
//         } else {
//             console.error(`Extraction failed: ${result.error}`);
//             process.exit(1); // Error
//         }
//     } catch (error) {
//         console.error(`A critical error occurred: ${error.message}`);
//         process.exit(1); // Error
//     }
// }

// ===================================================================
// END : Command-Line Interface (CLI) Handler
// ===================================================================

async function handleCliExtraction(imagePath) {
    return new Promise((resolve, reject) => {
        const decoder = spawn('node', ['decoder.js', imagePath], {
            stdio: ['inherit', 'pipe', 'pipe']
        });
        
        let output = '';
        let error = '';
        
        decoder.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        decoder.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        decoder.on('close', (code) => {
            if (code === 0) {
                console.log(output.trim());
                resolve();
            } else {
                console.error(error.trim());
                reject(new Error(error));
            }
        });
    });
}

let tray = null;
let mainWindow = null;
// --- Default Settings Object with New Options ---
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

// --- Settings Management (Using Best Practices) ---
function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

// Load settings from file
function loadSettings() {
    try {
        const settingsPath = getSettingsPath();
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            settings = { ...defaultSettings, ...JSON.parse(data) };
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// --- Color & Contrast Helpers ---
function isColorDark(hex) {
    if (!hex) return true;
    const color = (hex.charAt(0) === '#') ? hex.substring(1, 7) : hex;
    const r = parseInt(color.substring(0, 2), 16);
    const g = parseInt(color.substring(2, 4), 16);
    const b = parseInt(color.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
    return luminance < 140;
}

function getRandomHighContrastColors() {
    const lightColors = ['#FFFFFF', '#F2F2F2', '#E6E6E6'];
    const darkColors = ['#0D0D0D', '#1A1A1A', '#2C2C2C'];
    const randomBg = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    const textColor = isColorDark(randomBg)
        ? lightColors[Math.floor(Math.random() * lightColors.length)]
        : darkColors[Math.floor(Math.random() * darkColors.length)];
    return { bgColor: randomBg, textColor: textColor };
}


// Save settings to file
function saveSettings() {
    try {
        const settingsPath = getSettingsPath();
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

/**
 * Calculates an optimal font size for the given text to fit nicely on the canvas.
 * It considers the user's base font size, the length of the text, and the canvas width.
 *
 * @param {string} text The text that will be rendered.
 * @param {number} canvasWidth The width of the canvas the text will be drawn on.
 * @returns {number} The calculated optimal font size in pixels.
 */
function getOptimalFontSize(text, canvasWidth) {
    // 1. If dynamic sizing is disabled in settings, just return the user's chosen size.
    if (!settings.dynamicFontSize) {
        return settings.fontSize;
    }

    const baseSize = settings.fontSize;
    const textLength = text.length;

    let size = baseSize;

    // 2. Adjust size based on the length of the text.
    // Shorter text gets a significant boost, while very long text is slightly reduced.
    if (textLength < 50) {
        size += 8; // Very short text, make it larger like a title.
    } else if (textLength < 150) {
        size += 4; // A short sentence, give it a small boost.
    } else if (textLength > 400) {
        size -= 4; // Long text, shrink it slightly to help it fit.
    }
    // For text between 150-400 characters, the base size is used.

    // 3. Scale the font size relative to the canvas width.
    // This prevents the font from looking tiny on a very large auto-sized canvas.
    // We use Math.sqrt for a gentler scaling effect.
    // A canvas width of 800px is our baseline (scale factor = 1).
    const widthScaleFactor = Math.sqrt(canvasWidth / 800);

    // We clamp the scaling factor to prevent ridiculously large fonts on huge images.
    // Max scale of 1.5 means the font can't get more than 50% bigger due to canvas size alone.
    const clampedScaleFactor = Math.min(1.5, widthScaleFactor);

    size *= clampedScaleFactor;

    // 4. Enforce absolute minimum and maximum font sizes and return a whole number.
    // This ensures readability (not too small) and prevents layout chaos (not too big).
    const minFontSize = 14;
    const maxFontSize = 72; // A generous max size is okay since the background resizes.

    return Math.round(Math.max(minFontSize, Math.min(size, maxFontSize)));
}

/**
 * Draws the text block (background and text) onto the canvas.
 * This function handles text wrapping, dynamic font sizing, and color randomization.
 *
 * @param {CanvasRenderingContext2D} ctx The 2D rendering context of the canvas.
 * @param {HTMLCanvasElement} canvas The canvas element to draw on.
 * @param {string} text The text to draw.
 */
function drawTextOnImage(ctx, canvas, text) {
    // 1. Exit if the feature is disabled or there's no text.
    if (!settings.showTextOnImage || !text) return;

    // 2. Determine the optimal font size based on settings.
    const fontSize = getOptimalFontSize(text, canvas.width);
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;

    // 3. Wrap the text into multiple lines that fit the canvas width.
    // We leave a generous padding based on the font size.
    const lines = wrapText(ctx, text, canvas.width - (fontSize * 2.5));
    if (lines.length === 0) return; // Exit if there's nothing to draw.

    // 4. Calculate the precise dimensions of the text block.
    const longestLine = lines.reduce((a, b) => (ctx.measureText(a).width > ctx.measureText(b).width) ? a : b);
    const textBlockWidth = ctx.measureText(longestLine).width;
    const lineHeight = fontSize * 1.2;
    const padding = fontSize; // Padding around the text.
    const backgroundWidth = textBlockWidth + (padding * 2);
    const backgroundHeight = (lines.length * lineHeight) + padding;

    // 5. Calculate the vertical position of the text block based on settings.
    let startY;
    switch (settings.textPosition) {
        case 'top':
            startY = 50;
            break;
        case 'bottom':
            startY = canvas.height - backgroundHeight - 50;
            break;
        default: // 'center'
            startY = (canvas.height - backgroundHeight) / 2;
            break;
    }

    // 6. Determine the final colors to use (user-defined or random with high contrast).
    let textColor = settings.textColor;
    let textBgColor = settings.textBackgroundColor;

    if (settings.randomTextBgColor || settings.randomTextColor) {
        const { bgColor, textColor: highContrastColor } = getRandomHighContrastColors();
        if (settings.randomTextBgColor) {
            const opacityMatch = textBgColor.match(/[\d.]+\)/); // Robustly get the opacity
            const opacity = opacityMatch ? opacityMatch[0] : '0.7)';
            const rgb = bgColor.match(/\w\w/g).map(x => parseInt(x, 16));
            textBgColor = `rgba(${rgb.join(',')},${opacity}`;
        }
        if (settings.randomTextColor) {
            textColor = highContrastColor;
        }
    }

    // 7. Draw the text background (only once).
    // It's centered horizontally using the calculated width.
    const startX = (canvas.width - backgroundWidth) / 2;
    if (settings.roundedBackground) {
        drawRoundedRect(ctx, startX, startY, backgroundWidth, backgroundHeight, 15, textBgColor);
    } else {
        ctx.fillStyle = textBgColor;
        ctx.fillRect(startX, startY, backgroundWidth, backgroundHeight);
    }

    // 8. Prepare text styles (shadow, color, alignment).
    if (settings.textShadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
    }
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 9. Draw the text line by line over the background.
    lines.forEach((line, index) => {
        const yPos = startY + (padding / 2) + (index * lineHeight) + (lineHeight / 2);
        ctx.fillText(line, canvas.width / 2, yPos);
    });

    // 10. Reset shadow so it doesn't affect other drawings (like icons).
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
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
function drawRoundedRect(ctx, x, y, width, height, radius, color) {
    ctx.fillStyle = color; // Use the provided color, not the global setting
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
            showNotification('❌ No text in clipboard', 'error');
            return;
        }

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

        showNotification('🔄 Processing...', 'info');
        
        // 1. Create the canvas with the correct dimensions
        const canvas = createCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext('2d');
        
        // 2. Draw all visual elements
        generateRandomBackground(canvas, ctx);
        drawCornerIcons(ctx, canvas);
        drawTextOnImage(ctx, canvas, text);
        
        // 3. Get image data and embed text
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const modifiedImageData = embedTextInImage(imageData, text);
        if (!modifiedImageData) {
            showNotification('❌ Text too long for this image size.', 'error');
            return;
        }

        // 4. Put modified data back and create buffer
        ctx.putImageData(modifiedImageData, 0, 0);
        const buffer = canvas.toBuffer('image/png', { compressionLevel: settings.compressionLevel });
        
        // 5. Copy to clipboard and notify user
        clipboard.writeImage(nativeImage.createFromBuffer(buffer));
        
        const sizeKB = (buffer.length / 1024).toFixed(1);
        showNotification(`✅ Embedded ${text.length} chars (${sizeKB}KB)`, 'success');
        
        if (mainWindow) {
            mainWindow.webContents.send('text-processed', {
                originalText: text,
                imageSize: buffer.length,
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

// ===================================================================
// START: Application Startup Logic
// ===================================================================

/**
 * This function contains all the logic for starting the app in GUI mode.
 * It will only be called if the app is NOT launched with a CLI flag.
 */
function startGuiApp() {
    // Enforce single instance lock for the GUI app.
    // If another instance is running, this instance will quit.
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return;
    }

    // This event fires in the primary instance when a second instance is launched.
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // We should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // All app setup happens inside the whenReady promise.
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
            showNotification('⚠️ Some global shortcuts failed to register.', 'error');
            console.error('Failed to register global shortcuts. They might be in use by another application.');
        }

        console.log('✅ GUI Application initialized successfully');
    });

    // Standard app event listeners for the GUI
    app.on('window-all-closed', (event) => {
        // On Windows & Linux, hiding on close is handled by the window's 'close' event.
        // This prevents the app from quitting.
        event.preventDefault();
    });

    app.on('activate', () => {
        // On macOS, re-create a window when the dock icon is clicked and there are no other windows.
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
            mainWindow.show();
        }
    });
}


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
            filters: [
                { name: 'PNG Image', extensions: ['png'] },
                { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
            ]
        });

        if (result.canceled || !result.filePath) {
            return { success: true, message: 'Save cancelled.' }; // Not an error, just an action
        }

        const filePath = result.filePath;
        const buffer = filePath.toLowerCase().endsWith('.png') ? image.toPNG() : image.toJPEG(90);

        fs.writeFileSync(filePath, buffer);
        
        const fileName = path.basename(filePath);
        showNotification(`✅ Image saved successfully as ${fileName}`, 'success');
        return { success: true, message: `Saved as ${fileName}` };

    } catch (error) {
        console.error('Failed to save image from clipboard:', error);
        showNotification('❌ Failed to save image: ' + error.message, 'error');
        return { success: false, message: error.message };
    }
}

// IPC Handlers - Define once only
ipcMain.handle('update-settings', (event, newSettings) => {
    settings = newSettings === null ? { ...defaultSettings } : { ...settings, ...newSettings };
    saveSettings();
    if (mainWindow) {
        mainWindow.webContents.send('settings-loaded', settings);
    }
    return settings;
});

ipcMain.handle('get-settings', async () => {
  return settings;
});

ipcMain.handle('process-clipboard', async () => {
  return await processClipboard();
});

// This is the primary handler for UI-triggered extractions from the clipboard.
ipcMain.handle('extract-from-clipboard', async () => {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return { success: false, error: 'No image found in clipboard' };
    }
    
    const buffer = image.toPNG();
    const result = await extractTextFromBuffer(buffer);
    
    if (result.success) {
      clipboard.writeText(result.text); // For convenience
      return { success: true, extractedText: result.text };
    } else {
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('Error in extract-from-clipboard IPC:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-clipboard-image', async () => {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return { success: false, error: 'No image in clipboard' };
    }
    const buffer = image.toPNG();
    return { success: true, imageData: Array.from(buffer) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('extract-from-buffer', async (event, bufferArray) => {
  try {
    const buffer = Buffer.from(bufferArray);
    const result = await extractTextFromBuffer(buffer);
    if (result.success) {
      clipboard.writeText(result.text); // For convenience
      return { success: true, text: result.text };
    } else {
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('Error in extract-from-buffer IPC:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-clipboard-image', async () => {
    return await saveImageFromClipboard();
});

// Note: We keep 'extract-from-file' because the UI might have a button that needs it,
// even though the tray menu calls the function directly.
ipcMain.handle('extract-from-file', async () => {
  return await extractFromFile();
});


// ===================================================================
// --- Main Application Entry Point ---
// ===================================================================

// This is the first piece of logic that runs.
// It checks command-line arguments to decide whether to run in CLI mode or GUI mode.
const extractFlagIndex = process.argv.indexOf('--extract');

if (extractFlagIndex !== -1) {
    // --- CLI Mode ---
    const imagePath = process.argv[extractFlagIndex + 1];
    if (!imagePath) {
        console.error('Usage: your-app-name --extract /path/to/image.png');
        process.exit(1);
    }
    // The app must be 'ready' before we can use native modules like canvas safely.
    app.whenReady().then(() => handleCliExtraction(imagePath));
} else {
    // --- GUI Mode ---
    startGuiApp();
}

app.on('will-quit', () => {
  // Unregister all shortcuts when the application is quitting.
  globalShortcut.unregisterAll();
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


process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  dialog.showErrorBox('Unexpected Error', 'A critical error occurred. Please check the logs.\n\n' + error.message);
  // It's often recommended to quit after an uncaught exception.
  app.quit();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  dialog.showErrorBox('Unhandled Promise Rejection', 'An unhandled promise rejection occurred. Please check the logs.\n\n' + reason);
});



