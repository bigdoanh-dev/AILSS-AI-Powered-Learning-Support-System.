import { Router } from "express";
import { pipeline } from "node:stream/promises";
import { verifyMediaPlayback } from "../../../packages/security/src/media-playback.js";
import type { MediaObjectStorage } from "../../../packages/storage/src/media.js";
export function mediaDeliveryRouter(
  storage: MediaObjectStorage,
  secret: string,
  tenantId: string,
  allowedOrigins: readonly string[],
): Router {
  const router = Router();
  router.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).end();
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  router.get("/playback/:assetId/:filename", async (req, res) => {
    const filename = req.params.filename,
      assetId = req.params.assetId,
      token = typeof req.query.token === "string" ? req.query.token : "";
    if (!/^(master|variant)\.m3u8$|^segment-\d{5}\.ts$/.test(filename)) {
      res.status(404).end();
      return;
    }
    let scope;
    try {
      scope = await verifyMediaPlayback(token, secret, tenantId, assetId);
    } catch {
      res.status(403).json({ error: { code: "MEDIA_PLAYBACK_DENIED" } });
      return;
    }
    try {
      const key = `media-hls/${scope.outputPrefix}/${filename}`,
        stream = await storage.readStream(key);
      if (filename.endsWith(".m3u8")) {
        let text = "";
        for await (const chunk of stream) {
          text += Buffer.from(chunk).toString("utf8");
          if (Buffer.byteLength(text) > 128 * 1024) {
            stream.destroy();
            throw Error("PLAYLIST_TOO_LARGE");
          }
        }
        if (!text.startsWith("#EXTM3U")) throw Error("PLAYLIST_INVALID");
        const signed = text
          .split("\n")
          .map((line) => {
            if (!line || line.startsWith("#")) return line;
            if (!/^(variant\.m3u8|segment-\d{5}\.ts)$/.test(line.trim()))
              throw Error("PLAYLIST_REFERENCE_REJECTED");
            return `${line.trim()}?token=${encodeURIComponent(token)}`;
          })
          .join("\n");
        res.type("application/vnd.apple.mpegurl").send(signed);
      } else {
        res.type("video/mp2t");
        await pipeline(stream, res);
      }
    } catch {
      if (!res.headersSent) res.status(503).json({ error: { code: "MEDIA_DELIVERY_UNAVAILABLE" } });
      else res.destroy();
    }
  });
  return router;
}
