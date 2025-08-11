
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Filters a data file based on a list of XPaths from a definition file.
 * @param {string} definitionFilePath - Path to the text file containing one XPath per line.
 * @param {string} dataFilePath - Path to the text file containing lines in the format "value : /some/xpath".
 * @param {string} outputFilePath - Path where the filtered output will be saved.
 */
async function filterFileByXPaths(definitionFilePath, dataFilePath, outputFilePath) {
    console.log("--- Starting XPath Filter Process ---");

    // --- Step 1: Read the definition file and store all XPaths in a Set for fast lookups ---
    console.log(`[1/4] Reading definition XPaths from: ${path.basename(definitionFilePath)}`);
    let definitionXPaths;
    try {
        const definitionFileContent = fs.readFileSync(definitionFilePath, 'utf-8');
        // Create a Set for O(1) average time complexity lookups.
        // Trim each line and filter out any empty lines.
        definitionXPaths = new Set(
            definitionFileContent.split(/\r?\n/)
                .map(line => line.trim())
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

    // --- Step 2: Read the data file line-by-line to find matches ---
    console.log(`[2/4] Reading and filtering data from: ${path.basename(dataFilePath)}`);
    const matchingLines = [];
    let lineCount = 0;
    
    try {
        const fileStream = fs.createReadStream(dataFilePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity, // Handles all line-ending types (\n, \r\n)
        });

        // This promise-based approach allows us to wait for the line-by-line reading to finish.
        await new Promise((resolve) => {
            rl.on('line', (line) => {
                lineCount++;
                // Use lastIndexOf for robustness, in case the 'value' part contains ' : '
                const delimiterIndex = line.lastIndexOf(' : ');
                if (delimiterIndex === -1) {
                    return; // Skip lines that don't match the "value : xpath" format
                }

                // Extract the XPath part of the line and trim any whitespace
                const xpathPart = line.substring(delimiterIndex + 3).trim();

                // Check if this XPath exists in our definition Set
                if (definitionXPaths.has(xpathPart)) {
                    matchingLines.push(line);
                }
            });

            rl.on('close', resolve); // The promise resolves when the file is fully read
        });

    } catch (error) {
        console.error(`ERROR: Failed to read data file '${dataFilePath}'.\n${error.message}`);
        return;
    }
    
    console.log(`[3/4] Processed ${lineCount} lines and found ${matchingLines.length} matches.`);

    // --- Step 3: Write the collected matching lines to the output file ---
    try {
        fs.writeFileSync(outputFilePath, matchingLines.join('\n'), 'utf-8');
        console.log(`[4/4] ✅ Success! Output written to: ${outputFilePath}`);
    } catch (error) {
        console.error(`ERROR: Failed to write to output file '${outputFilePath}'.\n${error.message}`);
    }
}

// --- Main execution block to handle command-line arguments ---
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