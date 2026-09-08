import { Router } from "express";
import { types } from "cassandra-driver";
import { z } from "zod";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ProfileService } from "./service.js";
import type { ProfileActorContextVerifier } from "./router.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";

const MAX_BYTES = 256 * 1024;
export function parseAvatar(body: unknown): { bytes: Buffer; contentType: string } | null {
  const parsed = z
    .object({ dataUrl: z.string().max(350000).nullable() })
    .strict()
    .safeParse(body);
  if (!parsed.success)
    throw new AppError("INVALID_AVATAR", 422, "Use a PNG, JPEG or WebP image up to 256 KiB");
  if (parsed.data.dataUrl === null) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(parsed.data.dataUrl);
  if (!match || !match[1] || !match[2]) throw new AppError("INVALID_AVATAR", 422, "Unsupported image format");
  const bytes = Buffer.from(match[2], "base64");
  const type = match[1];
  const signature =
    type === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : type === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!signature || bytes.length < 12 || bytes.length > MAX_BYTES || bytes.toString("base64") !== match[2])
    throw new AppError("INVALID_AVATAR", 422, "Invalid image or image too large");
  return { bytes, contentType: type };
}

/** A bounded private profile image. Owner is always derived from a validated session. */
export function avatarRouter(
  client: CassandraClient,
  profile: ProfileService,
  verify: ProfileActorContextVerifier,
): Router {
  const router = Router();
  router.all("/api/v1/me/avatar", async (request, response, next) => {
    try {
      if (!["GET", "POST"].includes(request.method))
        throw new AppError("METHOD_NOT_ALLOWED", 405, "Unsupported method");
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
      await profile.read(actor);
      const owner = types.Uuid.fromString(actor.userId);
      if (request.method === "POST") {
        const image = parseAvatar(request.body);
        if (image)
          await client.execute(
            "INSERT INTO avatar_by_user (user_id,content_type,image,updated_at) VALUES (?,?,?,?)",
            [owner, image.contentType, image.bytes, new Date()],
            "LOCAL_QUORUM",
          );
        else await client.execute("DELETE FROM avatar_by_user WHERE user_id=?", [owner], "LOCAL_QUORUM");
      }
      const rows = await client.execute(
        "SELECT content_type,image FROM avatar_by_user WHERE user_id=?",
        [owner],
        "LOCAL_QUORUM",
      );
      const row = rows[0];
      const dataUrl = row
        ? `data:${String(row.get("content_type"))};base64,${(row.get("image") as Buffer).toString("base64")}`
        : null;
      response.setHeader("Cache-Control", "no-store");
      response.json({ data: { dataUrl }, meta: { requestId: context.requestId } });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
