const { createCanvas, loadImage } = require('canvas');

function embedTextInImage(imageData, text) {
  const data = imageData.data;
  const textWithChecksum = addErrorCorrection(text);
  const magicHeader = "STEG" + String.fromCharCode(0x1F, 0x2F, 0x3F, 0x4F);
  const fullText = magicHeader + textWithChecksum;
  const fullBinaryText = stringToBinary(fullText);
  
  // Check capacity
  const maxBits = Math.floor(data.length / 4) * 3; // 3 color channels per pixel
  if (fullBinaryText.length > maxBits - 32) {
    return null;
  }
  
  // Embed length (32 bits)
  const lengthBinary = (fullBinaryText.length).toString(2).padStart(32, '0');
  let bitIndex = 0;
  
  for (let i = 0; i < 32; i++) {
    const pixelIndex = Math.floor(bitIndex / 3) * 4;
    const channelIndex = bitIndex % 3;
    data[pixelIndex + channelIndex] = (data[pixelIndex + channelIndex] & 0xFE) | parseInt(lengthBinary[i]);
    bitIndex++;
  }
  
  // Embed data with redundancy for compression resistance
  for (let i = 0; i < fullBinaryText.length; i++) {
    const bit = parseInt(fullBinaryText[i]);
    
    // Use LSB in multiple positions for redundancy
    for (let j = 0; j < 2; j++) {
      const pixelIndex = Math.floor(bitIndex / 3) * 4;
      const channelIndex = bitIndex % 3;
      
      if (pixelIndex + channelIndex < data.length) {
        data[pixelIndex + channelIndex] = (data[pixelIndex + channelIndex] & 0xFE) | bit;
        bitIndex++;
      }
    }
  }
  
  return imageData;
}

function extractTextFromImage(imageData) {
  try {
    const data = imageData.data;
    
    // Extract length
    let lengthBinary = '';
    for (let i = 0; i < 32; i++) {
      const pixelIndex = Math.floor(i / 3) * 4;
      const channelIndex = i % 3;
      lengthBinary += (data[pixelIndex + channelIndex] & 1).toString();
    }
    
    const textLength = parseInt(lengthBinary, 2);
    if (textLength <= 0 || textLength > 50000) {
      return { success: false, error: "No valid steganographic data found" };
    }
    
    // Extract data with redundancy check
    let binaryText = '';
    let bitIndex = 32;
    
    for (let i = 0; i < textLength; i++) {
      let votes = [0, 0]; // count of 0s and 1s
      
      // Check redundant copies
      for (let j = 0; j < 2; j++) {
        const pixelIndex = Math.floor(bitIndex / 3) * 4;
        const channelIndex = bitIndex % 3;
        
        if (pixelIndex + channelIndex < data.length) {
          const bit = data[pixelIndex + channelIndex] & 1;
          votes[bit]++;
        }
        bitIndex++;
      }
      
      // Choose majority vote
      binaryText += votes[1] > votes[0] ? '1' : '0';
    }
    
    const fullText = binaryToString(binaryText);
    const magicHeader = "STEG" + String.fromCharCode(0x1F, 0x2F, 0x3F, 0x4F);
    
    if (!fullText.startsWith(magicHeader)) {
      return { success: false, error: "Not a steganographic image from this tool" };
    }
    
    const textWithChecksum = fullText.substring(magicHeader.length);
    const extractedText = removeErrorCorrection(textWithChecksum);
    
    if (extractedText === null) {
      return { success: false, error: "Data corrupted - checksum validation failed" };
    }
    
    return { success: true, text: extractedText };
    
  } catch (error) {
    return { success: false, error: "Extraction failed: " + error.message };
  }
}

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

function addErrorCorrection(text) {
  // Enhanced checksum with CRC-like error detection
  let checksum = 0;
  for (let i = 0; i < text.length; i++) {
    checksum = ((checksum << 1) | (checksum >> 7)) & 0xFF;
    checksum ^= text.charCodeAt(i);
  }
  
  // Add length check as additional validation
  const lengthChecksum = text.length % 256;
  return text + String.fromCharCode(checksum) + String.fromCharCode(lengthChecksum);
}

function removeErrorCorrection(textWithChecksum) {
  if (textWithChecksum.length < 3) return null;
  
  const text = textWithChecksum.slice(0, -2);
  const receivedChecksum = textWithChecksum.charCodeAt(textWithChecksum.length - 2);
  const receivedLengthChecksum = textWithChecksum.charCodeAt(textWithChecksum.length - 1);
  
  // Verify length checksum first
  const expectedLengthChecksum = text.length % 256;
  if (receivedLengthChecksum !== expectedLengthChecksum) {
    return null;
  }
  
  // Verify main checksum
  let calculatedChecksum = 0;
  for (let i = 0; i < text.length; i++) {
    calculatedChecksum = ((calculatedChecksum << 1) | (calculatedChecksum >> 7)) & 0xFF;
    calculatedChecksum ^= text.charCodeAt(i);
  }
  
  return receivedChecksum === calculatedChecksum ? text : null;
}

function stringToBinary(str) {
  return str.split('').map(char => 
    char.charCodeAt(0).toString(2).padStart(8, '0')
  ).join('');
}

function binaryToString(binary) {
  const bytes = binary.match(/.{8}/g) || [];
  return bytes.map(byte => String.fromCharCode(parseInt(byte, 2))).join('');
}

module.exports = {
  embedTextInImage,
  extractTextFromImage,
  extractTextFromBuffer
};