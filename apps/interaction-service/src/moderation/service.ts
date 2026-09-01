/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-condition */
import { createHmac, randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { EligibilityClient } from "../eligibility.js";
import type { InteractionRepository } from "../repository.js";
import type { ReviewRepository } from "../reviews/repository.js";
import { reportDto, type ModerationAction, type Report, type TargetType } from "./model.js";
import type { ModerationRepository } from "./repository.js";

export class ModerationService {
  constructor(
    private reports: ModerationRepository,
    private comments: InteractionRepository,
    private reviews: ReviewRepository,
    private eligibility: EligibilityClient,
    private secret: string,
  ) {}
  async create(input: {
    targetType: TargetType;
    targetId: string;
    reason: string;
    key: string;
    actor: ActorContext;
    actorToken: string;
    correlationId: string;
    requestId: string;
  }) {
    const c = await this.begin("INT-09", input.actor.userId, "reports", input.key, {
      method: "POST",
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
    });
    if (c.replay) return c;
    await this.requireVisible(
      input.targetType,
      input.targetId,
      input.actor,
      input.actorToken,
      input.correlationId,
    );
    const now = new Date(),
      value: Report = {
        reportId: c.resourceId,
        reporterId: input.actor.userId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        state: "OPEN",
        decision: null,
        moderatorId: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    if (!(await this.reports.create(value))) {
      const old = await this.reports.get(value.reportId);
      if (!old || old.reporterId !== value.reporterId || old.targetId !== value.targetId)
        throw new Error("REPORT_CREATE_CONFLICT");
      value.createdAt = old.createdAt;
      value.updatedAt = old.updatedAt;
    }
    await this.reports.project(value);
    await this.reports.includeDay(day(value.createdAt), now);
    await this.reports.prepareEvent(
      value.reportId,
      "interaction.report.created.v1",
      value,
      input.correlationId,
      { reportId: value.reportId, targetType: value.targetType, targetId: value.targetId },
    );
    const response = envelope(value, input.requestId);
    await this.finish(c, 201, 1, response);
    return { status: 201, version: 1, body: JSON.stringify(response) };
  }
  async list(input: { actor: ActorContext; limit: number; cursor?: string; requestId: string }) {
    admin(input.actor);
    const bounds = await this.reports.bounds();
    if (!bounds) return listEnvelope([], input.requestId, input.limit, false, null);
    const cursor = input.cursor
        ? decode(this.secret, input.cursor, input.limit)
        : { day: bounds.earliest, afterAt: "", afterId: "" },
      items: Report[] = [];
    let current = cursor.day,
      afterAt = cursor.afterAt,
      afterId = cursor.afterId,
      lastDay = current,
      scannedDays = 0;
    while (current <= bounds.latest && items.length < input.limit && scannedDays < 2) {
      scannedDays++;
      const candidates = await this.reports.list(current, afterAt, afterId);
      for (const candidate of candidates) {
        const canonical = await this.reports.get(candidate.reportId);
        if (canonical?.state === "OPEN") items.push(canonical);
        if (items.length === input.limit) break;
      }
      lastDay = current;
      if (items.length === input.limit) break;
      current = addDay(current);
      afterAt = "";
      afterId = "";
    }
    const last = items.at(-1),
      sameDayMore =
        !!last && (await this.reports.list(lastDay, last.createdAt.toISOString(), last.reportId)).length > 0,
      nextDay = sameDayMore ? lastDay : addDay(lastDay),
      hasMore = sameDayMore || nextDay <= bounds.latest,
      nextCursor = hasMore
        ? encode(this.secret, {
            limit: input.limit,
            day: sameDayMore ? lastDay : nextDay,
            afterAt: sameDayMore && last ? last.createdAt.toISOString() : "",
            afterId: sameDayMore && last ? last.reportId : "",
          })
        : null;
    return listEnvelope(items.map(reportDto), input.requestId, input.limit, hasMore, nextCursor);
  }
  async moderate(input: {
    reportId: string;
    action: ModerationAction;
    reason: string;
    expected: number;
    key: string;
    actor: ActorContext;
    proof: string;
    verifyProof: () => Promise<void>;
    correlationId: string;
    requestId: string;
  }) {
    admin(input.actor);
    await input.verifyProof();
    const c = await this.begin(
      "INT-11",
      input.actor.userId,
      input.reportId,
      input.key,
      {
        method: "POST",
        reportId: input.reportId,
        action: input.action,
        reason: input.reason,
        expected: input.expected,
      },
      input.reportId,
    );
    if (c.replay) return c;
    let report = await this.reports.get(input.reportId);
    if (!report) throw notFound("REPORT_NOT_FOUND");
    if (report.state !== "OPEN") throw conflict("REPORT_ALREADY_RESOLVED");
    if (report.version !== input.expected) throw conflict("VERSION_CONFLICT");
    if (!(await this.reports.claim(report.reportId, report.version, c.operationId)))
      throw conflict("REPORT_ALREADY_CLAIMED");
    const targetVersion = await this.mutateTarget(report, input.action, c.operationId);
    const now = new Date();
    if (
      !(await this.reports.resolve(
        report.reportId,
        report.version,
        c.operationId,
        input.action,
        input.actor.userId,
        now,
      ))
    ) {
      const recovered = await this.reports.get(report.reportId);
      if (recovered?.state !== "RESOLVED" || recovered.decision !== input.action)
        throw new Error("MODERATION_RESOLUTION_AMBIGUOUS");
    }
    report = await this.reports.get(report.reportId);
    if (!report) throw new Error("REPORT_READBACK_MISSING");
    await this.reports.moveResolved(report);
    await this.reports.prepareEvent(
      c.operationId,
      "interaction.content.moderated.v1",
      report,
      input.correlationId,
      {
        targetId: report.targetId,
        action: input.action,
        moderatorId: input.actor.userId,
        version: targetVersion,
      },
    );
    const response = envelope(report, input.requestId);
    await this.finish(c, 200, report.version, response);
    return { status: 200, version: report.version, body: JSON.stringify(response) };
  }
  private async requireVisible(
    type: TargetType,
    id: string,
    actor: ActorContext,
    actorToken: string,
    correlationId: string,
  ) {
    if (type === "COMMENT") {
      const c = await this.comments.get(id);
      if (
        !c ||
        (c.state !== "ACTIVE" && !(actor.roles.includes("ADMIN") && c.state === "HIDDEN_BY_MODERATOR")) ||
        (!actor.roles.includes("ADMIN") &&
          !(await this.eligibility.check(c.resourceType, c.resourceId, false, actorToken, correlationId)))
      )
        throw notFound("TARGET_NOT_FOUND");
      return;
    }
    const locator = await this.reviews.locator(id),
      review = locator ? await this.reviews.canonical(locator.studentId, locator.courseId) : undefined;
    if (
      !review ||
      review.reviewId !== id ||
      (review.state !== "ACTIVE" &&
        !(actor.roles.includes("ADMIN") && review.state === "HIDDEN_BY_MODERATOR")) ||
      (!actor.roles.includes("ADMIN") &&
        !(await this.eligibility.review(review.courseId, false, actorToken, correlationId)))
    )
      throw notFound("TARGET_NOT_FOUND");
  }
  private async mutateTarget(report: Report, action: ModerationAction, operationId: string) {
    if (action === "DISMISS" || action === "WARN") return 0;
    if (report.targetType === "COMMENT") {
      const old = await this.comments.get(report.targetId);
      if (!old) throw notFound("TARGET_NOT_FOUND");
      const desired = transition(old.state, action),
        value = { ...old, state: desired, version: old.version + 1, updatedAt: new Date() };
      if (!(await this.comments.claim(old.commentId, old.version, operationId, `MODERATE_${action}`, "")))
        throw conflict("TARGET_VERSION_CONFLICT");
      if (!(await this.comments.applyMutation(value, old.version, operationId)))
        throw conflict("TARGET_VERSION_CONFLICT");
      await this.comments.project(value);
      await this.comments.clearClaim(value.commentId, operationId);
      return value.version;
    }
    const locator = await this.reviews.locator(report.targetId),
      old = locator ? await this.reviews.canonical(locator.studentId, locator.courseId) : undefined;
    if (!old || old.reviewId !== report.targetId) throw notFound("TARGET_NOT_FOUND");
    const value = {
      ...old,
      state: transition(old.state, action),
      version: old.version + 1,
      updatedAt: new Date(),
    };
    if (!(await this.reviews.mutate(value, old.version, operationId)))
      throw conflict("TARGET_VERSION_CONFLICT");
    await this.reviews.locate(value);
    await this.reviews.project(value);
    await this.reviews.reconcile(value, operationId, value.updatedAt);
    return value.version;
  }
  private async begin(
    api: string,
    actor: string,
    resource: string,
    key: string,
    input: object,
    stable?: string,
  ) {
    const scope = `${api}:${actor}:${resource}`,
      hash = keyHash(this.secret, key),
      fingerprint = sum(this.secret, input);
    let r = await this.comments.receipt(scope, hash, key);
    if (!r) {
      const op = randomUUID(),
        id = stable ?? randomUUID();
      if (await this.comments.reserve(scope, hash, key, op, id, fingerprint, new Date()))
        return { scope, hash, key, operationId: op, resourceId: id };
      r = await this.comments.receipt(scope, hash, key);
    }
    if (!r) throw new Error("RECEIPT_AMBIGUOUS");
    if (r.fingerprint !== fingerprint) throw conflict("IDEMPOTENCY_CONFLICT");
    if (r.status === "COMPLETE" && r.body)
      return {
        scope,
        hash,
        key,
        operationId: r.operationId,
        resourceId: r.resourceId,
        replay: true,
        status: r.responseStatus,
        version: r.resultVersion,
        body: r.body,
      };
    return { scope, hash, key, operationId: r.operationId, resourceId: r.resourceId };
  }
  private async finish(c: any, status: number, version: number, response: object) {
    const raw = JSON.stringify(response);
    await this.comments.complete(
      c.scope,
      c.hash,
      c.key,
      c.operationId,
      status,
      version,
      raw,
      sum("response", response),
      new Date(),
    );
  }
}
function transition(state: string, action: ModerationAction): "ACTIVE" | "HIDDEN_BY_MODERATOR" {
  if (action === "HIDE" && state === "ACTIVE") return "HIDDEN_BY_MODERATOR";
  if (action === "RESTORE" && state === "HIDDEN_BY_MODERATOR") return "ACTIVE";
  if (state === "DELETED_BY_AUTHOR") throw conflict("AUTHOR_DELETED_NOT_RESTORABLE");
  throw conflict("INVALID_CONTENT_TRANSITION");
}
const admin = (a: ActorContext) => {
    if (!a.roles.includes("ADMIN")) throw new AppError("ADMIN_REQUIRED", 403, "Admin required");
  },
  conflict = (code: string) => new AppError(code, 409, code),
  notFound = (code: string) => new AppError(code, 404, "Resource not found"),
  day = (v: Date) => v.toISOString().slice(0, 10),
  addDay = (v: string) => {
    const x = new Date(`${v}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return day(x);
  },
  sum = (s: string, v: object) => createHmac("sha256", s).update(JSON.stringify(v)).digest("hex"),
  keyHash = (s: string, v: string) => {
    const b = createHmac("sha256", s).update(v).digest()[0] ?? 0;
    return b > 127 ? b - 256 : b;
  },
  envelope = (r: Report, requestId: string) => ({
    data: reportDto(r),
    meta: { requestId, timestamp: new Date().toISOString() },
  }),
  listEnvelope = (
    data: unknown[],
    requestId: string,
    limit: number,
    hasMore: boolean,
    nextCursor: string | null,
  ) => ({
    data,
    meta: { requestId, timestamp: new Date().toISOString(), page: { limit, hasMore, nextCursor } },
  });
function encode(secret: string, value: object) {
  const raw = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${raw}.${sum(secret, { raw })}`;
}
function decode(secret: string, value: string, limit: number) {
  const [raw, signature] = value.split(".");
  if (!raw || signature !== sum(secret, { raw })) throw new AppError("INVALID_CURSOR", 400, "Invalid cursor");
  const parsed = JSON.parse(Buffer.from(raw, "base64url").toString()) as {
    limit: number;
    day: string;
    afterAt: string;
    afterId: string;
  };
  if (parsed.limit !== limit) throw new AppError("INVALID_CURSOR", 400, "Invalid cursor");
  return parsed;
}
