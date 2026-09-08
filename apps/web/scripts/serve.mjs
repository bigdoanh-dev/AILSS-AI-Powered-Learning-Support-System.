const contentOrigin = new URL(process.env.OBJECT_STORAGE_PUBLIC_URL || "http://127.0.0.1:9000").origin;
import { createSessionAdapter } from "../server/session.mjs";
import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
const root = path.resolve("dist");
const gateway = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".vtt": "text/vtt; charset=utf-8",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};
const sessionAdapter = createSessionAdapter({
  gateway,
  origin: process.env.AILSS_WEB_ORIGIN || `http://127.0.0.1:${process.env.PORT || 4174}`,
  production: process.env.NODE_ENV === "production",
});
const server = http.createServer(async (req, res) => {
  if (await sessionAdapter(req, res)) return;
  if (req.url?.startsWith("/api/")) {
    const transport = gateway.protocol === "https:" ? https : http;
    const upstream = transport.request(
      new URL(req.url, gateway),
      { method: req.method, headers: { ...req.headers, cookie: "", host: gateway.host } },
      (response) => {
        res.writeHead(response.statusCode || 502, { ...response.headers, "Cache-Control": "no-store" });
        response.pipe(res);
      },
    );
    upstream.setTimeout(15000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "GATEWAY_UNAVAILABLE" } }));
    });
    req.pipe(upstream);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    let file = path.resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let status = 200;
    try {
      const info = await fs.stat(file);
      if (info.isDirectory()) file = path.join(file, "index.html");
    } catch {
      if (["/app", "/app/", "/app/account", "/app/account/"].includes(pathname))
        file = path.join(root, "app-shell.html");
      else if (/^\/courses\/[0-9a-f-]+\/?$/i.test(pathname)) file = path.join(root, "course-shell.html");
      else {
        file = path.join(root, "404.html");
        status = 404;
      }
    }
    let body = await fs.readFile(file);
    const ext = path.extname(file);
    const headers = {
      "Content-Type": types[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' ${contentOrigin}; frame-src 'self' ${contentOrigin} https://www.youtube-nocookie.com https://drive.google.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
      "Cache-Control": /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(file)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    };
    if (ext === ".webm" && req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (match) {
        const start = Number(match[1]);
        const end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1);
        if (start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${body.length}` });
          res.end();
          return;
        }
        headers["Content-Range"] = `bytes ${start}-${end}/${body.length}`;
        body = body.subarray(start, end + 1);
        status = 206;
      }
      headers["Accept-Ranges"] = "bytes";
    } else if (
      /gzip/.test(req.headers["accept-encoding"] || "") &&
      [".html", ".js", ".css", ".svg", ".xml"].includes(ext)
    ) {
      body = gzipSync(body);
      headers["Content-Encoding"] = "gzip";
      headers.Vary = "Accept-Encoding";
    }
    headers["Content-Length"] = String(body.length);
    res.writeHead(status, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid request");
  }
});
server.listen(Number(process.env.PORT || 4174), "127.0.0.1", () =>
  console.log(`AILSS production preview http://127.0.0.1:${process.env.PORT || 4174}`),
);
