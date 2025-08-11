#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");
const { decodeImage } = require("../decoder");

// NEW: Define which attributes to prioritize for XPath indexing.
const INDEXING_ATTRIBUTES = ['ValuationUseType'];

/**
 * REWRITTEN: Converts an internal path array into a standard XPath expression,
 * prioritizing attributes for indexing over positional numbers.
 * @param {string[]} pathArray - The array of path segments from findNodesWithPaths.
 * @param {object} rootObj - The entire parsed JSON object from the XML.
 * @returns {string} The formatted, attribute-aware XPath string.
 */
function convertToXPath(pathArray, rootObj) {
    let xPathParts = [];
    let currentNode = rootObj;

    for (let i = 0; i < pathArray.length; i++) {
        let segment = pathArray[i];

        if (!currentNode) break; // Stop if the path becomes invalid

        // Check if the current segment is an element name (not an index)
        if (!segment.startsWith("[")) {
            xPathParts.push(segment);
            currentNode = currentNode[segment]; // Move to the next level in the object
        } else {
            // The segment is an index like '[0]'. The previous part was the tag name.
            const index = parseInt(segment.slice(1, -1));
            const specificNodeInArray = currentNode[index];

            let attributeFound = false;
            if (specificNodeInArray) {
                // Check for priority attributes on this specific node
                for (const attr of INDEXING_ATTRIBUTES) {
                    const attrKey = `@${attr}`; // The parser prefixes attributes with '@'
                    if (specificNodeInArray[attrKey]) {
                        const tagName = xPathParts.pop(); // Get the last tag name
                        xPathParts.push(`${tagName}[@${attr}='${specificNodeInArray[attrKey]}']`);
                        attributeFound = true;
                        break; // Found our best attribute, stop searching
                    }
                }
            }

            // If no priority attribute was found, fall back to positional index
            if (!attributeFound) {
                const tagName = xPathParts.pop();
                xPathParts.push(`${tagName}[${index + 1}]`); // Use 1-based index
            }

            // Advance to the specific node in the array for the next iteration
            currentNode = specificNodeInArray;
        }
    }

    // Filter out any potential undefined parts and join
    return `/${xPathParts.filter(p => p).join("/")}`;
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
