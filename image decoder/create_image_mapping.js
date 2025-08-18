const fs = require("fs");
const path = require("path");

/** Indexing attributes used to pick the anchor node (last occurrence wins) */
const INDEXING_ATTRIBUTES = ["ValuationUseType"];

/**
 * Transforms a full, absolute XPath into a shorter, relative XPath
 * anchored at the last node that contains one of INDEXING_ATTRIBUTES.
 * If no anchor found, falls back to the last 4 parts.
 * Always removes a trailing ImageFileLocationIdentifier and prefixes tags with d:.
 *
 * Examples:
 *  /root/ITEM/PROPERTY[@ValuationUseType='X']/SUB/IMAGEFILELOCATIONIDENTIFIER
 *    -> //d:PROPERTY[@ValuationUseType='X']/d:SUB
 *
 * @param {string} absoluteXpath
 * @returns {string}
 */
function convertToRelativeXPath(absoluteXpath) {
  if (!absoluteXpath || typeof absoluteXpath !== "string") return absoluteXpath;

  // quickly bail if it doesn't look like an XPath
  if (!absoluteXpath.startsWith("/")) return absoluteXpath;

  // split into parts (remove empty parts from leading slash)
  let parts = absoluteXpath.split("/").filter((p) => p && p.trim().length > 0);

  // remove trailing ImageFileLocationIdentifier (case-insensitive)
  if (parts.length > 0 && parts[parts.length - 1].toLowerCase() === "imagefilelocationidentifier") {
    parts.pop();
  }

  if (parts.length === 0) return absoluteXpath;

  // find last part that contains any of the INDEXING_ATTRIBUTES (case-insensitive)
  const lowerAttrs = INDEXING_ATTRIBUTES.map((a) => a.toLowerCase());
  let anchorIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const lowerPart = parts[i].toLowerCase();
    // check for attribute selectors containing the attribute name, e.g. [@ValuationUseType=  or [@ValuationUseType'
    for (const attr of lowerAttrs) {
      if (lowerPart.includes("@" + attr) || lowerPart.includes("[" + attr) || lowerPart.includes(`@${attr}`)) {
        anchorIndex = i;
        break;
      }
    }
    if (anchorIndex !== -1) break;
  }

  // if no attribute anchor found, fallback to last 4 parts for context
  const relativeParts = anchorIndex !== -1 ? parts.slice(anchorIndex) : parts.slice(Math.max(parts.length - 4, 0));

  // helper to prefix the tag name with d: while preserving indexes/attributes
  // e.g. "ns:PROPERTY[@ValuationUseType='x']" -> "d:PROPERTY[@ValuationUseType='x']"
  function prefixWithD(part) {
    // capture optional namespace prefix and the local tag name
    // also handle tag names that include hyphens/underscores/numbers
    // pattern: optionalPrefix:TagName OR TagName (TagName = [A-Za-z0-9_-]+)
    // then the rest (indexes/attributes) captured separately
    const m = part.match(/^((?:[A-Za-z0-9_-]+:)?)([A-Za-z0-9_-]+)([\s\S]*)$/);
    if (!m) return "d:" + part; // fallback
    const localName = m[2];
    const rest = m[3] || "";
    return `d:${localName}${rest}`;
  }

  const prefixed = relativeParts.map(prefixWithD);

  return `//${prefixed.join("/")}`;
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