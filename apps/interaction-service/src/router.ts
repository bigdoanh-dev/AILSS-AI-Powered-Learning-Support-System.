import { createHmac, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { ActorContext } from "../../../packages/security/src/index.js";
import { decodeCursor, encodeCursor, type TimelineCursor } from "./cursor.js";
import type { EligibilityClient } from "./eligibility.js";
import { body, createSchema, json, patchSchema, type Comment, type ResourceType } from "./model.js";
import { day, type InteractionRepository, type Position } from "./repository.js";

const target = z.enum(["COURSE", "CLASS"]),
  id = z.string().uuid(),
  filtersHash = "all-comments-v1" as const;
export function interactionRouter(
  repo: InteractionRepository,
  eligibility: EligibilityClient,
  verify: (token: string) => Promise<ActorContext>,
  secret: string,
): Router {
  const router = Router();
  router.get("/api/v1/resources/:resourceType/:resourceId/comments", async (req, res, next) => {
    try {
      const context = ctx(),
        type = target.parse(req.params.resourceType),
        resourceId = id.parse(req.params.resourceId),
        token = targetActor(req, type);
      if (type === "CLASS" && !token) throw notFound();
      if (!(await eligibility.check(type, resourceId, false, token, context.correlationId))) throw notFound();
      const limit = parseLimit(req.query.limit),
        now = new Date();
      let cursor: TimelineCursor;
      if (req.query.cursor) {
        try {
          cursor = decodeCursor(secret, z.string().max(16384).parse(req.query.cursor), {
            resourceType: type,
            resourceId,
            limit,
          });
        } catch {
          throw new AppError("INVALID_CURSOR", 400, "Invalid or expired cursor");
        }
      } else {
        const bounds = await repo.bounds(type, resourceId);
        if (!bounds) return res.json(listEnvelope([], context.requestId, limit, false, null));
        const issued = Math.floor(now.getTime() / 1000);
        cursor = {
          v: 1,
          resourceType: type,
          resourceId,
          snapshotUpperBound: now.toISOString(),
          currentDay: bounds.latestDay,
          limit,
          filtersHash,
          direction: "DESC",
          positions: {},
          issuedAt: issued,
          expiresAt: issued + 900,
        };
      }
      const bounds = await repo.bounds(type, resourceId);
      if (!bounds) throw new AppError("INVALID_CURSOR", 400, "Invalid cursor target");
      const days = [cursor.currentDay, addDays(cursor.currentDay, -1)],
        window = await repo.listWindow(
          type,
          resourceId,
          days,
          new Date(cursor.snapshotUpperBound),
          cursor.positions,
        ),
        positions: { [key: string]: Position } = { ...cursor.positions },
        items: Comment[] = [];
      let consumed = 0;
      for (const candidate of window.candidates) {
        positions[candidate.partition] = {
          createdAt: candidate.comment.createdAt.toISOString(),
          commentId: candidate.comment.commentId,
        };
        consumed++;
        const canonical = await repo.get(candidate.comment.commentId);
        if (!canonical || canonical.resourceType !== type || canonical.resourceId !== resourceId) continue;
        if (candidate.comment.version > canonical.version) throw new Error("PROJECTION_CORRUPTION");
        if (!sameProjection(candidate.comment, canonical)) await repo.project(canonical);
        if (canonical.state === "HIDDEN_BY_MODERATOR") continue;
        items.push(canonical);
        if (items.length === limit) break;
      }
      const remains = consumed < window.candidates.length || !window.exhausted;
      let hasMore = remains,
        nextCursor: string | null = null;
      if (remains) {
        nextCursor = encodeCursor(secret, { ...cursor, positions });
      } else {
        const nextDay = addDays(cursor.currentDay, -2),
          older = nextDay >= bounds.earliestDay;
        hasMore = older;
        if (older) nextCursor = encodeCursor(secret, { ...cursor, currentDay: nextDay, positions: {} });
      }
      res.json(listEnvelope(items, context.requestId, limit, hasMore, nextCursor));
    } catch (error) {
      next(map(error));
    }
  });
  router.post("/api/v1/resources/:resourceType/:resourceId/comments", async (req, res, next) => {
    try {
      const context = ctx(),
        actorValue = await actor(req, verify, context.correlationId),
        type = target.parse(req.params.resourceType),
        resourceId = id.parse(req.params.resourceId),
        parsed = createSchema.parse(req.body),
        normalized = body(parsed.body),
        command = await begin(
          repo,
          secret,
          "INT-02",
          actorValue.userId,
          `${type}:${resourceId}`,
          key(req),
          {
            method: "POST",
            path: `/api/v1/resources/${type}/${resourceId}/comments`,
            actorId: actorValue.userId,
            resourceType: type,
            resourceId,
            body: normalized,
            parentId: parsed.parentId ?? null,
          },
          undefined,
        );
      if (command.replay) return sendReplay(res, command.replay);
      if (!(await eligibility.check(type, resourceId, true, targetActor(req, type), context.correlationId)))
        throw new AppError("INTERACTION_FORBIDDEN", 403, "Interaction forbidden");
      if (parsed.parentId) {
        const parent = await repo.get(parsed.parentId);
        if (!parent || parent.resourceType !== type || parent.resourceId !== resourceId)
          throw new AppError("COMMENT_NOT_FOUND", 404, "Comment not found");
        if (parent.parentId || parent.state !== "ACTIVE")
          throw new AppError("REPLY_DEPTH_EXCEEDED", 422, "Reply depth exceeded");
      }
      const now = new Date(),
        value: Comment = {
          commentId: command.resourceId,
          resourceType: type,
          resourceId,
          parentId: parsed.parentId ?? null,
          authorId: actorValue.userId,
          body: normalized,
          state: "ACTIVE",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
        existing = await repo.get(value.commentId);
      if (existing) {
        if (!sameCreate(existing, value)) throw new Error("CREATE_RECOVERY_MISMATCH");
        value.createdAt = existing.createdAt;
        value.updatedAt = existing.updatedAt;
      } else if (!(await repo.create(value))) {
        const recovered = await repo.get(value.commentId);
        if (!recovered || !sameCreate(recovered, value)) throw new Error("CREATE_AMBIGUOUS");
      }
      await repo.checkpoint(
        command.scope,
        command.hash,
        command.key,
        command.operationId,
        "CANONICAL_COMMITTED",
        now,
      );
      await repo.project(value);
      const projection = await repo.projection(value);
      if (!projection || !sameProjection(projection, value)) throw new Error("PROJECTION_DIVERGENCE");
      await repo.includeDay(type, resourceId, day(value.createdAt), now);
      await repo.checkpoint(
        command.scope,
        command.hash,
        command.key,
        command.operationId,
        "PROJECTION_CONVERGED",
        now,
      );
      const response = singleEnvelope(value, context.requestId, now);
      await finish(repo, command, 201, value.version, response, now);
      res.set("etag", '"v1"').status(201).json(response);
    } catch (error) {
      next(map(error));
    }
  });
  const mutate = (kind: "PATCH" | "DELETE") => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = ctx(),
        actorValue = await actor(req, verify, context.correlationId),
        commentId = id.parse(req.params.commentId),
        expected = match(req),
        normalized = kind === "PATCH" ? body(patchSchema.parse(req.body).body) : null,
        command = await begin(
          repo,
          secret,
          kind === "PATCH" ? "INT-03" : "INT-04",
          actorValue.userId,
          commentId,
          key(req),
          {
            method: kind,
            path: `/api/v1/comments/${commentId}`,
            actorId: actorValue.userId,
            commentId,
            body: normalized,
            ifMatch: `"v${String(expected)}"`,
          },
          commentId,
        );
      if (command.replay) return sendReplay(res, command.replay);
      let old = await repo.get(commentId);
      if (!old) throw new AppError("COMMENT_NOT_FOUND", 404, "Comment not found");
      if (
        !(await eligibility.check(
          old.resourceType,
          old.resourceId,
          true,
          targetActor(req, old.resourceType),
          context.correlationId,
        ))
      )
        throw notFound();
      if (old.authorId !== actorValue.userId)
        throw new AppError("COMMENT_OWNER_REQUIRED", 403, "Comment owner required");
      if (old.pendingOperationId && old.pendingOperationId !== command.operationId) {
        if ((await repo.operationState(old.pendingOperationId)) === "COMPLETE") {
          await repo.clearClaim(commentId, old.pendingOperationId);
          old = (await repo.get(commentId)) ?? old;
        } else throw new AppError("COMMENT_RECOVERY_IN_PROGRESS", 409, "Comment recovery is in progress");
      }
      const contentChecksum = checksum(secret, { kind, normalized }),
        committed = isCommittedBy(old, command.operationId, expected, contentChecksum),
        noOp =
          !committed && (kind === "DELETE" ? old.state === "DELETED_BY_AUTHOR" : old.body === normalized);
      if (!noOp && old.version !== expected && !committed)
        throw new AppError("VERSION_CONFLICT", 409, "Version conflict");
      const now = new Date(),
        value: Comment =
          noOp || committed
            ? old
            : {
                ...old,
                body: normalized,
                state: kind === "DELETE" ? "DELETED_BY_AUTHOR" : "ACTIVE",
                version: expected + 1,
                updatedAt: now,
              };
      if (!noOp && old.version === expected) {
        if (!old.pendingOperationId) {
          if (!(await repo.claim(commentId, expected, command.operationId, kind, contentChecksum))) {
            old = (await repo.get(commentId)) ?? old;
            if (!isClaimedBy(old, command.operationId, expected, contentChecksum))
              throw new AppError("COMMENT_RECOVERY_IN_PROGRESS", 409, "Comment recovery is in progress");
          }
        }
        if (old.version === expected && !(await repo.applyMutation(value, expected, command.operationId))) {
          const recovered = await repo.get(commentId);
          if (!recovered || !isCommittedBy(recovered, command.operationId, expected, contentChecksum))
            throw new AppError("VERSION_CONFLICT", 409, "Version conflict");
        }
      }
      await repo.checkpoint(
        command.scope,
        command.hash,
        command.key,
        command.operationId,
        "CANONICAL_COMMITTED",
        now,
      );
      const canonical = await repo.get(commentId);
      if (!canonical) throw new Error("CANONICAL_MISSING");
      await repo.project(canonical);
      const projection = await repo.projection(canonical);
      if (!projection || !sameProjection(projection, canonical)) throw new Error("PROJECTION_DIVERGENCE");
      await repo.checkpoint(
        command.scope,
        command.hash,
        command.key,
        command.operationId,
        "PROJECTION_CONVERGED",
        now,
      );
      const response = singleEnvelope(canonical, context.requestId, now, noOp);
      await finish(repo, command, 200, canonical.version, response, now);
      await repo.markOperation(command.operationId, commentId, "COMPLETE", now);
      await repo.clearClaim(commentId, command.operationId);
      res.set("etag", `"v${String(canonical.version)}"`).json(response);
    } catch (error) {
      next(map(error));
    }
  };
  router.patch("/api/v1/comments/:commentId", mutate("PATCH"));
  router.delete("/api/v1/comments/:commentId", mutate("DELETE"));
  return router;
}
interface Command {
  scope: string;
  hash: number;
  key: string;
  operationId: string;
  resourceId: string;
  fingerprint: string;
  replay?: { status: number; version: number; body: string };
}
async function begin(
  repo: InteractionRepository,
  secret: string,
  api: string,
  actorId: string,
  resource: string,
  idempotencyKey: string,
  input: object,
  stableResource: string | undefined,
): Promise<Command> {
  const scope = `${api}:${actorId}:${resource}`,
    hash = keyHash(secret, idempotencyKey),
    fingerprint = checksum(secret, input);
  let receipt = await repo.receipt(scope, hash, idempotencyKey);
  if (!receipt) {
    const operationId = randomUUID(),
      resourceId = stableResource ?? randomUUID();
    if (await repo.reserve(scope, hash, idempotencyKey, operationId, resourceId, fingerprint, new Date()))
      return { scope, hash, key: idempotencyKey, operationId, resourceId, fingerprint };
    receipt = await repo.receipt(scope, hash, idempotencyKey);
  }
  if (!receipt) throw new Error("RECEIPT_AMBIGUOUS");
  if (receipt.fingerprint !== fingerprint)
    throw new AppError("IDEMPOTENCY_CONFLICT", 409, "Idempotency key conflict");
  if (receipt.status === "COMPLETE" && receipt.body)
    return {
      scope,
      hash,
      key: idempotencyKey,
      operationId: receipt.operationId,
      resourceId: receipt.resourceId,
      fingerprint,
      replay: { status: receipt.responseStatus, version: receipt.resultVersion, body: receipt.body },
    };
  return {
    scope,
    hash,
    key: idempotencyKey,
    operationId: receipt.operationId,
    resourceId: receipt.resourceId,
    fingerprint,
  };
}
async function finish(
  repo: InteractionRepository,
  c: Command,
  status: number,
  version: number,
  response: object,
  now: Date,
) {
  const raw = JSON.stringify(response);
  await repo.complete(
    c.scope,
    c.hash,
    c.key,
    c.operationId,
    status,
    version,
    raw,
    checksum("response-checksum", response),
    now,
  );
}
function sendReplay(res: Response, replay: { status: number; version: number; body: string }) {
  return res
    .set("etag", `"v${String(replay.version)}"`)
    .status(replay.status)
    .type("application/json")
    .send(replay.body);
}
function checksum(secret: string, value: object) {
  return createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex");
}
function keyHash(secret: string, value: string) {
  const byte = createHmac("sha256", secret).update(value).digest()[0] ?? 0;
  return byte > 127 ? byte - 256 : byte;
}
function sameCreate(a: Comment, b: Comment) {
  return (
    a.commentId === b.commentId &&
    a.resourceType === b.resourceType &&
    a.resourceId === b.resourceId &&
    a.parentId === b.parentId &&
    a.authorId === b.authorId &&
    a.body === b.body &&
    a.state === "ACTIVE" &&
    a.version === 1
  );
}
function sameProjection(a: Comment, b: Comment) {
  return (
    a.commentId === b.commentId &&
    a.resourceType === b.resourceType &&
    a.resourceId === b.resourceId &&
    a.parentId === b.parentId &&
    a.authorId === b.authorId &&
    a.body === b.body &&
    a.state === b.state &&
    a.version === b.version
  );
}
function isClaimedBy(c: Comment, op: string, expected: number, sum: string) {
  return (
    c.pendingOperationId === op && c.pendingExpectedVersion === expected && c.pendingContentChecksum === sum
  );
}
function isCommittedBy(c: Comment, op: string, expected: number, sum: string) {
  return c.version === expected + 1 && isClaimedBy(c, op, expected, sum);
}
function singleEnvelope(value: Comment, requestId: string, now: Date, noOp = false) {
  return {
    data: json(value),
    meta: { requestId, timestamp: now.toISOString(), ...(noOp ? { noOp: true } : {}) },
  };
}
function listEnvelope(
  values: Comment[],
  requestId: string,
  limit: number,
  hasMore: boolean,
  nextCursor: string | null,
) {
  return {
    data: values.map(json),
    meta: { requestId, timestamp: new Date().toISOString(), page: { nextCursor, hasMore, limit } },
  };
}
function parseLimit(value: unknown) {
  const parsed = value === undefined ? 20 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100)
    throw new AppError("INVALID_QUERY", 400, "Invalid limit");
  return parsed;
}
function addDays(value: string, amount: number) {
  const d = new Date(`${value}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return day(d);
}
function ctx() {
  const value = currentRequestContext();
  if (!value) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return value;
}
function header(req: Request, name: string) {
  const values = req.rawHeaders.flatMap((value, index) =>
    index % 2 === 0 && value.toLowerCase() === name ? [req.rawHeaders[index + 1] ?? ""] : [],
  );
  if (values.length !== 1 || !values[0])
    throw new AppError(
      name === "idempotency-key" ? "INVALID_IDEMPOTENCY_KEY" : "INVALID_ACCESS_TOKEN",
      name === "idempotency-key" ? 400 : 401,
      "Required header is missing",
    );
  return values[0];
}
function optional(req: Request) {
  return req.rawHeaders.some((value, index) => index % 2 === 0 && value.toLowerCase() === "x-actor-context")
    ? header(req, "x-actor-context")
    : undefined;
}
function targetActor(req: Request, type: ResourceType) {
  if (type === "CLASS") {
    const value = req.header("x-classroom-actor-context");
    if (value) return value;
  }
  return optional(req);
}
async function actor(req: Request, verify: (token: string) => Promise<ActorContext>, correlationId: string) {
  let value;
  try {
    value = await verify(header(req, "x-actor-context"));
  } catch {
    throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid authentication");
  }
  if (value.correlationId !== correlationId)
    throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid authentication");
  return value;
}
function key(req: Request) {
  const value = header(req, "idempotency-key");
  if (value.length > 128 || !/^[!-~]+$/u.test(value))
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "Invalid Idempotency-Key");
  return value;
}
function match(req: Request) {
  const value = req.header("if-match"),
    parsed = value ? /^"v([1-9][0-9]*)"$/u.exec(value) : null;
  if (!parsed) throw new AppError("INVALID_PRECONDITION", 400, "Invalid If-Match");
  return Number(parsed[1]);
}
function notFound() {
  return new AppError("RESOURCE_NOT_FOUND", 404, "Resource not found");
}
function map(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) return new AppError("INVALID_REQUEST", 422, "Invalid request");
  if (error instanceof Error && error.message === "INVALID_COMMENT_BODY")
    return new AppError("INVALID_COMMENT_BODY", 422, "Invalid comment body");
  return new AppError("INTERACTION_UNAVAILABLE", 503, "Interaction unavailable", true);
}
