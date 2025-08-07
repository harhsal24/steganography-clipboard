let statusDiv;
let lastProcessedDiv;
let processedInfoDiv;
let extractResultsDiv;
let currentSettings = {};
let extractedTextData = '';

let currentImageFile = null;
let currentImageData = null;

// Add this at the top of your file
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
    showStatus('❌ Unexpected error occurred', 'error');
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    showStatus('❌ Unexpected error occurred', 'error');
    e.preventDefault();
});


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
    
    // Show initial status
    showStatus('🚀 Application ready! Use Ctrl+Shift+V to embed text or Ctrl+Shift+E to extract.', 'success');
}

function setupEventListeners() {
    // Electron API listeners
    window.electronAPI.onNotification((event, data) => {
        if (typeof data === 'string') {
            showStatus(data, data.includes('✅') ? 'success' : data.includes('❌') ? 'error' : 'info');
        } else {
            showStatus(data.message, data.type);
        }
    });
    
    window.electronAPI.onTextProcessed((event, data) => {
        displayProcessedResult(data);
    });
    
    window.electronAPI.onTextExtracted((event, data) => {
        displayExtractionResult(data);
    });
    
    window.electronAPI.onSettingsLoaded((event, settings) => {
        currentSettings = settings;
        loadSettingsToUI();
    });
    
    window.electronAPI.onShowSettings((event) => {
        switchTab('settings');
    });
    
    // ✅ ONLY KEEP THESE - Remove duplicates
    setupImageUpload();
    document.addEventListener('keydown', handleGlobalKeyDown);
    setupSettingsListeners();
}

function setupImageUpload() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    
    // Click to browse
    dropZone.addEventListener('click', (e) => {
        if (!e.target.closest('.preview-actions')) {
            fileInput.click();
        }
    });
    
    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        if (!dropZone.contains(e.relatedTarget)) {
            dropZone.classList.remove('drag-over');
        }
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleImageFile(files[0], 'drag-drop');
        }
    });
    
    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImageFile(e.target.files[0], 'file-input');
        }
    });
}

// Global keyboard handler for Ctrl+V
async function handleGlobalKeyDown(e) {
    // Only handle Ctrl+V when on extract tab
    if (e.ctrlKey && e.key === 'v' && document.getElementById('extract-tab').classList.contains('active')) {
        e.preventDefault();
        await handlePasteImage();
    }
}

// Handle Ctrl+V paste
async function handlePasteImage() {
    try {
        showStatus('📋 Checking clipboard for image...', 'info');
        
        // Try to get image from clipboard using the main process
        const result = await window.electronAPI.getClipboardImage();
        
        if (result.success) {
            // Create a blob from the image data and display preview
            const blob = new Blob([new Uint8Array(result.imageData)], { type: 'image/png' });
            const file = new File([blob], 'clipboard-image.png', { type: 'image/png' });
            
            handleImageFile(file, 'paste');
            showStatus('📋 Image pasted successfully!', 'success');
        } else {
            showStatus('❌ No image found in clipboard', 'error');
        }
    } catch (error) {
        console.error('Error pasting image:', error);
        showStatus('❌ Failed to paste image', 'error');
    }
}

// Enhanced file handling with preview
async function handleImageFile(file, source = 'unknown') {
    if (!file.type.startsWith('image/')) {
        showStatus('❌ Please select a valid image file', 'error');
        return;
    }
    
    currentImageFile = file;
    showStatus(`📸 Loading ${file.name}...`, 'info');
    
    try {
        // Show preview
        await showImagePreview(file, source);
        
        // Auto-extract if it's a paste operation
        if (source === 'paste') {
            setTimeout(() => {
                extractFromPreviewImage();
            }, 500);
        }
        
    } catch (error) {
        showStatus(`❌ Error loading image: ${error.message}`, 'error');
    }
}

// Show image preview
async function showImagePreview(file, source) {
    const dropContent = document.getElementById('dropContent');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');
    const imageName = document.getElementById('imageName');
    const imageDetails = document.getElementById('imageDetails');
    
    // Hide drop content, show preview
    dropContent.style.display = 'none';
    imagePreview.style.display = 'block';
    
    // Create object URL for preview
    const objectUrl = URL.createObjectURL(file);
    previewImg.src = objectUrl;
    
    // Set image info
    const sizeKB = (file.size / 1024).toFixed(1);
    const sourceLabel = {
        'file-input': '📁 File',
        'drag-drop': '🔽 Dropped',
        'paste': '📋 Pasted'
    }[source] || '📷 Image';
    
    imageName.textContent = file.name;
    imageDetails.innerHTML = `${sourceLabel} • ${sizeKB} KB • ${file.type}`;
    
    // Get image dimensions
    previewImg.onload = () => {
        const dimensions = `${previewImg.naturalWidth} × ${previewImg.naturalHeight}`;
        imageDetails.innerHTML = `${sourceLabel} • ${sizeKB} KB • ${dimensions} • ${file.type}`;
        
        // Store current image data
        currentImageData = {
            file: file,
            objectUrl: objectUrl,
            dimensions: dimensions,
            source: source
        };
    };
}

// Clear image preview
function clearImagePreview() {
    const dropContent = document.getElementById('dropContent');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');
    
    // Show drop content, hide preview
    dropContent.style.display = 'flex';
    imagePreview.style.display = 'none';
    
    // Clean up
    if (currentImageData && currentImageData.objectUrl) {
        URL.revokeObjectURL(currentImageData.objectUrl);
    }
    
    currentImageFile = null;
    currentImageData = null;
    previewImg.src = '';
    
    // Clear file input
    document.getElementById('fileInput').value = '';
    
    showStatus('🗑️ Image cleared', 'info');
}

// Extract from preview image
async function extractFromPreviewImage() {
    if (!currentImageFile) {
        showStatus('❌ No image to process', 'error');
        return;
    }
    
    const dropZone = document.getElementById('dropZone');
    
    try {
        // Show processing state
        dropZone.classList.add('processing');
        showStatus(`🔍 Extracting text from ${currentImageFile.name}...`, 'info');
        
        // Convert file to array buffer for processing
        const arrayBuffer = await currentImageFile.arrayBuffer();
        // ✅ FIXED: Use Array.from instead of Buffer.from
        const bufferArray = Array.from(new Uint8Array(arrayBuffer));
        
        // Call main process to extract text
        const result = await window.electronAPI.extractFromBuffer(bufferArray);
        
        if (result.success) {
            dropZone.classList.remove('processing');
            dropZone.classList.add('success');
            
            showStatus(`✅ Extracted ${result.text.length} characters!`, 'success');
            
            // Display results
            displayExtractionResult({
                extractedText: result.text,
                success: true,
                source: 'file',
                fileName: currentImageFile.name,
                imageSize: currentImageFile.size,
                imageDimensions: currentImageData ? currentImageData.dimensions : 'Unknown'
            });
            
            // Reset state after delay
            setTimeout(() => {
                dropZone.classList.remove('success');
            }, 3000);
            
        } else {
            dropZone.classList.remove('processing');
            dropZone.classList.add('error');
            
            showStatus(`❌ ${result.error}`, 'error');
            
            setTimeout(() => {
                dropZone.classList.remove('error');
            }, 3000);
        }
        
    } catch (error) {
        dropZone.classList.remove('processing');
        dropZone.classList.add('error');
        
        console.error('Error extracting from preview image:', error);
        showStatus(`❌ Error: ${error.message}`, 'error');
        
        setTimeout(() => {
            dropZone.classList.remove('error');
        }, 3000);
    }
}


function setupSettingsListeners() {
    // Range sliders with live update
    const ranges = [
        { id: 'fontSize', valueId: 'fontSizeValue', suffix: 'px' },
        { id: 'compressionLevel', valueId: 'compressionValue', suffix: '' },
        { id: 'textBgOpacity', valueId: 'textBgOpacityValue', suffix: '%' }
    ];
    
    ranges.forEach(range => {
        const slider = document.getElementById(range.id);
        const valueDisplay = document.getElementById(range.valueId);
        
        if (slider && valueDisplay) {
            slider.addEventListener('input', (e) => {
                valueDisplay.textContent = e.target.value + range.suffix;
            });
        }
    });
    
    // Shape selection listeners
    const shapeOptions = document.querySelectorAll('.shape-option');
    shapeOptions.forEach(option => {
        const checkbox = option.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', () => {
            option.classList.toggle('selected', checkbox.checked);
        });
    });
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.tab-button[onclick="switchTab('${tabName}')"]`).classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName + '-tab').classList.add('active');
}

function displayProcessedResult(data) {
    lastProcessedDiv.style.display = 'block';
    
    const stats = `
        <div class="stats">
            <div class="stat-item">
                <div class="stat-value">${data.originalText.length}</div>
                <div class="stat-label">Characters</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${(data.imageSize / 1024).toFixed(1)}KB</div>
                <div class="stat-label">Image Size</div>
            </div>
        </div>
    `;
    
    const preview = `
        <div class="text-preview">${data.originalText.length > 200 ? 
            data.originalText.substring(0, 200) + '...' : data.originalText}</div>
    `;
    
    processedInfoDiv.innerHTML = stats + preview + 
        '<div style="margin-top: 10px; color: #28a745; font-weight: bold;">✅ Successfully embedded and copied to clipboard</div>';
    
    // Smooth scroll to result
    lastProcessedDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function displayExtractionResult(data) {
    if (data.success) {
        extractedTextData = data.extractedText;
        
        document.getElementById('extractedLength').textContent = data.extractedText.length;
        
        // Enhanced source display
        let sourceText = 'Unknown';
        if (data.source === 'file') {
            sourceText = data.fileName || 'File';
        } else if (data.source === 'clipboard') {
            sourceText = 'Clipboard';
        }
        
        document.getElementById('extractedSource').textContent = sourceText;
        document.getElementById('extractedText').textContent = data.extractedText;
        
        extractResultsDiv.style.display = 'block';
        
        // Add additional info if available
        if (data.imageSize || data.imageDimensions) {
            const existingStats = document.querySelector('.stats');
            if (existingStats && !existingStats.querySelector('.image-stats')) {
                const additionalStats = document.createElement('div');
                additionalStats.className = 'image-stats';
                additionalStats.style.gridColumn = '1 / -1';
                additionalStats.style.marginTop = '10px';
                additionalStats.style.fontSize = '12px';
                additionalStats.style.color = '#6c757d';
                
                let statsText = '';
                if (data.imageDimensions) {
                    statsText += `📏 ${data.imageDimensions}`;
                }
                if (data.imageSize) {
                    statsText += ` • 📦 ${(data.imageSize / 1024).toFixed(1)} KB`;
                }
                
                additionalStats.innerHTML = statsText;
                existingStats.appendChild(additionalStats);
            }
        }
        
        // Smooth scroll to result
        extractResultsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        showStatus(`✅ Extracted ${data.extractedText.length} characters successfully!`, 'success');
    } else {
        // Clear any previous results
        if (document.querySelector('.image-stats')) {
            document.querySelector('.image-stats').remove();
        }
        
        extractResultsDiv.style.display = 'none';
        showStatus(`❌ Extraction failed: ${data.error}`, 'error');
    }
}

// ✅ REMOVE THIS FUNCTION - It's redundant with handleImageFile
// async function handleFileSelect(file) {
//     if (!file.type.startsWith('image/')) {
//         showStatus('❌ Please select a valid image file', 'error');
//         return;
//     }
    
//     showStatus(`🔍 Processing ${file.name}...`, 'info');
    
//     try {
//         // Create a file reader to get the buffer
//         const reader = new FileReader();
//         reader.onload = async (e) => {
//             try {
//                 // The extraction will be handled by the main process
//                 await window.electronAPI.extractFromFile();
//             } catch (error) {
//                 showStatus(`❌ Error processing file: ${error.message}`, 'error');
//             }
//         };
//         reader.readAsArrayBuffer(file);
//     } catch (error) {
//         showStatus(`❌ Error reading file: ${error.message}`, 'error');
//     }
// }

async function extractFromClipboard() {
    const btn = document.getElementById('extractClipboardBtn');
    const btnText = document.getElementById('extractBtnText');
    
    // Show loading state
    if (btn && btnText) {
        btn.disabled = true;
        btnText.textContent = '🔄 Extracting...';
    }
    
    showStatus('🔍 Checking clipboard for image...', 'info');
    
    try {
        // Call the main process to extract from clipboard
        const result = await window.electronAPI.extractFromClipboard();
        
        if (result && result.success) {
            showStatus(`✅ Extracted ${result.extractedText.length} characters successfully!`, 'success');
            
            // Display the extraction result
            displayExtractionResult({
                extractedText: result.extractedText,
                success: true,
                source: 'clipboard'
            });
            
            // Switch to extract tab to show results
            switchTab('extract');
            
        } else if (result && !result.success) {
            showStatus(`❌ Extraction failed: ${result.error}`, 'error');
        } else {
            showStatus('❌ No result returned from extraction', 'error');
        }
    } catch (error) {
        console.error('Error calling extract from clipboard:', error);
        showStatus(`❌ Error: ${error.message}`, 'error');
    } finally {
        // Reset button state
        if (btn && btnText) {
            btn.disabled = false;
            btnText.textContent = '📋 Extract from Clipboard';
        }
    }
}

function copyExtractedText() {
    if (extractedTextData) {
        navigator.clipboard.writeText(extractedTextData).then(() => {
            showStatus('📋 Text copied to clipboard!', 'success');
        }).catch(err => {
            showStatus('❌ Failed to copy text', 'error');
        });
    }
}

async function loadSettingsToUI() {
    try {
        const settings = await window.electronAPI.getSettings();
        currentSettings = settings;
        
        // Load basic settings
        document.getElementById('imageWidth').value = settings.imageSize?.width || 600;
        document.getElementById('imageHeight').value = settings.imageSize?.height || 400;
        document.getElementById('backgroundPattern').value = settings.backgroundPattern || 'gradient';
        document.getElementById('showTextOnImage').checked = settings.showTextOnImage !== false;
        document.getElementById('textPosition').value = settings.textPosition || 'center'; // Changed default
        document.getElementById('textColor').value = settings.textColor || '#FFFFFF';
        document.getElementById('fontSize').value = settings.fontSize || 20; // Changed default
        document.getElementById('compressionLevel').value = settings.compressionLevel || 6;
        document.getElementById('cornerIcons').checked = settings.cornerIcons !== false;
        
        // Load new settings
        document.getElementById('dynamicFontSize').checked = settings.dynamicFontSize !== false;
        document.getElementById('textShadow').checked = settings.textShadow !== false;
        document.getElementById('roundedBackground').checked = settings.roundedBackground !== false;

        // ✅ FIXED: Correct regex pattern
        const bgColor = settings.textBackgroundColor || 'rgba(0,0,0,0.7)';
        const rgbaMatch = bgColor.match(/rgba?$(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?$/);
        if (rgbaMatch) {
            const [, r, g, b, a] = rgbaMatch;
            const hexColor = `#${parseInt(r).toString(16).padStart(2, '0')}${parseInt(g).toString(16).padStart(2, '0')}${parseInt(b).toString(16).padStart(2, '0')}`;
            document.getElementById('textBgColor').value = hexColor;
            document.getElementById('textBgOpacity').value = Math.round((a || 0.7) * 100);
        } else {
            // Fallback if regex doesn't match
            document.getElementById('textBgColor').value = '#000000';
            document.getElementById('textBgOpacity').value = 70;
        }
        
        // Load icon shapes
        const shapes = settings.iconShapes || ['circle', 'square'];
        document.querySelectorAll('.shape-option input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = shapes.includes(checkbox.value);
            checkbox.closest('.shape-option').classList.toggle('selected', checkbox.checked);
        });
        
        // Load icon colors
        const colors = settings.iconColors || ['#FF6B6B', '#4ECDC4'];
        const colorInputs = document.querySelectorAll('.icon-color');
        colors.forEach((color, index) => {
            if (colorInputs[index]) {
                colorInputs[index].value = color;
            }
        });
        
        // Update range displays
        updateRangeDisplays();
        
    } catch (error) {
        console.error('Error loading settings:', error);
        showStatus('⚠️ Error loading settings', 'error');
    }
}

function updateRangeDisplays() {
    document.getElementById('fontSizeValue').textContent = document.getElementById('fontSize').value + 'px';
    document.getElementById('compressionValue').textContent = document.getElementById('compressionLevel').value;
    document.getElementById('textBgOpacityValue').textContent = document.getElementById('textBgOpacity').value + '%';
}

async function saveSettings() {
    try {
        // Collect all settings from UI
        const newSettings = {
            imageSize: {
                width: parseInt(document.getElementById('imageWidth').value),
                height: parseInt(document.getElementById('imageHeight').value)
            },
            backgroundPattern: document.getElementById('backgroundPattern').value,
            showTextOnImage: document.getElementById('showTextOnImage').checked,
            textPosition: document.getElementById('textPosition').value,
            textColor: document.getElementById('textColor').value,
            fontSize: parseInt(document.getElementById('fontSize').value),
            compressionLevel: parseInt(document.getElementById('compressionLevel').value),
            cornerIcons: document.getElementById('cornerIcons').checked,

            textShadow :document.getElementById('textShadow').checked,
            roundedBackground :document.getElementById('roundedBackground').checked,
            dynamicFontSize :document.getElementById('dynamicFontSize').checked,
        };
        
        // Build text background color with opacity
        const bgColor = document.getElementById('textBgColor').value;
        const bgOpacity = document.getElementById('textBgOpacity').value / 100;
        const rgb = hexToRgb(bgColor);
        newSettings.textBackgroundColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${bgOpacity})`;
        
        // Collect selected icon shapes
        const selectedShapes = [];
        document.querySelectorAll('.shape-option input[type="checkbox"]:checked').forEach(checkbox => {
            selectedShapes.push(checkbox.value);
        });
        newSettings.iconShapes = selectedShapes.length > 0 ? selectedShapes : ['circle'];
        
        // Collect icon colors
        const iconColors = [];
        document.querySelectorAll('.icon-color').forEach(input => {
            if (input.value) iconColors.push(input.value);
        });
        newSettings.iconColors = iconColors.length > 0 ? iconColors : ['#FF6B6B', '#4ECDC4'];
        
        // Save to main process
        await window.electronAPI.updateSettings(newSettings);
        currentSettings = newSettings;
        
        showStatus('💾 Settings saved successfully!', 'success');
        
    } catch (error) {
        console.error('Error saving settings:', error);
        showStatus('❌ Error saving settings', 'error');
    }
}

async function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to default?')) {
        try {
            const defaultSettings = {
                showTextOnImage: true,
                textPosition: 'bottom',
                textBackgroundColor: 'rgba(0,0,0,0.7)',
                textColor: '#FFFFFF',
                fontSize: 16,
                cornerIcons: true,
                iconShapes: ['circle', 'square'],
                iconColors: ['#FF6B6B', '#4ECDC4'],
                backgroundPattern: 'gradient',
                compressionLevel: 6,
                imageSize: { width: 600, height: 400 }
            };
            
            await window.electronAPI.updateSettings(defaultSettings);
            await loadSettingsToUI();
            
            showStatus('🔄 Settings reset to default', 'success');
            
        } catch (error) {
            showStatus('❌ Error resetting settings', 'error');
        }
    }
}

function showStatus(message, type = 'info') {
    const statusClass = type === 'success' ? 'success' : 
                       type === 'error' ? 'error' : 'info';
    
    statusDiv.innerHTML = `<div class="status ${statusClass}">${message}</div>`;
    
    // Auto-clear status after delay (except for success messages)
    if (type !== 'success') {
        setTimeout(() => {
            statusDiv.innerHTML = '';
        }, 8000);
    } else {
        setTimeout(() => {
            statusDiv.innerHTML = '';
        }, 5000);
    }
}

// Utility function to convert hex to rgb
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

// Global functions for HTML onclick events
window.switchTab = switchTab;
window.extractFromClipboard = extractFromClipboard;
window.copyExtractedText = copyExtractedText;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;

window.clearImagePreview = clearImagePreview;
window.extractFromPreviewImage = extractFromPreviewImage;