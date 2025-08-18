#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Usage:
 *   node filter_by_xpath.js <definition-file.txt> <data-file.txt> <output-file.txt>
 *
 * Notes:
 * - Definition file: one XPath per line. Lines starting with '#' or empty lines are ignored.
 * - By default this performs a substring search: if a data line contains the XPath anywhere,
 *   that line is copied to the output.
 * - A separate file <output>_unmatched.txt is created listing definition XPaths that weren't found.
 */

async function filterFileByXPaths(definitionFilePath, dataFilePath, outputFilePath) {
  console.log('--- Starting XPath Filter Process ---');

  // 1) Read definitions
  let defs;
  try {
    const raw = fs.readFileSync(definitionFilePath, 'utf8');
    defs = raw.split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#')); // ignore blanks and comments
  } catch (err) {
    console.error(`ERROR: cannot read definition file '${definitionFilePath}': ${err.message}`);
    process.exitCode = 2;
    return;
  }

  if (defs.length === 0) {
    console.log('No XPaths found in definition file (after trimming and removing comments). Exiting.');
    return;
  }

  console.log(`Loaded ${defs.length} XPath(s) from '${path.basename(definitionFilePath)}'.`);

  // Keep a Set of unfound xpaths
  const unfound = new Set(defs);

  // 2) Stream the data file and check each line for any xpath (substring search)
  const matches = [];
  let lineCount = 0;

  try {
    const rs = fs.createReadStream(dataFilePath);
    const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });

    for await (const line of rl) {
      lineCount++;
      if (!line) continue;

      // For performance break on first match for this line
      for (const xpath of defs) {
        if (line.includes(xpath)) {
          matches.push(line);
          unfound.delete(xpath); // mark xpath as found (first occurrence suffice)
          break;
        }
      }
    }
  } catch (err) {
    console.error(`ERROR: cannot read data file '${dataFilePath}': ${err.message}`);
    process.exitCode = 3;
    return;
  }

  console.log(`[processed] ${lineCount} lines --> ${matches.length} matched lines.`);

  // 3) Write matches to output
  try {
    fs.writeFileSync(outputFilePath, matches.join('\n'), 'utf8');
    console.log(`Wrote ${matches.length} matched lines to: ${outputFilePath}`);
  } catch (err) {
    console.error(`ERROR: failed to write output file '${outputFilePath}': ${err.message}`);
  }

  // 4) Write unmatched xpaths (if any)
  const { dir, name, ext } = path.parse(outputFilePath);
  const unmatchedPath = path.join(dir, `${name}_unmatched${ext || '.txt'}`);

  try {
    if (unfound.size > 0) {
      fs.writeFileSync(unmatchedPath, [...unfound].join('\n'), 'utf8');
      console.warn(`Saved ${unfound.size} unmatched XPath(s) to: ${unmatchedPath}`);
    } else {
      fs.writeFileSync(unmatchedPath, '', 'utf8'); // create empty file to signal none unmatched
      console.log('All XPaths were found at least once. Created empty unmatched file.');
    }
  } catch (err) {
    console.error(`ERROR: failed to write unmatched file '${unmatchedPath}': ${err.message}`);
  }

  console.log('--- Done ---');
}

// main
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error('Usage: node filter_by_xpath.js <definition-file.txt> <data-file.txt> <output-file.txt>');
    process.exit(1);
  }
  filterFileByXPaths(...args);
}
