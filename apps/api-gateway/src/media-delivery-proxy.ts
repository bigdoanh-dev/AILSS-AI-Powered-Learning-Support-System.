import { pipeline } from "node:stream/promises";
import type { RequestHandler } from "express";
import { AppError } from "../../../packages/http/src/index.js";

// Delivery validates tokens and reads private storage. Gateway only streams
// HLS bytes; Learning Service never receives playlists or segments.
export function mediaDeliveryProxy(
  internalOrigin: string,
  allowedOrigins: readonly string[],
): RequestHandler {
  const origin = new URL(internalOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw Error("MEDIA_DELIVERY_INTERNAL_ORIGIN_REJECTED");
  return async (req, res, next) => {
    const clientOrigin = req.header("origin");
    if (clientOrigin && !allowedOrigins.includes(clientOrigin)) {
      next(new AppError("MEDIA_ORIGIN_DENIED", 403, "Media origin is not allowed"));
      return;
    }
    const assetId = String(req.params.assetId),
      filename = String(req.params.filename),
      token = req.query.token;
    if (
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(assetId) ||
      !/^(master|variant)\.m3u8$|^segment-\d{5}\.ts$/.test(filename)
    ) {
      res.status(404).end();
      return;
    }
    if (typeof token !== "string" || token.length > 4096 || Object.keys(req.query).length !== 1) {
      res.status(403).end();
      return;
    }
    const url = new URL(`/playback/${assetId}/${filename}`, origin);
    url.searchParams.set("token", token);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const upstream = await fetch(url, { signal: abort.signal, redirect: "error" });
      if (clientOrigin) {
        res.setHeader("Access-Control-Allow-Origin", clientOrigin);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (!upstream.ok) {
        res.status(upstream.status === 403 ? 403 : upstream.status === 404 ? 404 : 503).end();
        return;
      }
      const type = upstream.headers.get("content-type");
      res.type(
        type?.startsWith("application/vnd.apple.mpegurl") ? "application/vnd.apple.mpegurl" : "video/mp2t",
      );
      if (!upstream.body) throw Error("MEDIA_DELIVERY_BODY_MISSING");
      await pipeline(upstream.body, res);
    } catch {
      if (!res.headersSent)
        next(new AppError("MEDIA_DELIVERY_UNAVAILABLE", 503, "Media delivery unavailable", true));
      else res.destroy();
    }
  };
}
