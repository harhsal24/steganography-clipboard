const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");
const { DOMParser } = require("xmldom");
const xpath = require("xpath");
const { decodeImage } = require("../decoder");

// ===================================================================
// HELPER FUNCTIONS (Used by both modes)
// ===================================================================

/**
 * Handles the logging and saving of images that fail steganographic decoding.
 */
function handleDecodingFailure(originalImagePath, xpath, reason) {
  try {
    const failuresDir = path.join("output", "extraction_failures");
    const imagesDir = path.join(failuresDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const originalFileName = path.basename(originalImagePath);
    const newFileName = `${timestamp}-${originalFileName}`;
    const destinationImagePath = path.join(imagesDir, newFileName);
    fs.copyFileSync(originalImagePath, destinationImagePath);
    const logFilePath = path.join(failuresDir, "failure_log.txt");
    const logMessage = `[${new Date().toLocaleString()}] Image: "${originalFileName}" | XPath: ${xpath} | Reason: ${reason}\n`;
    fs.appendFileSync(logFilePath, logMessage, "utf8");
    console.log(
      `   -> Logged failure and saved image to: ${destinationImagePath}`
    );
  } catch (error) {
    console.error(
      `   -> CRITICAL: Failed to handle the decoding failure logging: ${error.message}`
    );
  }
}

const INDEXING_ATTRIBUTES = ["ValuationUseType"];

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
            xPathParts.push(
              `${tagName}[@${attr}='${specificNodeInArray[attrKey]}']`
            );
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
  return `/${xPathParts.filter((p) => p).join("/")}`;
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

// ===================================================================
// LOGIC FOR SINGLE-FILE MODE
// ===================================================================
async function runSingleFileMode(xmlPath, imagesFolderPath) {
  console.log("--- Running in Single-File Mode ---");
  const outputFolderName = "output";
  fs.mkdirSync(outputFolderName, { recursive: true });
  const xmlBaseName = path.basename(xmlPath, path.extname(xmlPath));
  const outputFilePath = path.join(
    outputFolderName,
    `${xmlBaseName}_output.txt`
  );
  const outputLines = [];

  let sourceJsonObj;
  try {
    const xmlData = fs.readFileSync(xmlPath, "utf-8");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@",
    });
    sourceJsonObj = parser.parse(xmlData);
  } catch (error) {
    console.error(`ERROR: Failed to read or parse XML file.\n${error.message}`);
    return;
  }

  const nodesToProcess = findNodesWithPaths(
    sourceJsonObj,
    "ImageFileLocationIdentifier"
  );
  if (nodesToProcess.length === 0) {
    console.log(
      "No 'ImageFileLocationIdentifier' nodes found in file. Exiting."
    );
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
      if (result.success) {
        console.log(`   ✅ Success! Decoded Text: ${result.text}`);
      } else {
        console.error(`   ❌ Error decoding ${filename}: ${result.error}`);
        handleDecodingFailure(imagePath, xpath, result.error);
      }
      // CORRECT: Construct and push the output line ONCE, using the correct 'xpath' variable
      const outputLine = result.success
        ? `${result.text} : ${xpath}`
        : `DECODING_ERROR: ${result.error} : ${xpath}`;
      outputLines.push(outputLine);
    } catch (e) {
      console.error(
        `   ❌ A critical error occurred while processing ${filename}: ${e.message}`
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
    console.error(
      `\n--------------------------------------------------`,
      `❌ Failed to write output file: ${error.message}`
    );
  }
}

// ===================================================================
// LOGIC FOR TWO-FILE MODE
// ===================================================================
async function runTwoFileMode(sourceXmlPath, dataXmlPath, imagesFolderPath) {
  console.log("--- Running in Two-File Mode ---");
  const outputFolderName = "output";
  fs.mkdirSync(outputFolderName, { recursive: true });
  const sourceBaseName = path.basename(
    sourceXmlPath,
    path.extname(sourceXmlPath)
  );
  const dataBaseName = path.basename(dataXmlPath, path.extname(dataXmlPath));
  const combinedOutputName = `${sourceBaseName}_${dataBaseName}_output.txt`;
  const outputFilePath = path.join(outputFolderName, combinedOutputName);
  const outputLines = [];

  let targetXPaths = [];
  try {
    const sourceXmlData = fs.readFileSync(sourceXmlPath, "utf-8");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@",
    });
    const sourceJsonObj = parser.parse(sourceXmlData);
    const nodesToFind = findNodesWithPaths(
      sourceJsonObj,
      "ImageFileLocationIdentifier"
    );
    for (const node of nodesToFind) {
      targetXPaths.push(convertToXPath(node.pathArray, sourceJsonObj));
    }
  } catch (error) {
    console.error(
      `ERROR: Failed to read or parse source file '${sourceXmlPath}'.\n${error.message}`
    );
    return;
  }
  if (targetXPaths.length === 0) {
    console.log(
      "No 'ImageFileLocationIdentifier' nodes found in source file. Exiting."
    );
    return;
  }
  console.log(`Found ${targetXPaths.length} XPath(s) to query.`);

  let dataDoc;
  try {
    const dataXmlData = fs.readFileSync(dataXmlPath, "utf-8");
    dataDoc = new DOMParser().parseFromString(dataXmlData);
  } catch (error) {
    console.error(
      `ERROR: Failed to read or parse data file '${dataXmlPath}'.\n${error.message}`
    );
    return;
  }
  console.log("--------------------------------------------------");

  for (const currentXPath of targetXPaths) {
    console.log(`\nQuerying with generated XPath: ${currentXPath}`);
    let foundNodes;
    try {
      foundNodes = xpath.select(currentXPath, dataDoc);
    } catch (e) {
      console.error(
        `❌ Invalid XPath expression "${currentXPath}": ${e.message}`
      );
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
        if (result.success) {
          console.log(`   ✅ Success! Decoded Text: ${result.text}`);
        } else {
          console.error(`   ❌ Error decoding ${filename}: ${result.error}`);
          handleDecodingFailure(imagePath, currentXPath, result.error);
        }
        // CORRECT: Construct and push the output line ONCE, using the correct 'currentXPath' variable
        const outputLine = result.success
          ? `${result.text} : ${currentXPath}`
          : `DECODING_ERROR: ${result.error} : ${currentXPath}`;
        outputLines.push(outputLine);
      } catch (e) {
        console.error(
          `   ❌ A critical error occurred while processing ${filename}: ${e.message}`
        );
        const criticalErrorLine = `CRITICAL_ERROR: ${e.message} : ${currentXPath}`;
        outputLines.push(criticalErrorLine);
      }
    }
  }

  try {
    fs.writeFileSync(outputFilePath, outputLines.join("\n"), "utf-8");
    console.log("\n--------------------------------------------------");
    console.log(`✅ Processing complete. Output written to: ${outputFilePath}`);
  } catch (error) {
    console.error(
      `\n--------------------------------------------------`,
      `❌ Failed to write output file: ${error.message}`
    );
  }
}

// ===================================================================
// MAIN FUNCTION (ARGUMENT DISPATCHER)
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
    console.error(
      "    node run_decoder.js <source-xml> <data-xml> <images-folder>\n"
    );
    process.exit(1);
  }
}

main();