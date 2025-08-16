// renderer.js

// --- Global Variables ---
let statusDiv;
let lastProcessedDiv;
let processedInfoDiv;
let extractResultsDiv;
let currentSettings = {};
let extractedTextData = '';
let currentImageFile = null;
let currentImageData = null; // Stores info about the previewed image



// --- Global Error Handling ---
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
    showStatus('❌ Unexpected renderer error occurred', 'error');
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    showStatus('❌ Unexpected promise error occurred', 'error');
    e.preventDefault();
});

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeElements();
    setupEventListeners();
    loadSettingsToUI();
});

function initializeElements() {
    statusDiv = document.getElementById('status');
    lastProcessedDiv = document.getElementById('lastProcessed');
    processedInfoDiv = document.getElementById('processedInfo');
    extractResultsDiv = document.getElementById('extractResults');
    showStatus('🚀 Application ready! Use Ctrl+Shift+V or Ctrl+Shift+E.', 'success');
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Electron API listeners from main process
    window.electronAPI.onNotification((_event, data) => showStatus(data.message, data.type));
    window.electronAPI.onTextProcessed((_event, data) => displayProcessedResult(data));
    window.electronAPI.onTextExtracted((_event, data) => displayExtractionResult(data));
    window.electronAPI.onSettingsLoaded((_event, settings) => {
        currentSettings = settings;
        loadSettingsToUI();
    });
    window.electronAPI.onShowSettings((_event) => switchTab('settings'));


    // DOM event listeners
    setupImageUploadHandling();
    setupSettingsListeners();
    document.addEventListener('keydown', handleGlobalKeyDown);

    // Listeners for new interactive settings
    document.getElementById('autoSize').addEventListener('change', toggleAutoSizeControls);
    document.getElementById('randomTextColor').addEventListener('change', () => toggleRandomColorControl('textColor'));
    document.getElementById('randomTextBgColor').addEventListener('change', () => toggleRandomColorControl('textBgColor'));
}

function toggleAutoSizeControls() {
    const autoSizeChecked = document.getElementById('autoSize').checked;
    document.getElementById('manualSizeGroup').style.display = autoSizeChecked ? 'none' : 'block';
    document.getElementById('aspectRatioGroup').style.display = autoSizeChecked ? 'block' : 'none';
}

function toggleRandomColorControl(elementId) {
    const isRandom = document.getElementById(`random${capitalize(elementId)}`).checked;
    document.getElementById(elementId).disabled = isRandom;
}

function setupImageUploadHandling() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('click', (e) => {
        // Prevent opening file dialog when clicking on action buttons in the preview
        if (!e.target.closest('.preview-actions')) {
            fileInput.click();
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleImageFile(e.dataTransfer.files[0], 'drag-drop');
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImageFile(e.target.files[0], 'file-input');
        }
    });
}

// Global key handler for Ctrl+V paste on the Extract tab
async function handleGlobalKeyDown(e) {
    if (e.ctrlKey && e.key === 'v' && document.getElementById('extract-tab').classList.contains('active')) {
        e.preventDefault();
        await handlePasteImage();
    }
}

async function handlePasteImage() {
    try {
        showStatus('📋 Checking clipboard for image...', 'info');
        const result = await window.electronAPI.getClipboardImage();

        if (result.success) {
            const blob = new Blob([new Uint8Array(result.imageData)], { type: 'image/png' });
            const file = new File([blob], 'clipboard-image.png', { type: 'image/png' });
            handleImageFile(file, 'paste');
        } else {
            showStatus(result.error || '❌ No image found in clipboard', 'error');
        }
    } catch (error) {
        console.error('Error pasting image:', error);
        showStatus('❌ Failed to paste image', 'error');
    }
}

async function handleImageFile(file, source = 'unknown') {
    if (!file || !file.type.startsWith('image/')) {
        showStatus('❌ Please select a valid image file', 'error');
        return;
    }

    currentImageFile = file;
    showStatus(`📸 Loading ${file.name}...`, 'info');

    try {
        await showImagePreview(file, source);
        // Automatically start extraction if the image was pasted
        if (source === 'paste') {
            setTimeout(extractFromPreviewImage, 300);
        }
    } catch (error) {
        showStatus(`❌ Error loading image: ${error.message}`, 'error');
    }
}

function showImagePreview(file, source) {
    return new Promise((resolve, reject) => {
        const dropContent = document.getElementById('dropContent');
        const imagePreview = document.getElementById('imagePreview');
        const previewImg = document.getElementById('previewImg');
        const imageName = document.getElementById('imageName');
        const imageDetails = document.getElementById('imageDetails');

        dropContent.style.display = 'none';
        imagePreview.style.display = 'flex'; // Use flex for centering

        const objectUrl = URL.createObjectURL(file);
        previewImg.src = objectUrl;

        const sizeKB = (file.size / 1024).toFixed(1);
        const sourceLabel = {
            'file-input': '📁 From File',
            'drag-drop': '🔽 Dropped',
            'paste': '📋 Pasted'
        }[source] || '📷 Image';
        imageName.textContent = file.name;

        previewImg.onload = () => {
            const dimensions = `${previewImg.naturalWidth} × ${previewImg.naturalHeight}`;
            imageDetails.textContent = `${sourceLabel} • ${dimensions} • ${sizeKB} KB`;

            // Store info for later use
            currentImageData = { objectUrl, dimensions, source };
            resolve();
        };
        previewImg.onerror = reject;
    });
}

function clearImagePreview() {
    document.getElementById('dropContent').style.display = 'flex';
    document.getElementById('imagePreview').style.display = 'none';

    if (currentImageData && currentImageData.objectUrl) {
        URL.revokeObjectURL(currentImageData.objectUrl);
    }

    currentImageFile = null;
    currentImageData = null;
    document.getElementById('previewImg').src = '';
    document.getElementById('fileInput').value = ''; // Clear the file input
    document.getElementById('extractResults').style.display = 'none';
    extractedTextData = ''; 
    showStatus('🗑️ Image removed.', 'info');
}

async function extractFromPreviewImage() {
    if (!currentImageFile) {
        showStatus('❌ No image selected to process', 'error');
        return;
    }

    const dropZone = document.getElementById('dropZone');
    dropZone.classList.add('processing');
    showStatus(`🔍 Extracting from ${currentImageFile.name}...`, 'info');

    try {
        const arrayBuffer = await currentImageFile.arrayBuffer();
        // Buffers can't be sent over IPC directly, so we convert it to a plain array of numbers.
        const bufferArray = Array.from(new Uint8Array(arrayBuffer));
        const result = await window.electronAPI.extractFromBuffer(bufferArray);

        if (result.success) {
            dropZone.classList.replace('processing', 'success');
            displayExtractionResult({
                extractedText: result.text,
                success: true,
                source: 'file',
                fileName: currentImageFile.name,
                imageSize: currentImageFile.size,
                imageDimensions: currentImageData?.dimensions || 'N/A'
            });
        } else {
            dropZone.classList.replace('processing', 'error');
            showStatus(`❌ ${result.error}`, 'error');
        }
    } catch (error) {
        dropZone.classList.replace('processing', 'error');
        console.error('Error during preview extraction:', error);
        showStatus(`❌ Extraction failed: ${error.message}`, 'error');
    } finally {
        setTimeout(() => {
            dropZone.classList.remove('processing', 'success', 'error');
        }, 3000);
    }
}

async function extractFromClipboard() {
    const btn = document.getElementById('extractClipboardBtn');
    btn.disabled = true;
    btn.querySelector('span').textContent = '🔄 Extracting...';
    showStatus('🔍 Checking clipboard...', 'info');

    try {
        const result = await window.electronAPI.extractFromClipboard();

        if (result && result.success) {
            // ✅ Pass along extracted text + preview image
            displayExtractionResult({
                extractedText: result.extractedText,
                image: result.image || null,   // add image field
                success: true,
                source: 'clipboard'
            });
        } else {
            showStatus(`❌ ${result?.error || 'Extraction failed.'}`, 'error');
        }
    } catch (error) {
        console.error('Error calling extract from clipboard:', error);
        showStatus(`❌ Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.querySelector('span').textContent = '📋 Extract from Clipboard';
    }
}


// --- UI Display Functions ---

function displayProcessedResult(data) {
    lastProcessedDiv.style.display = 'block';
    const previewText = data.originalText.length > 200 ?
        data.originalText.substring(0, 200) + '...' : data.originalText;

    processedInfoDiv.innerHTML = `
        <div class="stats">
            <div class="stat-item"><div class="stat-value">${data.originalText.length}</div><div class="stat-label">Characters</div></div>
            <div class="stat-item"><div class="stat-value">${(data.imageSize / 1024).toFixed(1)}KB</div><div class="stat-label">Image Size</div></div>
        </div>
        <div class="text-preview">${previewText}</div>
        <div style="margin-top: 10px; color: #28a745; font-weight: bold; text-align: center;">✅ Embedded & Copied!</div>`;

    lastProcessedDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function displayExtractionResult({ extractedText, image, success, source }) {
    const extractResults = document.getElementById('extractResults');
    const extractedTextEl = document.getElementById('extractedText');
    const lengthEl = document.getElementById('extractedLength');
    const sourceEl = document.getElementById('extractedSource');

    // If an image preview is provided, show it in the existing preview area
    if (image) {
        const dropContent = document.getElementById('dropContent');
        const imagePreview = document.getElementById('imagePreview');
        const previewImg = document.getElementById('previewImg');
        if (previewImg) {
            previewImg.src = image;
            // show preview area and hide the drop content
            imagePreview.style.display = 'flex';
            if (dropContent) dropContent.style.display = 'none';
        }
    }

    if (success) {
        extractedTextData = extractedText || '';
        extractedTextEl.textContent = extractedTextData;
        lengthEl.textContent = extractedTextData.length || 0;
        sourceEl.textContent = source || '-';
        extractResults.style.display = 'block';
        showStatus(`✅ Extracted from ${source}`, 'success');
    } else {
        extractedTextData = '';
        extractedTextEl.textContent = '❌ Extraction failed.';
        lengthEl.textContent = 0;
        sourceEl.textContent = source || '-';
        extractResults.style.display = 'block';
        showStatus(`❌ ${ (typeof extractedText === 'string' && extractedText) || 'Extraction failed' }`, 'error');
    }
}



function showStatus(message, type = 'info') {
    const statusClass = type === 'success' ? 'success' : type === 'error' ? 'error' : 'info';
    statusDiv.innerHTML = `<div class="status ${statusClass}">${message}</div>`;
    // Auto-clear status after a delay
    setTimeout(() => { statusDiv.innerHTML = ''; }, 6000);
}

// --- Settings Management ---

function setupSettingsListeners() {
    const settingsForm = document.getElementById('settings-tab');
    settingsForm.addEventListener('input', updateRangeDisplays);

    document.querySelectorAll('.shape-option').forEach(option => {
        const checkbox = option.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', () => option.classList.toggle('selected', checkbox.checked));
    });
}

function updateRangeDisplays() {
    document.getElementById('fontSizeValue').textContent = document.getElementById('fontSize').value + 'px';
    document.getElementById('compressionValue').textContent = document.getElementById('compressionLevel').value;
    document.getElementById('textBgOpacityValue').textContent = document.getElementById('textBgOpacity').value + '%';
}


async function loadSettingsToUI() {
    try {
        const settings = await window.electronAPI.getSettings();
        currentSettings = settings;

        // Image Size
        document.getElementById('autoSize').checked = settings.autoSize;
        document.getElementById('imageWidth').value = settings.imageSize?.width || 800;
        document.getElementById('imageHeight').value = settings.imageSize?.height || 450;
        document.getElementById('aspectRatio').value = settings.aspectRatio || '1.777';
        toggleAutoSizeControls(); // Update UI based on loaded setting

        // Text Colors
        document.getElementById('randomTextColor').checked = settings.randomTextColor;
        document.getElementById('textColor').value = settings.textColor || '#FFFFFF';
        toggleRandomColorControl('textColor');

        document.getElementById('randomTextBgColor').checked = settings.randomTextBgColor;
        const bgColor = settings.textBackgroundColor || 'rgba(0,0,0,0.7)';
        const rgbaMatch = bgColor.match(/rgba?$(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?$/);
        if (rgbaMatch) {
            const [, r, g, b, a] = rgbaMatch;
            document.getElementById('textBgColor').value = `#${parseInt(r).toString(16).padStart(2, '0')}${parseInt(g).toString(16).padStart(2, '0')}${parseInt(b).toString(16).padStart(2, '0')}`;
            document.getElementById('textBgOpacity').value = Math.round(parseFloat(a || 1) * 100);
        }
        toggleRandomColorControl('textBgColor');

        // Icon Randomization
        document.getElementById('randomizeIconPositions').checked = settings.randomizeIconPositions;
        
        // Other Settings
        document.getElementById('backgroundPattern').value = settings.backgroundPattern || 'random';
        document.getElementById('showTextOnImage').checked = settings.showTextOnImage;
        document.getElementById('dynamicFontSize').checked = settings.dynamicFontSize;
        document.getElementById('textPosition').value = settings.textPosition || 'center';
        document.getElementById('fontSize').value = settings.fontSize || 24;
        document.getElementById('compressionLevel').value = settings.compressionLevel || 6;
        document.getElementById('cornerIcons').checked = settings.cornerIcons;

        updateRangeDisplays();
    } catch (error) {
        console.error('Error loading settings to UI:', error);
        showStatus('⚠️ Error loading settings', 'error');
    }
}


async function saveSettings() {
    try {
        const textBgColor = document.getElementById('textBgColor').value;
        const rgb = hexToRgb(textBgColor);
        const textBgOpacity = document.getElementById('textBgOpacity').value / 100;

        const newSettings = {
            // Image Sizing
            autoSize: document.getElementById('autoSize').checked,
            imageSize: {
                width: parseInt(document.getElementById('imageWidth').value, 10),
                height: parseInt(document.getElementById('imageHeight').value, 10)
            },
            aspectRatio: document.getElementById('aspectRatio').value,

            // Text Colors
            randomTextColor: document.getElementById('randomTextColor').checked,
            textColor: document.getElementById('textColor').value,
            randomTextBgColor: document.getElementById('randomTextBgColor').checked,
            textBackgroundColor: `rgba(${rgb.r},${rgb.g},${rgb.b},${textBgOpacity})`,
            
            // Icon Randomization
            randomizeIconPositions: document.getElementById('randomizeIconPositions').checked,
            
            // Other settings
            backgroundPattern: document.getElementById('backgroundPattern').value,
            showTextOnImage: document.getElementById('showTextOnImage').checked,
            dynamicFontSize: document.getElementById('dynamicFontSize').checked,
            textPosition: document.getElementById('textPosition').value,
            fontSize: parseInt(document.getElementById('fontSize').value, 10),
            compressionLevel: parseInt(document.getElementById('compressionLevel').value, 10),
            cornerIcons: document.getElementById('cornerIcons').checked,
            iconShapes: Array.from(document.querySelectorAll('.shape-option input:checked')).map(cb => cb.value),
            iconColors: Array.from(document.querySelectorAll('.icon-color')).map(input => input.value)
        };

        await window.electronAPI.updateSettings(newSettings);
        currentSettings = newSettings;
        showStatus('💾 Settings saved successfully!', 'success');

    } catch (error) {
        console.error('Error saving settings:', error);
        showStatus('❌ Error saving settings', 'error');
    }
}


async function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to their defaults?')) {
        await window.electronAPI.updateSettings(null); // `null` signals main to use defaults
        showStatus('🔄 Settings have been reset to default.', 'success');
    }
}

// --- Utility Functions ---

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 0, b: 0 };
}


function switchTab(tabName) {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${tabName}'`));
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
}

function copyExtractedText() {
    if (extractedTextData) {
        navigator.clipboard.writeText(extractedTextData).then(() => {
            showStatus('📋 Text copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Failed to copy text:', err);
            showStatus('❌ Could not copy text to clipboard.', 'error');
        });
    }
}


async function saveImageFromClipboard() {
    const btn = document.getElementById('saveClipboardBtn');
    const btnText = document.getElementById('saveBtnText');
    const originalText = btnText.textContent;

    // Provide immediate feedback on the button
    btn.disabled = true;
    btnText.textContent = '💾 Saving...';

    try {
        // Call the main process to handle everything
        await window.electronAPI.saveClipboardImage();
    } catch (error) {
        // The main process will show the notification, but we can log it here too
        console.error("Error invoking saveClipboardImage:", error);
    } finally {
        // Restore the button state
        btn.disabled = false;
        btnText.textContent = originalText;
    }
}

// --- Expose functions to the window object for HTML onclick events ---
window.switchTab = switchTab;
window.extractFromClipboard = extractFromClipboard;
window.copyExtractedText = copyExtractedText;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;
window.clearImagePreview = clearImagePreview;
window.extractFromPreviewImage = extractFromPreviewImage;
window.saveImageFromClipboard = saveImageFromClipboard;