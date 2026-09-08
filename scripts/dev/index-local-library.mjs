import { readdir, stat, realpath, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, extname, basename } from "node:path";
import { createHash } from "node:crypto";
const roots = await Promise.all(process.argv.slice(2).map((x) => realpath(resolve(x))));
if (!roots.length) throw Error("Pass the local teaching-material folders as arguments.");
const types = {
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const items = [];
async function walk(root, dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(root, path);
    else if (entry.isFile() && types[extname(path).toLowerCase()]) {
      const info = await stat(path);
      items.push({
        id: createHash("sha256").update(path).digest("hex").slice(0, 24),
        root,
        path,
        title: basename(path, extname(path)).normalize("NFC"),
        group: relative(root, dir).normalize("NFC") || basename(root).normalize("NFC"),
        contentType: types[extname(path).toLowerCase()],
        size: info.size,
      });
    }
  }
}
for (const root of roots) await walk(root, root);
items.sort(
  (a, b) =>
    a.group.localeCompare(b.group, "vi", { numeric: true }) ||
    a.title.localeCompare(b.title, "vi", { numeric: true }),
);
const output = new URL("../../tmp/local-library.json", import.meta.url);
await mkdir(new URL("../../tmp/", import.meta.url), { recursive: true });
await writeFile(output, JSON.stringify({ items }, null, 2));
console.log(
  `Indexed ${items.length} local teaching files. Originals remain in their folders; no files copied.`,
);
