#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Filters a data file based on a list of XPaths from a definition file.
 * It produces two outputs: one with the matched lines, and another with any
 * XPaths from the definition file that were not found in the data file.
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
        definitionXPaths = new Set(
            definitionFileContent.split(/\r?\n/)
                .map(line => {
                    const delimiterIndex = line.lastIndexOf(' : ');
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

    const unfoundXPaths = new Set(definitionXPaths);

    // --- Step 2: Read the data file line-by-line to find matches ---
    console.log(`[2/5] Reading and filtering data from: ${path.basename(dataFilePath)}`);
    const matchingLines = [];
    let lineCount = 0;
    
    try {
        const fileStream = fs.createReadStream(dataFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        await new Promise((resolve) => {
            rl.on('line', (line) => {
                lineCount++;
                const delimiterIndex = line.lastIndexOf(' : ');
                if (delimiterIndex === -1) return;
                const xpathPart = line.substring(delimiterIndex + 3).trim();
                if (definitionXPaths.has(xpathPart)) {
                    matchingLines.push(line);
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

    // --- MODIFIED: Step 3 & 4 - Handle unmatched XPaths and write to a file ---
    console.log(`[4/5] Auditing for unmatched definition XPaths...`);
    if (unfoundXPaths.size > 0) {
        console.warn(`   -> WARNING: Found ${unfoundXPaths.size} XPath(s) from the definition file that were NOT in the data file.`);
        
        try {
            // Generate the filename for the unmatched paths file
            const { dir, name, ext } = path.parse(outputFilePath);
            const unmatchedFilePath = path.join(dir, `${name}_unmatched${ext}`);

            // Convert the Set to an array, join with newlines, and write to the file
            const unmatchedContent = [...unfoundXPaths].join('\n');
            fs.writeFileSync(unmatchedFilePath, unmatchedContent, 'utf-8');
            
            console.log(`   -> These unmatched XPaths have been saved to: ${unmatchedFilePath}`);
        } catch(error) {
            console.error(`   -> ERROR: Could not write unmatched XPaths file.\n${error.message}`);
        }
    } else {
        console.log("   -> All definition XPaths were successfully found in the data file.");
    }

    // --- Step 5: Write the primary output file with matched lines ---
    try {
        fs.writeFileSync(outputFilePath, matchingLines.join('\n'), 'utf-8');
        console.log(`[5/5] ✅ Success! Main output with matched lines written to: ${outputFilePath}`);
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