import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { pages, metadata } from "../src/metadata";
const origin = process.env.AILSS_PUBLIC_ORIGIN;
if (origin && (!/^https?:\/\//.test(origin) || new URL(origin).pathname !== "/"))
  throw new Error("AILSS_PUBLIC_ORIGIN must be a valid origin without a path");
const base = origin ? new URL(origin).origin : null;
const template = await fs.readFile("dist/index.html", "utf8");
const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
for (const route of [...Object.keys(pages), "/404"]) {
  const html = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const output = new PassThrough();
    output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    output.on("end", () => resolve(Buffer.concat(chunks).toString()));
    const stream = renderToPipeableStream(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
      {
        onAllReady() {
          stream.pipe(output);
        },
        onError: reject,
      },
    );
  });
  const [title, description] = metadata(route);
  const url = base ? `${base}${route}` : route;
  const head = `<title>${escape(title)} | AILSS</title><meta name="description" content="${escape(description)}"/><meta property="og:title" content="${escape(title)} | AILSS"/><meta property="og:description" content="${escape(description)}"/><meta property="og:type" content="website"/><meta property="og:locale" content="vi_VN"/><meta property="og:image" content="${base ?? ""}/assets/brand/social-preview.png"/><meta property="og:url" content="${url}"/><link rel="canonical" href="${url}"/><link rel="apple-touch-icon" href="/assets/brand/icon-180.png"/>${route === "/404" ? '<meta name="robots" content="noindex"/>' : ""}`;
  const file = route === "/404" ? "dist/404.html" : path.join("dist", route, "index.html");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, template.replace("<!--metadata-->", head).replace("<!--app-->", html));
}
await fs.writeFile(
  "dist/robots.txt",
  `User-agent: *\nAllow: /\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ""}`,
);
// Absolute sitemap URLs require the deployment's real origin, never an invented domain.
await fs.writeFile(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    base
      ? Object.keys(pages)
          .map((route) => `<url><loc>${escape(base + route)}</loc></url>`)
          .join("")
      : ""
  }</urlset>`,
);
console.log(
  `Prerendered ${Object.keys(pages).length} public routes and 404. ${base ? "Sitemap origin: " + base : "Set AILSS_PUBLIC_ORIGIN for deployment canonical/social/sitemap URLs."}`,
);

await fs.writeFile(
  "dist/course-shell.html",
  template
    .replace(
      "<!--metadata-->",
      '<title>Thông tin khóa học | AILSS</title><meta name="description" content="Chi tiết khóa học công khai AILSS"/><meta property="og:title" content="Thông tin khóa học | AILSS"/><meta property="og:description" content="Chi tiết khóa học công khai AILSS"/><meta property="og:url" content=""/><link rel="canonical" href="/courses"/>',
    )
    .replace("<!--app-->", ""),
);

await fs.writeFile(
  "dist/app-shell.html",
  template
    .replace(
      "<!--metadata-->",
      '<title>Không gian cá nhân | AILSS</title><meta name="robots" content="noindex"/>',
    )
    .replace("<!--app-->", ""),
);
