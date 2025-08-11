#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");
const { DOMParser } = require("xmldom");
const xpath = require("xpath");
const { decodeImage } = require("../decoder"); // Assuming your path is correct

const INDEXING_ATTRIBUTES = ['id', 'name'];

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
      currentObj.forEach((item, index) => {
        recurse(item, [...currentPath, `[${index}]`]);
      });
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

async function main() {
  // MODIFIED: Arguments are now source (template) XML, data XML, and images folder
  const sourceXmlPath = process.argv[2];
  const dataXmlPath = process.argv[3];
  const imagesFolderPath = process.argv[4];

  if (!sourceXmlPath || !dataXmlPath || !imagesFolderPath) {
    console.error("ERROR: Missing arguments.");
    console.error("Usage: node run_decoder.js <source-xml> <data-xml> <images-folder>");
    console.error("Example: node run_decoder.js ./xmls/template.xml ./xmls/data.xml ./images");
    process.exit(1);
  }

  const outputFolderName = "output";
  fs.mkdirSync(outputFolderName, { recursive: true });
  const xmlBaseName = path.basename(dataXmlPath, path.extname(dataXmlPath));
  const outputFilePath = path.join(outputFolderName, `${xmlBaseName}_output.txt`);
  const outputLines = [];

  // --- STEP 1: Generate a list of target XPaths from the source file ---
  console.log(`Generating XPaths from source file: ${sourceXmlPath}`);
  let targetXPaths = [];
  try {
    const sourceXmlData = fs.readFileSync(sourceXmlPath, "utf-8");
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
    const sourceJsonObj = parser.parse(sourceXmlData);
    const nodesToFind = findNodesWithPaths(sourceJsonObj, "ImageFileLocationIdentifier");
    
    // Convert the found paths into XPath strings
    for (const node of nodesToFind) {
        targetXPaths.push(convertToXPath(node.pathArray, sourceJsonObj));
    }
  } catch (error) {
    console.error(`Failed to read or parse source XML file: ${error.message}`);
    process.exit(1);
  }

  if (targetXPaths.length === 0) {
    console.log("No 'ImageFileLocationIdentifier' nodes found in source file. Exiting.");
    return;
  }
  console.log(`Found ${targetXPaths.length} XPath(s) to query in the data file.`);

  // --- STEP 2: Prepare the data XML file for querying ---
  console.log(`\nReading data file for matching: ${dataXmlPath}`);
  let dataDoc;
  try {
    const dataXmlData = fs.readFileSync(dataXmlPath, "utf-8");
    dataDoc = new DOMParser().parseFromString(dataXmlData);
  } catch (error) {
    console.error(`Failed to read or parse data XML file: ${error.message}`);
    process.exit(1);
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
            
            if (result.success) {
                 console.log(`   ✅ Success! Decoded Text: ${result.text}`);
            } else {
                 console.error(`   ❌ Error decoding ${filename}: ${result.error}`);
            }
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

main();