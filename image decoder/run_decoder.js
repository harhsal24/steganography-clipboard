#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");
const { decodeImage } = require("../decoder");

// NEW: Helper function to convert our internal path array to a standard XPath expression.
/**
 * Converts an internal path array into a valid XPath string.
 * e.g., ['AssetManifest', 'Section', '[0]'] becomes '/AssetManifest/Section[1]'
 * @param {string[]} pathArray - The array of path segments.
 * @returns {string} The formatted XPath string.
 */
function convertToXPath(pathArray) {
  const xPathParts = [];
  for (const segment of pathArray) {
    // Check if the segment is an array index like '[0]'
    if (segment.startsWith("[") && segment.endsWith("]")) {
      // Get the last part added (the element this index applies to)
      const lastPart = xPathParts.pop();
      // Get the number, add 1 (for 1-based XPath), and append
      const index = parseInt(segment.slice(1, -1)) + 1;
      xPathParts.push(`${lastPart}[${index}]`);
    } else {
      // It's a regular element name
      xPathParts.push(segment);
    }
  }
  // Join all parts with '/' and add the leading '/' for an absolute path
  return `/${xPathParts.join("/")}`;
}

/**
 * MODIFIED: Recursively searches for nodes by key and returns their value and path array.
 * @param {object} obj The object to search.
 * @param {string} targetKey The key to find.
 * @returns {Array<{pathArray: string[], value: any}>} An array of objects.
 */
function findNodesWithPaths(obj, targetKey) {
  let results = [];

  function recurse(currentObj, currentPath) {
    if (currentObj === null || typeof currentObj !== "object") {
      return;
    }

    if (Array.isArray(currentObj)) {
      currentObj.forEach((item, index) => {
        recurse(item, [...currentPath, `[${index}]`]);
      });
    } else {
      for (const key in currentObj) {
        const newPath = [...currentPath, key];
        if (key === targetKey) {
          // MODIFIED: Store the raw path array instead of a joined string
          results.push({
            pathArray: newPath,
            value: currentObj[key],
          });
        }
        recurse(currentObj[key], newPath);
      }
    }
  }

  recurse(obj, []);
  return results;
}

/**
 * Main function to run the tool.
 */
async function main() {
  // ... (no changes in the argument parsing part) ...
  const xmlFilePath = process.argv[2];
  const imagesFolderPath = process.argv[3];

  if (!xmlFilePath || !imagesFolderPath) {
    console.error("ERROR: Missing arguments.");
    // ... (error message) ...
    process.exit(1);
  }

  const outputFolderName = "output";
  fs.mkdirSync(outputFolderName, { recursive: true });
  const xmlBaseName = path.basename(xmlFilePath, path.extname(xmlFilePath));
  const outputFilePath = path.join(outputFolderName, `${xmlBaseName}.txt`);
  const outputLines = [];

  // ... (no changes in the XML reading part) ...
  console.log(`Reading XML file from: ${xmlFilePath}`);
  let jsonObj;
  try {
    const xmlData = fs.readFileSync(xmlFilePath, "utf-8");
    const parser = new XMLParser();
    jsonObj = parser.parse(xmlData);
  } catch (error) {
    console.error(`Failed to read or parse XML file: ${error.message}`);
    process.exit(1);
  }

  console.log("Searching for 'ImageFileLocationIdentifier' nodes...");
  const imageNodes = findNodesWithPaths(jsonObj, "ImageFileLocationIdentifier");

  if (imageNodes.length === 0) {
    console.log("No images found in the XML file.");
    return;
  }

  console.log(`Found ${imageNodes.length} potential image reference(s).`);
  console.log("--------------------------------------------------");

  for (const node of imageNodes) {
    const xpath = convertToXPath(node.pathArray);

    const rawXmlValue = node.value;

    if (typeof rawXmlValue !== "string" || rawXmlValue.trim() === "") {
      console.warn(`\nSkipping invalid or empty entry with XPath: ${xpath}`);
      continue;
    }

    const filename = path.basename(rawXmlValue.trim());

    const imagePath = path.join(imagesFolderPath, filename);

    console.log(`\nProcessing image: ${filename} (from XPath: ${xpath})`);

    try {
      const result = await decodeImage(imagePath);
      let outputLine;
      if (result.success) {
        console.log(`✅ Success! Decoded Text: ${result.text}`);

        outputLine = `${result.text} : ${xpath}`;
      } else {
        console.error(`❌ Error decoding ${filename}: ${result.error}`);
        outputLine = `DECODING_ERROR: ${result.error} : ${xpath}`;
      }
      outputLines.push(outputLine);
    } catch (e) {
      console.error(
        `❌ A critical error occurred while processing ${filename}: ${e.message}`
      );
      const criticalErrorLine = `CRITICAL_ERROR: ${e.message} : ${xpath}`;
      outputLines.push(criticalErrorLine);
    }
  }

  try {
    fs.writeFileSync(outputFilePath, outputLines.join("\n"), "utf-8");
    console.log("\n--------------------------------------------------");
    console.log(`✅ Processing complete. Output written to: ${outputFilePath}`);
  } catch (error) {
    console.error("\n--------------------------------------------------");
    console.error(`❌ Failed to write output file: ${error.message}`);
  }
}

main();
