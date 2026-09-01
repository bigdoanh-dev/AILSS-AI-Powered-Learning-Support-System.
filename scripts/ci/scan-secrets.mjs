import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const skippedDirectories = new Set([".git", "node_modules", "dist", "coverage", "generated"]);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];

const findings = [];
let scanned = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".env" || (entry.name.startsWith(".env.") && entry.name !== ".env.example")) continue;
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    let content;
    try {
      content = await readFile(absolute, "utf8");
    } catch {
      continue;
    }
    scanned += 1;
    if (patterns.some((pattern) => pattern.test(content))) findings.push(path.relative(root, absolute));
  }
}

await walk(root);
if (findings.length > 0)
  throw new Error(`Potential committed secret material: ${findings.sort().join(", ")}`);
console.log(JSON.stringify({ stage: "secret-scan", status: "PASS", scannedFiles: scanned }));
