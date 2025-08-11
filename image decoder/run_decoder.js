
const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");
const { DOMParser } = require("xmldom");
const xpath = require("xpath");
const { decodeImage } = require("../decoder");

// ===================================================================
// HELPER FUNCTIONS (Used by both modes)
// ===================================================================
const INDEXING_ATTRIBUTES = ['ValuationUseType', 'id', 'name']; // Added id/name back for general use

function convertToXPath(pathArray, rootObj) {
    let xPathParts = [];
    let currentNode = rootObj;
    for (let i = 0; i < pathArray.length; i++) {
        let segment = pathArray[i];
        if (!currentNode) break;
        if (!segment.startsWith("[")) {
            xPathParts.push(segment);
            currentNode = currentNode[segment];
        } else {
            const index = parseInt(segment.slice(1, -1));
            const specificNodeInArray = currentNode[index];
            let attributeFound = false;
            if (specificNodeInArray) {
                for (const attr of INDEXING_ATTRIBUTES) {
                    const attrKey = `@${attr}`;
                    if (specificNodeInArray[attrKey]) {
                        const tagName = xPathParts.pop();
                        xPathParts.push(`${tagName}[@${attr}='${specificNodeInArray[attrKey]}']`);
                        attributeFound = true;
                        break;
                    }
                }
            }
            if (!attributeFound) {
                const tagName = xPathParts.pop();
                xPathParts.push(`${tagName}[${index + 1}]`);
            }
            currentNode = specificNodeInArray;
        }
    }
    return `/${xPathParts.filter(p => p).join("/")}`;
}

function findNodesWithPaths(obj, targetKey) {
  let results = [];
  function recurse(currentObj, currentPath) {
    if (currentObj === null || typeof currentObj !== "object") return;
    if (Array.isArray(currentObj)) {
      currentObj.forEach((item, index) => { recurse(item, [...currentPath, `[${index}]`]); });
    } else {
      for (const key in currentObj) {
        const newPath = [...currentPath, key];
        if (key === targetKey) {
          results.push({ pathArray: newPath, value: currentObj[key] });
        }
        recurse(currentObj[key], newPath);
      }
    }
  }
  recurse(obj, []);
  return results;
}

// ===================================================================
// NEW: LOGIC FOR SINGLE-FILE (LEGACY) MODE
// ===================================================================
/**
 * Handles the simple case: find paths in one file, get values from the same file.
 * @param {string} xmlPath - The path to the single XML file.
 * @param {string} imagesFolderPath - Path to the folder containing images.
 */
async function runSingleFileMode(xmlPath, imagesFolderPath) {
    console.log("--- Running in Single-File Mode ---");
    const outputFolderName = "output";
    fs.mkdirSync(outputFolderName, { recursive: true });
    const xmlBaseName = path.basename(xmlPath, path.extname(xmlPath));
    const outputFilePath = path.join(outputFolderName, `${xmlBaseName}_output.txt`);
    const outputLines = [];

    let sourceJsonObj;
    try {
        console.log(`Reading and parsing file: ${xmlPath}`);
        const xmlData = fs.readFileSync(xmlPath, "utf-8");
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
        sourceJsonObj = parser.parse(xmlData);
    } catch (error) {
        console.error(`ERROR: Failed to read or parse XML file.\n${error.message}`);
        return;
    }
    
    // Find all image nodes directly in the parsed object
    const nodesToProcess = findNodesWithPaths(sourceJsonObj, "ImageFileLocationIdentifier");
    if (nodesToProcess.length === 0) {
        console.log("No 'ImageFileLocationIdentifier' nodes found in file. Exiting.");
        return;
    }
    console.log(`Found ${nodesToProcess.length} image reference(s) to process.`);
    console.log("--------------------------------------------------");

    for (const node of nodesToProcess) {
        const xpath = convertToXPath(node.pathArray, sourceJsonObj);
        const rawXmlValue = node.value;

        if (typeof rawXmlValue !== "string" || rawXmlValue.trim() === "") {
            console.warn(`\nSkipping invalid or empty entry with XPath: ${xpath}`);
            continue;
        }

        const filename = path.basename(rawXmlValue.trim());
        const imagePath = path.join(imagesFolderPath, filename);
        console.log(`\nProcessing file: ${filename} (from XPath: ${xpath})`);

        try {
            const result = await decodeImage(imagePath);
            let outputLine = result.success 
                ? `${result.text} : ${xpath}`
                : `DECODING_ERROR: ${result.error} : ${xpath}`;
            
            if (result.success) console.log(`   ✅ Success! Decoded Text: ${result.text}`);
            else console.error(`   ❌ Error decoding ${filename}: ${result.error}`);
            outputLines.push(outputLine);
        } catch (e) {
            console.error(`   ❌ A critical error occurred while processing ${filename}: ${e.message}`);
            const criticalErrorLine = `CRITICAL_ERROR: ${e.message} : ${xpath}`;
            outputLines.push(criticalErrorLine);
        }
    }
    
    try {
        fs.writeFileSync(outputFilePath, outputLines.join("\n"), "utf-8");
        console.log("\n--------------------------------------------------");
        console.log(`✅ Processing complete. Output written to: ${outputFilePath}`);
    } catch (error) {
        console.error("\n--------------------------------------------------", `❌ Failed to write output file: ${error.message}`);
    }
}

// ===================================================================
// NEW: LOGIC FOR TWO-FILE MODE
// ===================================================================
/**
 * Handles the advanced case: generate XPaths from a source file, then match them in a data file.
 * @param {string} sourceXmlPath - Path to the XML for generating XPaths.
 * @param {string} dataXmlPath - Path to the XML for matching XPaths and getting data.
 * @param {string} imagesFolderPath - Path to the folder containing images.
 */
async function runTwoFileMode(sourceXmlPath, dataXmlPath, imagesFolderPath) {
    console.log("--- Running in Two-File Mode ---");
    const outputFolderName = "output";
    fs.mkdirSync(outputFolderName, { recursive: true });
    const xmlBaseName = path.basename(dataXmlPath, path.extname(dataXmlPath));
    const outputFilePath = path.join(outputFolderName, `${xmlBaseName}_output.txt`);
    const outputLines = [];

    // Step 1: Generate XPaths from the source file
    console.log(`[Source] Using '${path.basename(sourceXmlPath)}' to generate XPaths.`);
    let targetXPaths = [];
    try {
        const sourceXmlData = fs.readFileSync(sourceXmlPath, "utf-8");
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
        const sourceJsonObj = parser.parse(sourceXmlData);
        const nodesToFind = findNodesWithPaths(sourceJsonObj, "ImageFileLocationIdentifier");
        for (const node of nodesToFind) {
            targetXPaths.push(convertToXPath(node.pathArray, sourceJsonObj));
        }
    } catch (error) {
        console.error(`ERROR: Failed to read or parse source file '${sourceXmlPath}'.\n${error.message}`);
        return;
    }
    if (targetXPaths.length === 0) {
        console.log("No 'ImageFileLocationIdentifier' nodes found in source file. Exiting.");
        return;
    }
    console.log(`Found ${targetXPaths.length} XPath(s) to query.`);

    // Step 2: Prepare the data XML for querying
    console.log(`[Data]   Using '${path.basename(dataXmlPath)}' as the data source.`);
    let dataDoc;
    try {
        const dataXmlData = fs.readFileSync(dataXmlPath, "utf-8");
        dataDoc = new DOMParser().parseFromString(dataXmlData);
    } catch (error) {
        console.error(`ERROR: Failed to read or parse data file '${dataXmlPath}'.\n${error.message}`);
        return;
    }
    console.log("--------------------------------------------------");

    // Step 3: Loop and query
    for (const currentXPath of targetXPaths) {
        console.log(`\nQuerying with generated XPath: ${currentXPath}`);
        let foundNodes;
        try {
            foundNodes = xpath.select(currentXPath, dataDoc);
        } catch(e) { /* ... error handling ... */ }
        if (foundNodes.length === 0) {
            console.log("   -> No nodes matched this XPath in the data file.");
            continue;
        }
        for (const foundNode of foundNodes) {
            const rawXmlValue = foundNode.textContent;
            /* ... rest of decoding logic ... */
            if (typeof rawXmlValue !== "string" || rawXmlValue.trim() === "") {
                console.warn("   -> Matched node has no value. Skipping.");
                continue;
            }
            const filename = path.basename(rawXmlValue.trim());
            const imagePath = path.join(imagesFolderPath, filename);
            console.log(`   -> Found match. Processing file: ${filename}`);
            try {
                const result = await decodeImage(imagePath);
                let outputLine = result.success 
                    ? `${result.text} : ${currentXPath}`
                    : `DECODING_ERROR: ${result.error} : ${currentXPath}`;
                if (result.success) console.log(`   ✅ Success! Decoded Text: ${result.text}`);
                else console.error(`   ❌ Error decoding ${filename}: ${result.error}`);
                outputLines.push(outputLine);
            } catch (e) {
                console.error(`   ❌ A critical error occurred while processing ${filename}: ${e.message}`);
                const criticalErrorLine = `CRITICAL_ERROR: ${e.message} : ${currentXPath}`;
                outputLines.push(criticalErrorLine);
            }
        }
    }

    // Step 4: Write output
    try {
        fs.writeFileSync(outputFilePath, outputLines.join("\n"), "utf-8");
        console.log("\n--------------------------------------------------");
        console.log(`✅ Processing complete. Output written to: ${outputFilePath}`);
    } catch (error) {
        console.error("\n--------------------------------------------------", `❌ Failed to write output file: ${error.message}`);
    }
}


// ===================================================================
// MAIN FUNCTION (ARGUMENT DISPATCHER) - Now calls separate functions
// ===================================================================
function main() {
    const args = process.argv.slice(2);

    if (args.length === 3) {
        const [sourceXmlPath, dataXmlPath, imagesFolderPath] = args;
        runTwoFileMode(sourceXmlPath, dataXmlPath, imagesFolderPath);
    } else if (args.length === 2) {
        const [xmlPath, imagesFolderPath] = args;
        runSingleFileMode(xmlPath, imagesFolderPath);
    } else {
        console.error("ERROR: Invalid number of arguments.");
        console.error("\nThis tool supports two modes of operation:\n");
        console.error("  Single-File Mode Usage:");
        console.error("    node run_decoder.js <xml-file> <images-folder>\n");
        console.error("  Two-File Mode Usage:");
        console.error("    node run_decoder.js <source-xml> <data-xml> <images-folder>\n");
        process.exit(1);
    }
}

main();