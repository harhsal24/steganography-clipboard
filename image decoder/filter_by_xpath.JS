#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Filters a data file based on a list of XPaths from a definition file.
 * @param {string} definitionFilePath - Path to the text file containing XPaths.
 * @param {string} dataFilePath - Path to the text file containing lines in the format "value : /some/xpath".
 * @param {string} outputFilePath - Path where the filtered output will be saved.
 */
async function filterFileByXPaths(definitionFilePath, dataFilePath, outputFilePath) {
    console.log("--- Starting XPath Filter Process ---");

    // --- Step 1: Read the definition file and store all XPaths in a Set ---
    console.log(`[1/5] Reading definition XPaths from: ${path.basename(definitionFilePath)}`);
    let definitionXPaths;
    try {
        const definitionFileContent = fs.readFileSync(definitionFilePath, 'utf-8');
        
        // MODIFIED: Handle lines that might have a "value : " part.
        definitionXPaths = new Set(
            definitionFileContent.split(/\r?\n/)
                .map(line => {
                    const delimiterIndex = line.lastIndexOf(' : ');
                    // If a delimiter exists, take the part after it; otherwise, use the whole line.
                    const xpath = delimiterIndex !== -1 
                        ? line.substring(delimiterIndex + 3).trim() 
                        : line.trim();
                    return xpath;
                })
                .filter(line => line.length > 0)
        );
    } catch (error) {
        console.error(`ERROR: Failed to read definition file '${definitionFilePath}'.\n${error.message}`);
        return;
    }

    if (definitionXPaths.size === 0) {
        console.log("Definition file is empty or contains no valid XPaths. Exiting.");
        return;
    }
    console.log(`   -> Found ${definitionXPaths.size} unique XPaths to use as a filter.`);

    // NEW: Create a copy of the set to track which XPaths are NOT found.
    const unfoundXPaths = new Set(definitionXPaths);

    // --- Step 2: Read the data file line-by-line to find matches ---
    console.log(`[2/5] Reading and filtering data from: ${path.basename(dataFilePath)}`);
    const matchingLines = [];
    let lineCount = 0;
    
    try {
        const fileStream = fs.createReadStream(dataFilePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });

        await new Promise((resolve) => {
            rl.on('line', (line) => {
                lineCount++;
                const delimiterIndex = line.lastIndexOf(' : ');
                if (delimiterIndex === -1) return;

                const xpathPart = line.substring(delimiterIndex + 3).trim();

                if (definitionXPaths.has(xpathPart)) {
                    matchingLines.push(line);
                    // NEW: If we found a match, remove it from the 'unfound' set.
                    unfoundXPaths.delete(xpathPart);
                }
            });

            rl.on('close', resolve);
        });

    } catch (error) {
        console.error(`ERROR: Failed to read data file '${dataFilePath}'.\n${error.message}`);
        return;
    }
    
    console.log(`[3/5] Processed ${lineCount} lines and found ${matchingLines.length} matches.`);

    // --- NEW: Step 3 - Report any XPaths that were not found ---
    console.log(`[4/5] Auditing for unmatched definition XPaths...`);
    if (unfoundXPaths.size > 0) {
        console.warn(`   -> WARNING: The following ${unfoundXPaths.size} XPath(s) from the definition file were NOT found in the data file:`);
        for (const xpath of unfoundXPaths) {
            // Use console.warn to make the missing paths stand out.
            console.warn(`     - ${xpath}`);
        }
    } else {
        console.log("   -> All definition XPaths were successfully found in the data file.");
    }

    // --- Step 4: Write the collected matching lines to the output file ---
    try {
        fs.writeFileSync(outputFilePath, matchingLines.join('\n'), 'utf-8');
        console.log(`[5/5] ✅ Success! Output written to: ${outputFilePath}`);
    } catch (error) {
        console.error(`ERROR: Failed to write to output file '${outputFilePath}'.\n${error.message}`);
    }
}

// --- Main execution block (unchanged) ---
function main() {
    const args = process.argv.slice(2);
    if (args.length !== 3) {
        console.error("ERROR: Invalid number of arguments.");
        console.error("\nUsage:");
        console.error("  node filter_by_xpath.js <definition-file.txt> <data-file.txt> <output-file.txt>");
        console.error("\nExample:");
        console.error("  node filter_by_xpath.js ./definitions.txt ./data.txt ./filtered_output.txt");
        process.exit(1);
    }
    const [definitionFilePath, dataFilePath, outputFilePath] = args;
    filterFileByXPaths(definitionFilePath, dataFilePath, outputFilePath);
}

main();