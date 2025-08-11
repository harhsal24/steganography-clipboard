

const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");
const { DOMParser } = require("xmldom");
const xpath = require("xpath");
const { decodeImage } = require("../decoder");

// ===================================================================
// HELPER FUNCTIONS (No changes needed here)
// ===================================================================
const INDEXING_ATTRIBUTES = ['ValuationUseType'];

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
// REFACTORED CORE LOGIC
// ===================================================================
/**
 * The main processing engine for the tool.
 * @param {string} sourceXmlPath - Path to the XML for generating XPaths.
 * @param {string} dataXmlPath - Path to the XML for matching XPaths and getting data.
 * @param {string} imagesFolderPath - Path to the folder containing images.
 */
async function runProcessingLogic(sourceXmlPath, dataXmlPath, imagesFolderPath) {
    const outputFolderName = "output";
    fs.mkdirSync(outputFolderName, { recursive: true });
    const xmlBaseName = path.basename(dataXmlPath, path.extname(dataXmlPath));
    const outputFilePath = path.join(outputFolderName, `${xmlBaseName}_output.txt`);
    const outputLines = [];

    // --- STEP 1: Generate XPaths from the source file ---
    console.log(`[Mode] Using '${path.basename(sourceXmlPath)}' to generate XPaths.`);
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

    // --- STEP 2: Prepare the data XML for querying ---
    console.log(`[Mode] Using '${path.basename(dataXmlPath)}' as the data source.`);
    let dataDoc;
    try {
        const dataXmlData = fs.readFileSync(dataXmlPath, "utf-8");
        dataDoc = new DOMParser().parseFromString(dataXmlData);
    } catch (error) {
        console.error(`ERROR: Failed to read or parse data file '${dataXmlPath}'.\n${error.message}`);
        return;
    }
    console.log("--------------------------------------------------");

    // --- STEP 3: Loop through generated XPaths and query the data file ---
    for (const currentXPath of targetXPaths) {
        console.log(`\nQuerying with generated XPath: ${currentXPath}`);
        let foundNodes;
        try {
            foundNodes = xpath.select(currentXPath, dataDoc);
        } catch(e) {
            console.error(`❌ Invalid XPath expression "${currentXPath}": ${e.message}`);
            continue;
        }
        if (foundNodes.length === 0) {
            console.log("   -> No nodes matched this XPath in the data file.");
            continue;
        }
        for (const foundNode of foundNodes) {
            const rawXmlValue = foundNode.textContent;
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

    // --- STEP 4: Write output ---
    try {
        fs.writeFileSync(outputFilePath, outputLines.join("\n"), "utf-8");
        console.log("\n--------------------------------------------------");
        console.log(`✅ Processing complete. Output written to: ${outputFilePath}`);
    } catch (error) {
        console.error("\n--------------------------------------------------", `❌ Failed to write output file: ${error.message}`);
    }
}

// ===================================================================
// NEW MAIN FUNCTION (ARGUMENT DISPATCHER)
// ===================================================================
/**
 * Main entry point. Detects the mode based on argument count.
 */
function main() {
    const args = process.argv.slice(2); // Get user-provided arguments

    if (args.length === 3) {
        // TWO-FILE MODE
        console.log("--- Running in Two-File Mode ---");
        const [sourceXmlPath, dataXmlPath, imagesFolderPath] = args;
        runProcessingLogic(sourceXmlPath, dataXmlPath, imagesFolderPath);

    } else if (args.length === 2) {
        // SINGLE-FILE MODE
        console.log("--- Running in Single-File Mode ---");
        const [xmlPath, imagesFolderPath] = args;
        // In this mode, the same file is used for both generating paths and getting data.
        runProcessingLogic(xmlPath, xmlPath, imagesFolderPath);

    } else {
        // INVALID ARGUMENTS
        console.error("ERROR: Invalid number of arguments.");
        console.error("\nThis tool supports two modes of operation:\n");
        console.error("  Single-File Mode Usage:");
        console.error("    node run_decoder.js <xml-file> <images-folder>\n");
        console.error("  Two-File Mode Usage:");
        console.error("    node run_decoder.js <source-xml> <data-xml> <images-folder>\n");
        process.exit(1);
    }
}

// Run the application
main();