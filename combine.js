const fs = require("fs");
const path = require("path");

const outputDir = "combined_output"; // folder for outputs
const maxCharsPerFile = 30000; // adjust as needed (~30k chars per chunk)
const rootDir = __dirname; // project root
const ignoreFiles = ["package-lock.json","combine.js",".gitignore"];
const ignoreFolders = ["node_modules", "assets","combined_output","image decoder",".git"];

function shouldIgnore(filePath) {
const parts = filePath.split(path.sep);
return (
  ignoreFiles.includes(path.basename(filePath)) ||
  parts.some((part) => ignoreFolders.includes(part))
);
}

function collectFiles(dir, allFiles = []) {
const entries = fs.readdirSync(dir, { withFileTypes: true });
for (const entry of entries) {
  const fullPath = path.join(dir, entry.name);
  if (shouldIgnore(fullPath)) continue;
  if (entry.isDirectory()) {
    collectFiles(fullPath, allFiles);
  } else {
    allFiles.push(fullPath);
  }
}
return allFiles;
}

function splitIntoChunks(files) {
let chunks = [];
let current = "";
let chunkIndex = 0;

for (const file of files) {
  const content = fs.readFileSync(file, "utf-8");
  const entry = `// ${file}\n${content}\n\n`;

  if (current.length + entry.length > maxCharsPerFile) {
    chunks.push(current);
    current = "";
    chunkIndex++;
  }
  current += entry;
}

if (current.length > 0) chunks.push(current);
return chunks;
}

function createCombinedFiles() {
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const allFiles = collectFiles(rootDir);
const chunks = splitIntoChunks(allFiles);

chunks.forEach((chunk, index) => {
  const filePath = path.join(outputDir, `part_${index + 1}.txt`);
  const header = `// 📦 This is part ${index + 1} of ${chunks.length} of the project\n\n`;
  fs.writeFileSync(filePath, header + chunk, "utf-8");
  console.log(`✅ Created ${filePath}`);
});

console.log(`📂 Done! Split into ${chunks.length} parts inside '${outputDir}'`);
}

createCombinedFiles();
