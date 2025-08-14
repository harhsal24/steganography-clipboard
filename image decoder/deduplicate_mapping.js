const fs = require("fs");
const path = require("path");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");

/**
 * Main function to read an XML mapping file, remove duplicates, and write a new file.
 */
function main() {
  // --- 1. Argument Parsing ---
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("ERROR: Invalid number of arguments.");
    console.error("\nUsage:");
    console.error("  node deduplicate_mapping.js <input-mapping-xml-file>");
    process.exit(1);
  }
  const inputFilePath = args[0];

  // --- 2. Read and Parse the Input XML File ---
  let xmlData;
  try {
    console.log(`Reading XML file: ${inputFilePath}`);
    xmlData = fs.readFileSync(inputFilePath, "utf-8");
  } catch (error) {
    console.error(`FATAL: Could not read input file.\n${error.message}`);
    process.exit(1);
  }

  // Parser options:
  // - ignoreAttributes: false -> Keep attributes like in <PROPERTY[@ValuationUseType=...]>
  // - preserveOrder: true -> CRITICAL! This ensures we can correctly identify the "first" occurrence.
  const parserOptions = {
    ignoreAttributes: false,
    preserveOrder: true,
  };
  const parser = new XMLParser(parserOptions);

  let parsedJson;
  try {
    parsedJson = parser.parse(xmlData);
  } catch (error) {
    console.error(`FATAL: Could not parse XML file. It may be malformed.\n${error.message}`);
    process.exit(1);
  }

  // --- 3. The Core Deduplication Logic ---
  console.log("Finding and removing duplicates based on <ACI_Tag>...");
  
  // Find the root element (e.g., <ImageMappings>) and its children.
  // With preserveOrder, the structure is an array: `[{ ImageMappings: [...] }]`
  const rootElement = parsedJson[0];
  const rootKey = Object.keys(rootElement)[0]; // "ImageMappings"
  const commonBlocks = rootElement[rootKey];

  const uniqueBlocks = [];
  const seenAciTags = new Set();
  let duplicatesFound = 0;

  for (const blockWrapper of commonBlocks) {
    if (!blockWrapper.common) continue; // Skip anything that isn't a <common> block

    const blockContent = blockWrapper.common;
    
    // Find the ACI_Tag node within the block's content
    const aciTagNode = blockContent.find(node => node.ACI_Tag);
    
    if (!aciTagNode) {
        console.warn("Found a <common> block without an <ACI_Tag>. Keeping it.");
        uniqueBlocks.push(blockWrapper); // Keep malformed blocks just in case
        continue;
    }

    // The text content is in the ':#text' property when preserveOrder is true
    const aciTagValue = aciTagNode.ACI_Tag[0][':#text'];

    if (seenAciTags.has(aciTagValue)) {
      // This is a duplicate, so we skip it.
      console.log(`  - Removing duplicate for ACI_Tag: "${aciTagValue}"`);
      duplicatesFound++;
    } else {
      // This is the first time we've seen this tag. Keep it.
      seenAciTags.add(aciTagValue);
      uniqueBlocks.push(blockWrapper);
    }
  }

  if (duplicatesFound === 0) {
      console.log("No duplicate entries were found.");
  } else {
      console.log(`Removed ${duplicatesFound} duplicate entr${duplicatesFound > 1 ? 'ies' : 'y'}.`);
  }

  // --- 4. Build and Write the New XML File ---
  const finalJsonStructure = [{ [rootKey]: uniqueBlocks }];

  const builder = new XMLBuilder({ ...parserOptions, format: true });
  const finalXml = builder.build(finalJsonStructure);

  const inputDir = path.dirname(inputFilePath);
  const inputBaseName = path.basename(inputFilePath, ".xml");
  const outputFilePath = path.join(inputDir, `${inputBaseName}_deduplicated.xml`);

  try {
    fs.writeFileSync(outputFilePath, finalXml, "utf-8");
    console.log("\n--------------------------------------------------");
    console.log(`✅ Success! Deduplicated mapping written to: ${outputFilePath}`);
  } catch (error) {
    console.error("\n--------------------------------------------------");
    console.error(`❌ Failed to write output XML file: ${error.message}`);
  }
}

main();