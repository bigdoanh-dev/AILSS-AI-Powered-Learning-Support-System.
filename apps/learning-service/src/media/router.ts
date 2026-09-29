import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../authoring/model.js";
import { mediaCreateSchema } from "./model.js";
import { captionUploadSchema } from "./captions.js";
import type { MediaService } from "./service.js";
export function mediaRouter(
  service: MediaService,
  verify: (token: string, purpose: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  const context = async (req: Request, purpose: string) => {
    const c = currentRequestContext();
    if (!c) throw Error("REQUEST_CONTEXT_UNAVAILABLE");
    const raw = req.rawHeaders.filter((x, i) => i % 2 === 0 && x.toLowerCase() === "x-actor-context");
    if (raw.length !== 1) throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Trusted actor context required");
    const actor = await verify(req.header("x-actor-context") ?? "", purpose);
    if (actor.correlationId !== c.correlationId)
      throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Actor correlation mismatch");
    return { actor, requestId: c.requestId };
  };
  const id = (v: unknown) => {
    const r = z.string().uuid().safeParse(v);
    if (!r.success) throw new AppError("INVALID_RESOURCE_ID", 400, "UUID required");
    return r.data;
  };
  router.post("/api/v1/courses/:courseId/media-assets", async (req, res, next) => {
    try {
      const c = await context(req, "learning.media.write");
      const body = mediaCreateSchema.safeParse(req.body);
      if (!body.success)
        throw new AppError("MEDIA_VALIDATION_FAILED", 422, "Invalid media asset declaration");
      let key: string;
      try {
        key = validateIdempotencyKey(req.header("idempotency-key"));
      } catch {
        throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "Idempotency-Key required");
      }
      res
        .status(201)
        .json({ data: await service.create(id(req.params.courseId), c.actor, body.data, key, c.requestId) });
    } catch (e) {
      next(e);
    }
  });
  router.get("/api/v1/media-assets/:assetId", async (req, res, next) => {
    try {
      const c = await context(req, "learning.media.read");
      res.json({ data: await service.get(id(req.params.assetId), c.actor) });
    } catch (e) {
      next(e);
    }
  });
  router.get("/api/v1/media-assets/:assetId/upload", async (req, res, next) => {
    try {
      const c = await context(req, "learning.media.write");
      res.json({ data: await service.resume(id(req.params.assetId), c.actor) });
    } catch (e) {
      next(e);
    }
  });
  router.post("/api/v1/media-assets/:assetId/captions", async (req, res, next) => {
    try {
      const c = await context(req, "learning.media.write");
      const body = captionUploadSchema.safeParse(req.body);
      if (!body.success)
        throw new AppError("MEDIA_CAPTION_INVALID", 422, "Invalid WebVTT caption declaration");
      let key: string;
      try {
        key = validateIdempotencyKey(req.header("idempotency-key"));
      } catch {
        throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "Idempotency-Key required");
      }
      res
        .status(201)
        .json({ data: await service.uploadCaption(id(req.params.assetId), c.actor, body.data, key) });
    } catch (e) {
      next(e);
    }
  });
  router.post("/api/v1/media-assets/:assetId/parts", async (req, res, next) => {
    try {
      const c = await context(req, "learning.media.write");
      const body = z
        .object({ partNumber: z.number().int().min(1).max(10000) })
        .strict()
        .safeParse(req.body);
      if (!body.success) throw new AppError("MEDIA_PART_REJECTED", 422, "Invalid part declaration");
      res.json({ data: await service.part(id(req.params.assetId), c.actor, body.data.partNumber) });
    } catch (e) {
      next(e);
    }
  });
  for (const action of ["complete", "cancel", "attach"] as const)
    router.post(`/api/v1/media-assets/:assetId/${action}`, async (req, res, next) => {
      try {
        const c = await context(req, "learning.media.write");
        if (
          !z
            .object({})
            .strict()
            .safeParse(req.body ?? {}).success
        )
          throw new AppError("MEDIA_VALIDATION_FAILED", 422, "Empty command body required");
        res
          .status(action === "complete" ? 202 : 200)
          .json({ data: await service[action](id(req.params.assetId), c.actor) });
      } catch (e) {
        next(e);
      }
    });
  router.get("/api/v1/courses/:courseId/trailer", async (req, res, next) => {
    try {
      const raw = req.header("x-actor-context");
      let actor: ActorContext | undefined;
      if (raw) {
        try {
          actor = await verify(raw, "learning.media.playback");
        } catch {
          /* optional actor context */
        }
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: await service.courseTrailer(id(req.params.courseId), actor) });
    } catch (e) {
      next(e);
    }
  });
  router.post("/api/v1/lessons/:lessonId/media-session", async (req, res, next) => {
    try {
      const raw = req.rawHeaders.filter((x, i) => i % 2 === 0 && x.toLowerCase() === "x-actor-context");
      let actor: ActorContext;
      if (raw.length === 1) {
        const c = currentRequestContext();
        actor = await verify(req.header("x-actor-context") ?? "", "learning.media.playback");
        if (c && actor.correlationId !== c.correlationId)
          throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Actor correlation mismatch");
      } else {
        actor = {
          userId: "00000000-0000-0000-0000-000000000000",
          roles: ["ANONYMOUS"],
          sessionId: "00000000-0000-0000-0000-000000000000",
          tokenVersion: 0,
          correlationId: currentRequestContext()?.correlationId ?? "",
          issuedAt: Math.floor(Date.now() / 1000),
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        };
      }
      if (
        !z
          .object({})
          .strict()
          .safeParse(req.body ?? {}).success
      )
        throw new AppError("MEDIA_VALIDATION_FAILED", 422, "Empty playback request required");
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: await service.playback(id(req.params.lessonId), actor) });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
