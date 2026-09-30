import { Router, type Request } from "express";
import { types } from "cassandra-driver";
import { z } from "zod";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { ProfileService } from "../profile/service.js";
import type { PublicProfileRepository } from "./repository.js";

const fields = z
  .object({
    bio: z.string().trim().max(2000),
    experience: z.string().trim().max(3000),
    education: z.string().trim().max(2000),
    achievements: z.string().trim().max(2000),
    showPhoto: z.boolean(),
  })
  .strict();

export function lecturerEditorRouter(
  db: CassandraClient,
  profile: ProfileService,
  repo: PublicProfileRepository,
  verify: (token: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  async function actorOf(request: Request): Promise<ActorContext> {
    const context = currentRequestContext();
    const token = request.header("x-actor-context");
    if (!context || !token) throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor");
    let actor: ActorContext;
    try {
      actor = await verify(token);
    } catch {
      throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor");
    }
    if (actor.correlationId !== context.correlationId)
      throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor");
    const user = await profile.read(actor);
    if (user.role !== "LECTURER" || !user.lecturerVerified || user.status !== "ACTIVE")
      throw new AppError("LECTURER_VERIFICATION_REQUIRED", 403, "Verified lecturer required");
    return actor;
  }
  router.get("/api/v1/me/lecturer-profile", async (request, response, next) => {
    try {
      const actor = await actorOf(request);
      const value = await repo.getProjection(actor.userId);
      if (!value?.verified)
        throw new AppError("PUBLIC_PROFILE_NOT_AVAILABLE", 503, "Public profile unavailable", true);
      response.json({
        data: {
          bio: value.bio ?? "",
          experience: value.experience ?? "",
          education: value.education ?? "",
          achievements: value.achievements ?? "",
          showPhoto: value.avatarPublic,
        },
      });
    } catch (error) {
      next(error);
    }
  });
  router.patch("/api/v1/me/lecturer-profile", async (request, response, next) => {
    try {
      const actor = await actorOf(request);
      const parsed = fields.safeParse(request.body);
      if (!parsed.success)
        throw new AppError("INVALID_LECTURER_PROFILE", 422, "Invalid public lecturer profile");
      const current = await repo.getProjection(actor.userId);
      if (!current?.verified)
        throw new AppError("PUBLIC_PROFILE_NOT_AVAILABLE", 503, "Public profile unavailable", true);
      const input = parsed.data;
      const rows = await db.execute(
        `UPDATE public_lecturer_by_id SET bio=?,experience=?,education=?,achievements=?,avatar_public=?,updated_at=?
         WHERE lecturer_id=? IF profile_version=? AND verified=true`,
        [
          input.bio || null,
          input.experience || null,
          input.education || null,
          input.achievements || null,
          input.showPhoto,
          new Date(),
          types.Uuid.fromString(actor.userId),
          types.Long.fromNumber(current.profileVersion),
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
      if (rows[0]?.get("[applied]") !== true)
        throw new AppError(
          "PUBLIC_PROFILE_VERSION_CONFLICT",
          409,
          "Public profile changed; reload and retry",
        );
      response.json({ data: input });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
