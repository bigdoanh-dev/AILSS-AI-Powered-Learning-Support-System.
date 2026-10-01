import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { JWTPayload } from "jose";
import type { IdentityProfileStore } from "./service.js";
import { parseServiceAuthorization } from "../public-profile/router.js";

export function classroomStudentRouter(
  store: Pick<IdentityProfileStore, "getUser">,
  verify: (token: string) => Promise<JWTPayload>,
): Router {
  const router = Router();
  router.get("/internal/v1/users/:id/classroom-profile", classroomStudentProfileHandler(store, verify));
  return router;
}

export function classroomStudentProfileHandler(
  store: Pick<IdentityProfileStore, "getUser">,
  verify: (token: string) => Promise<JWTPayload>,
): RequestHandler {
  return async (request, response, next) => {
    try {
      let token: string;
      try {
        token = parseServiceAuthorization({ rawHeaders: request.rawHeaders });
      } catch {
        throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
      }
      let claims: JWTPayload;
      try {
        claims = await verify(token);
      } catch {
        throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
      }
      if (claims.sub !== "classroom-service")
        throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
      const userId = z.string().uuid().parse(request.params.id);
      const user = await store.getUser(userId);
      if (!user || user.role !== "STUDENT" || user.status !== "ACTIVE")
        throw new AppError("STUDENT_NOT_FOUND", 404, "Student is not available");
      response.status(200).json({
        data: {
          userId: user.userId,
          displayName: user.displayName,
          emailMasked: user.emailMasked,
          createdAt: user.createdAt.toISOString(),
        },
        meta: { requestId: currentRequestContext()?.requestId },
      });
    } catch (error) {
      next(error);
    }
  };
}
