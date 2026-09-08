import fs from "node:fs/promises";
import sharp from "sharp";
const brand = "public/assets/brand";
const media = "public/assets/media";
const mark = (color) =>
  `<g fill="none" stroke="${color}" stroke-linejoin="miter"><path stroke-width="5" d="M8 50V12h8l23 34V12h9l10 10v22L46 54H34L16 28v22"/><path stroke-width="3" d="m16 12 18 27 5-8"/></g>`;
const symbol = (color, bg = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="NVD monogram">${bg ? `<rect width="64" height="64" rx="12" fill="${bg}"/>` : ""}${mark(color)}</svg>`;
const horizontal = (color, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 180" role="img" aria-label="NVD AILSS — AI-Powered Learning Support System"><rect width="620" height="180" rx="16" fill="${bg}"/><g transform="translate(24 38) scale(1.6)">${mark("#77dfff")}</g><text x="148" y="96" font-family="Arial,sans-serif" font-size="52" font-weight="700" fill="${color}">AILSS</text><text x="150" y="128" font-family="Arial,sans-serif" font-size="20" fill="${color}">AI-Powered Learning Support System</text></svg>`;
for (const [name, svg] of Object.entries({
  "nvd-symbol.svg": symbol("#77dfff"),
  "nvd-horizontal.svg": horizontal("#ffffff", "#060d20"),
  "nvd-dark.svg": horizontal("#ffffff", "#060d20"),
  "nvd-light.svg": horizontal("#101b32", "#f7f9fd"),
  "nvd-monochrome.svg": symbol("#101b32"),
  "favicon.svg": symbol("#77dfff", "#060d20"),
}))
  await fs.writeFile(`${brand}/${name}`, svg);
for (const size of [16, 32, 180, 192, 512])
  await sharp(Buffer.from(symbol("#77dfff", "#060d20")))
    .resize(size, size)
    .png()
    .toFile(`${brand}/icon-${size}.png`);
const source = "assets/source";
for (const [name, file] of Object.entries({
  knowledge: "knowledge.png",
  students: "students.png",
}))
  for (const width of [640, 1280]) {
    await sharp(`${source}/${file}`)
      .resize(width)
      .webp({ quality: 82 })
      .toFile(`${media}/${name}-${width}.webp`);
    await sharp(`${source}/${file}`)
      .resize(width)
      .avif({ quality: 52 })
      .toFile(`${media}/${name}-${width}.avif`);
  }
const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#060d20"/><g transform="translate(78 70)">${mark("#77dfff")}</g><text x="165" y="110" fill="white" font-family="Arial" font-size="34" font-weight="700">AILSS</text><text x="80" y="240" fill="white" font-family="Arial" font-size="54" font-weight="700">AI hỗ trợ.</text><text x="80" y="310" fill="#77dfff" font-family="Arial" font-size="54" font-weight="700">Giảng viên quyết định.</text><path d="M130 425h990" stroke="#294e8d" stroke-width="3"/>${["Tài liệu", "Trích xuất", "AI draft", "Rà soát", "Phê duyệt", "DRAFT"].map((t, i) => `<circle cx="${130 + i * 194}" cy="425" r="24" fill="#1760ef"/><text x="${130 + i * 194}" y="434" text-anchor="middle" fill="white" font-family="Arial" font-size="22">${i + 1}</text><text x="${130 + i * 194}" y="484" text-anchor="middle" fill="#b9c5da" font-family="Arial" font-size="24">${t}</text>`).join("")}</svg>`;
await fs.writeFile(`${media}/workflow-poster.svg`, poster);
await sharp(Buffer.from(poster)).resize(1200, 630).png().toFile(`${brand}/social-preview.png`);
await fs.writeFile(
  `${media}/workflow.vi.vtt`,
  "WEBVTT\n\n00:00.000 --> 00:03.000\nTải tài liệu PDF, DOCX hoặc TXT.\n\n00:03.000 --> 00:06.000\nTrích xuất học liệu riêng tư.\n\n00:06.000 --> 00:09.000\nAI tạo bản nháp theo objective-v1.\n\n00:09.000 --> 00:12.000\nGiảng viên rà soát và chỉnh sửa.\n\n00:12.000 --> 00:15.000\nGiảng viên phê duyệt nội dung.\n\n00:15.000 --> 00:18.000\nNhập Assessment DRAFT. AI không tự xuất bản.\n",
);
console.log("Brand assets, image variants, social preview and captions generated.");
