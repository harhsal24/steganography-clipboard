#!/usr/bin/env node
/**
 * Standalone steganography decoder - works without Electron or Canvas
 * Usage: node decoder.js <image-path>
 */

const fs = require('fs');
const path = require('path');

// We'll use a canvas-free approach for decoding
async function extractTextFromImageBuffer(buffer) {
    try {
        // Your steganography extraction logic here
        // This should work with raw image buffer data, not canvas
        const { extractTextFromBuffer } = require('./steganography');
        return await extractTextFromBuffer(buffer);
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function decodeImage(imagePath) {
    try {
        if (!fs.existsSync(imagePath)) {
            return { success: false, error: `File not found: ${imagePath}` };
        }

        const imageBuffer = fs.readFileSync(imagePath);
        const result = await extractTextFromImageBuffer(imageBuffer);
        
        return result;
    } catch (error) {
        return { 
            success: false, 
            error: `Decoding failed: ${error.message}` 
        };
    }
}

// CLI usage
if (require.main === module) {
    const imagePath = process.argv[2];
    
    if (!imagePath) {
        console.error('Usage: node decoder.js <image-path>');
        console.error('Example: node decoder.js "C:\\Users\\harsh\\Downloads\\clipboard-image.png"');
        process.exit(1);
    }
    
    decodeImage(imagePath)
        .then(result => {
            if (result.success) {
                console.log(result.text);
                process.exit(0);
            } else {
                console.error(`Error: ${result.error}`);
                process.exit(1);
            }
        })
        .catch(error => {
            console.error(`Critical error: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { decodeImage };