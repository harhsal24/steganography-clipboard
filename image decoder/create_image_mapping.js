const fs = require("fs");
const path = require("path");

/**
 * Transforms a full, absolute XPath into a shorter, relative XPath
 * based on the last attribute-based anchor.
 * @param {string} absoluteXpath The full XPath from the source file.
 * @returns {string} The formatted, relative XPath.
 */
function convertToRelativeXPath(absoluteXpath) {
  if (!absoluteXpath || !absoluteXpath.startsWith('/')) {
    return absoluteXpath; // Return as-is if malformed
  }

  // 1. Split path into parts and remove the initial empty string and the final tag.
  let parts = absoluteXpath.split('/').filter(p => p);
  if (parts.length > 0 && parts[parts.length - 1].toLowerCase() === 'imagefilelocationidentifier') {
      parts.pop();
  }

  // 2. Find the index of the last part that contains an attribute selector `[...]`
  let anchorIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].includes('[')) {
      anchorIndex = i;
      break;
    }
  }

  // 3. If an anchor was found, slice the array from that point.
  //    As a fallback, if no anchor is found, take the last 4 parts for context.
  let relativeParts;
  if (anchorIndex !== -1) {
    relativeParts = parts.slice(anchorIndex);
  } else {
    // Fallback: If no attribute selector, the path is likely not complex.
    // Taking the last few elements is a reasonable guess for a relative path.
    relativeParts = parts.slice(Math.max(parts.length - 4, 0));
  }

  // 4. Prefix every part with "d:" and re-join.
  const prefixedParts = relativeParts.map(part => {
    // This regex safely adds 'd:' to the beginning of the tag name,
    // leaving attributes and array indices intact.
    // e.g., 'PROPERTY[@...]' becomes 'd:PROPERTY[@...]'
    // e.g., 'IMAGE[2]' becomes 'd:IMAGE[2]'
    return part.replace(/^(\w+)/, 'd:$1');
  });

  // 5. Assemble the final relative path string.
  return `//${prefixedParts.join('/')}`;
}


/**
 * Creates a structured XML block from a single line of input.
 * @param {string} decodedText - The text extracted from the image.
 * @param {string} absoluteXpath - The full XPath to the image location tag.
 * @returns {string} - A formatted XML string representing the mapping.
 */
function createXmlBlock(decodedText, absoluteXpath) {
  // Get the last part of the original XPath for the ACI_TagRedirector
  const redirectorTag = absoluteXpath.split("/").pop() || "";

  // NEW: Convert the absolute path to the desired relative format
  const relativeXpath = convertToRelativeXPath(absoluteXpath);

  return `  <common>
    <ACI_TagRedirector>${redirectorTag}</ACI_TagRedirector>
    <ACI_Tag>${decodedText}</ACI_Tag>
    <ACI_TagIsImage>true</ACI_TagIsImage>
    <ACI_ImageSource>d:ImageFileLocationIdentifier</ACI_ImageSource>
    <UAD_Xpath>${relativeXpath}</UAD_Xpath>
  </common>`;
}

/**
 * Main function to read the text file and generate the XML mapping.
 */
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("ERROR: Invalid number of arguments.");
    console.error("\nUsage:");
    console.error("  node create_image_mapping.js <path-to-input-txt-file>");
    process.exit(1);
  }

  const inputFilePath = args[0];

  // --- 1. Read the input file ---
  let fileContent;
  try {
    console.log(`Reading input file: ${inputFilePath}`);
    fileContent = fs.readFileSync(inputFilePath, "utf-8");
  } catch (error) {
    console.error(`FATAL: Could not read input file.\n${error.message}`);
    process.exit(1);
  }

  const lines = fileContent.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    console.log("Input file is empty or contains no valid lines. Exiting.");
    return;
  }
  console.log(`Found ${lines.length} lines to process.`);

  // --- 2. Process each line and create XML blocks ---
  const xmlBlocks = [];
  for (const line of lines) {
    const delimiterIndex = line.lastIndexOf(" : ");
    if (delimiterIndex === -1) {
      console.warn(`Skipping malformed line (no ' : ' delimiter found): "${line}"`);
      continue;
    }
    const decodedText = line.substring(0, delimiterIndex).trim();
    const xpath = line.substring(delimiterIndex + 3).trim();

    if (decodedText.startsWith("DECODING_ERROR") || decodedText.startsWith("CRITICAL_ERROR")) {
      console.warn(`Skipping error line from source file: ${decodedText}`);
      continue;
    }
    
    // Pass the original, absolute XPath to the block creator
    xmlBlocks.push(createXmlBlock(decodedText, xpath));
  }
  
  if (xmlBlocks.length === 0) {
      console.log("No valid data lines were processed to create a mapping. Exiting.");
      return;
  }

  // --- 3. Assemble the final XML and write to file ---
  const finalXmlContent = `<ImageMappings>\n${xmlBlocks.join("\n")}\n</ImageMappings>`;
  const inputBaseName = path.basename(inputFilePath, path.extname(inputFilePath));
  const outputFilePath = path.join(path.dirname(inputFilePath), `${inputBaseName}_mapping.xml`);

  try {
    fs.writeFileSync(outputFilePath, finalXmlContent, "utf-8");
    console.log("\n--------------------------------------------------");
    console.log(`✅ Success! XML mapping created at: ${outputFilePath}`);
  } catch (error) {
    console.error(`\n--------------------------------------------------`);
    console.error(`❌ Failed to write output XML file: ${error.message}`);
  }
}

main();