import { Router, type Request } from "express";
import type { JWTPayload } from "jose";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { ActorContext } from "../../../packages/security/src/index.js";
import type { LearningCatalogRepository } from "./catalog/repository.js";
import type { LearningCommerceRepository } from "./commerce/repository.js";

export function learningInteractionEligibilityRouter(
  repository: Pick<LearningCatalogRepository, "getCanonicalCourse"> &
    Pick<LearningCommerceRepository, "entitlement"> & {
      progress(
        studentId: string,
        courseId: string,
      ): Promise<{ completedCount: number; publishedTotal: number } | undefined>;
    },
  verifyService: (t: string) => Promise<JWTPayload>,
  verifyActor: (t: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  router.get("/internal/v1/courses/:id/interaction-eligibility", async (req, res, next) => {
    try {
      const ctx = currentRequestContext();
      if (!ctx) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let claims;
      try {
        claims = await verifyService(serviceToken(req));
      } catch {
        throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
      }
      if (claims.sub !== "interaction-service")
        throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
      const id = z.string().uuid().parse(req.params.id),
        intent = z
          .enum(["COMMENT_READ_PUBLIC", "COMMENT_WRITE", "REVIEW_READ_PUBLIC", "REVIEW_CREATE"])
          .parse(req.query.intent),
        course = await repository.getCanonicalCourse(id);
      if (!course || course.state !== "PUBLISHED")
        throw new AppError("RESOURCE_NOT_FOUND", 404, "Resource not found");
      if (intent === "COMMENT_READ_PUBLIC" || intent === "REVIEW_READ_PUBLIC")
        return res.status(200).json({ eligible: true, reason: "ELIGIBLE", version: course.recordVersion });
      const token = header(req, "x-actor-context");
      if (!token) throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Actor Context is required");
      let actor;
      try {
        actor = await verifyActor(token);
      } catch {
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid Actor Context");
      }
      if (actor.correlationId !== ctx.correlationId)
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid Actor Context");
      let eligible = false,
        reason = "ROLE_NOT_ALLOWED";
      if (actor.roles.includes("STUDENT")) {
        eligible = (await repository.entitlement(actor.userId, id))?.state === "ACTIVE";
        reason = eligible ? "ELIGIBLE" : "ENTITLEMENT_REQUIRED";
        if (eligible && intent === "REVIEW_CREATE") {
          const progress = await repository.progress(actor.userId, id);
          eligible =
            !!progress &&
            progress.publishedTotal > 0 &&
            progress.completedCount * 5 >= progress.publishedTotal;
          reason = eligible ? "ELIGIBLE" : "PROGRESS_REQUIRED";
        }
      } else if (actor.roles.includes("LECTURER")) {
        eligible = course.ownerLecturerId === actor.userId;
        reason = eligible ? "ELIGIBLE" : "OWNER_REQUIRED";
      }
      res.status(200).json({ eligible, reason, version: course.recordVersion });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
function header(r: Request, n: string) {
  const v = r.rawHeaders.flatMap((x, i) =>
    i % 2 === 0 && x.toLowerCase() === n ? [r.rawHeaders[i + 1] ?? ""] : [],
  );
  if (v.length > 1) throw new Error("HEADER_REJECTED");
  return v[0];
}
function serviceToken(r: Request) {
  const h = header(r, "authorization"),
    t = h ? /^Service ([A-Za-z0-9_.-]+)$/u.exec(h)?.[1] : undefined;
  if (!t) throw new Error("SERVICE_HEADER_REJECTED");
  return t;
}
