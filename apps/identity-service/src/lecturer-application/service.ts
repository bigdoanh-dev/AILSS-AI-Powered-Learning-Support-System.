import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import type { ProtectedIdentityRequestValidator } from "../profile/validator.js";
import type { IdentityAdminRepository } from "../admin/repository.js";
import type { IdentityRegistrationRepository } from "../registration/repository.js";
import { derivedEventId } from "../registration/model.js";
import type { ApplicationRepository } from "./repository.js";
import {
  type Application,
  type ApplicationBody,
  type Command,
  type Decision,
  conflict,
  fingerprint,
  publicApplication,
  shardOf,
  unavailable,
} from "./model.js";

export class ApplicationService {
  constructor(
    readonly store: ApplicationRepository,
    readonly users: IdentityAdminRepository,
    readonly outbox: IdentityRegistrationRepository,
    readonly validator: ProtectedIdentityRequestValidator,
    readonly cursorSecret: string,
  ) {}
  async authorize(actor: ActorContext, admin = false) {
    const { user } = await this.validator.validate(actor);
    if (admin && user.role !== "ADMIN") throw new AppError("ADMIN_ROLE_REQUIRED", 403, "Admin required");
    return user;
  }
  async submit(actor: ActorContext, body: ApplicationBody, key: string, requestId: string) {
    const user = await this.authorize(actor);
    const scope = `lecturer-application:submit:${user.userId}`,
      fp = fingerprint(body);
    const previous = await this.store.command(scope, key);
    if (previous) {
      if (previous.fingerprint !== fp) throw conflict("IDEMPOTENCY_CONFLICT");
      return this.resume(previous);
    }
    if (user.role !== "STUDENT")
      throw new AppError("APPLICATION_TARGET_INELIGIBLE", 403, "An active Student account is required");
    const operationId = randomUUID(),
      applicationId = randomUUID(),
      createdAt = new Date().toISOString();
    const application: Application = {
      ...body,
      applicantId: user.userId,
      applicationId,
      displayNameSnapshot: user.displayName,
      emailMaskedSnapshot: user.emailMasked,
      status: "SUBMITTED",
      submittedAt: createdAt,
      decidedAt: null,
      reviewerId: null,
      decision: null,
      version: 1,
      submissionOperationId: operationId,
      reviewOperationId: null,
    };
    return this.start({
      operationId,
      applicationId,
      applicantId: user.userId,
      actorId: user.userId,
      correlationId: actor.correlationId,
      requestId,
      scope,
      key,
      fingerprint: fp,
      createdAt,
      kind: "SUBMIT",
      application,
    });
  }
  async mine(actor: ActorContext) {
    const user = await this.authorize(actor),
      a = await this.store.application(user.userId);
    return a ? publicApplication(a, user.role === "LECTURER" && user.lecturerVerified) : null;
  }
  async detail(actor: ActorContext, id: string) {
    await this.authorize(actor, true);
    const a = await this.byId(id),
      user = await this.users.getUser(a.applicantId);
    return {
      ...publicApplication(a, user?.role === "LECTURER" && user.lecturerVerified),
      applicantId: a.applicantId,
      reviewerId: a.reviewerId,
      decision: a.decision,
    };
  }
  async byId(id: string) {
    const applicant = await this.store.locate(id),
      a = applicant ? await this.store.application(applicant) : undefined;
    if (!a || a.applicationId !== id)
      throw new AppError("APPLICATION_NOT_FOUND", 404, "Application not found");
    return a;
  }
  async decide(actor: ActorContext, id: string, decision: Decision, key: string, requestId: string) {
    await this.authorize(actor, true);
    const a = await this.byId(id);
    if (a.applicantId === actor.userId)
      throw new AppError("ADMIN_ROLE_REQUIRED", 403, "Self-review is forbidden");
    const scope = `lecturer-application:decision:${actor.userId}:${id}`,
      fp = fingerprint({ actorId: actor.userId, applicationId: id, decision });
    const previous = await this.store.command(scope, key);
    if (previous) {
      if (previous.fingerprint !== fp) throw conflict("IDEMPOTENCY_CONFLICT");
      return this.resume(previous);
    }
    const user = await this.users.getUser(a.applicantId);
    if (!user) throw unavailable();
    if (decision === "APPROVE" && (user.role !== "STUDENT" || user.status !== "ACTIVE"))
      throw conflict("APPLICATION_TARGET_INELIGIBLE");
    return this.start({
      operationId: randomUUID(),
      applicationId: id,
      applicantId: a.applicantId,
      actorId: actor.userId,
      correlationId: actor.correlationId,
      requestId,
      scope,
      key,
      fingerprint: fp,
      createdAt: new Date().toISOString(),
      kind: decision,
      application: a,
      expectedUser: {
        tokenVersion: user.tokenVersion,
        credentialVersion: user.credentialVersion,
        securityOperationId: user.securityOperationId,
        updatedAt: user.updatedAt.toISOString(),
        profileVersion: user.profileVersion,
      },
    });
  }
  async start(c: Command) {
    await this.store.intent(c);
    const actual = await this.store.reserve(c);
    if (actual.fingerprint !== c.fingerprint) throw conflict("IDEMPOTENCY_CONFLICT");
    return this.resume(actual);
  }
  async resume(c: Command): Promise<NonNullable<Command["result"]>> {
    if (c.error) {
      if (c.error === "APPLICATION_TARGET_INELIGIBLE") await this.store.releaseFailedClaim(c);
      throw conflict(c.error);
    }
    if (c.result) return c.result;
    if (c.kind === "SUBMIT") {
      const a = await this.store.insert(c.application);
      if (!a) throw unavailable();
      if (a.applicationId !== c.applicationId) return this.fail(c, "APPLICATION_EXISTS");
      await this.store.locator(a);
      // Replaying an interrupted submit never resurrects a terminal queue entry logically.
      if (a.status === "SUBMITTED") await this.store.pending(a);
      await this.audit(c, "SUBMITTED", 1);
      c.result = { applicationId: c.applicationId, status: "SUBMITTED", submittedAt: c.createdAt };
    } else {
      let a = await this.store.claim(c);
      if (!a) throw unavailable();
      if (a.reviewOperationId !== c.operationId) return this.fail(c, "APPLICATION_DECISION_CONFLICT");
      if (c.kind === "APPROVE" && a.status === "SUBMITTED") await this.promote(c);
      a = await this.store.terminal(c);
      await this.store.removePending(a);
      await this.audit(c, a.status, 2);
      c.result = { applicationId: c.applicationId, status: a.status, decidedAt: c.createdAt };
    }
    await this.store.finish(c);
    return c.result;
  }
  async fail(c: Command, error: NonNullable<Command["error"]>): Promise<never> {
    c.error = error;
    await this.store.finish(c);
    if (error === "APPLICATION_TARGET_INELIGIBLE") await this.store.releaseFailedClaim(c);
    throw conflict(error);
  }
  async promote(c: Command) {
    const expected = c.expectedUser;
    if (!expected) throw unavailable();
    let user = await this.users.getUser(c.applicantId);
    if (!user) throw unavailable();
    if (user.role === "STUDENT") {
      if (
        user.status !== "ACTIVE" ||
        user.tokenVersion !== expected.tokenVersion ||
        user.credentialVersion !== expected.credentialVersion ||
        user.updatedAt.toISOString() !== expected.updatedAt
      )
        return this.fail(c, "APPLICATION_TARGET_INELIGIBLE");
      await this.store.promote(c);
      user = await this.users.getUser(c.applicantId);
      if (!user) throw unavailable();
    }
    if (user.role !== "LECTURER") return this.fail(c, "APPLICATION_TARGET_INELIGIBLE");
    if (user.tokenVersion < expected.tokenVersion + 1) throw unavailable();
    if (user.tokenVersion === expected.tokenVersion + 1) {
      if (user.securityOperationId !== c.operationId) throw unavailable();
      const credential = await this.users.getCredential(user.normalizedEmail);
      if (!credential) throw unavailable();
      if (credential.securityOperationId !== c.operationId)
        await this.users.synchronizeCredentialMarker({
          normalizedEmail: user.normalizedEmail,
          userId: user.userId,
          credentialVersion: expected.credentialVersion,
          expectedOperationId: expected.securityOperationId,
          operationId: c.operationId,
          updatedAt: new Date(c.createdAt),
        });
      const current = await this.users.getCredential(user.normalizedEmail);
      if (current?.securityOperationId !== c.operationId) throw unavailable();
    } // A newer epoch owns its credential marker; never roll it back.
    const shard = shardOf(user.userId);
    await this.users.removeProjection({
      ...user,
      role: "STUDENT",
      status: "ACTIVE",
      lecturerVerified: false,
      updatedAt: new Date(expected.updatedAt),
      profileVersion: expected.profileVersion,
      shard,
    });
    // Derive the projection from CURRENT state, including a concurrent disable.
    user = await this.users.getUser(c.applicantId);
    if (!user) throw unavailable();
    await this.users.insertProjection({ ...user, shard });
    const after = await this.users.getUser(c.applicantId);
    if (
      !after ||
      after.tokenVersion !== user.tokenVersion ||
      after.updatedAt.getTime() !== user.updatedAt.getTime()
    ) {
      await this.users.removeProjection({ ...user, shard });
      throw unavailable();
    }
  }
  async audit(c: Command, state: string, version: number) {
    const event: EventEnvelope = {
      specVersion: "1.0",
      eventId: derivedEventId(c.operationId, "lecturer-application-audit"),
      eventType: "system.audit.requested.v1",
      occurredAt: c.createdAt,
      producer: "identity-service",
      correlationId: c.correlationId,
      actor: { type: "USER", id: c.actorId },
      aggregate: { type: "LECTURER_APPLICATION", id: c.applicationId, version },
      data: {
        action: `LECTURER_APPLICATION_${state}`,
        actorType: "USER",
        actorId: c.actorId,
        targetType: "LECTURER_APPLICATION",
        targetId: c.applicationId,
        outcome: "SUCCESS",
        requestId: c.requestId,
      },
    };
    await this.outbox.markOutboxReady(await this.outbox.prepareOutbox(event));
  }
  async list(
    actor: ActorContext,
    input: { month: string; shard: number; limit: number; cursor?: string | undefined },
  ) {
    await this.authorize(actor, true);
    const binding = JSON.stringify([actor.userId, input.month, input.shard, input.limit]);
    let pageState: string | undefined;
    if (input.cursor) {
      try {
        const b = Buffer.from(input.cursor, "base64url");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          createHash("sha256").update(this.cursorSecret).digest(),
          b.subarray(0, 12),
        );
        decipher.setAAD(Buffer.from(binding));
        decipher.setAuthTag(b.subarray(12, 28));
        const p = JSON.parse(
          Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString(),
        ) as { state: string; expires: number };
        if (p.expires < Date.now() || typeof p.state !== "string") throw Error();
        pageState = p.state;
      } catch {
        throw new AppError("APPLICATION_INVALID_REQUEST", 422, "Invalid or expired cursor");
      }
    }
    const page = await this.store.page(input.month, input.shard, input.limit, pageState);
    const items = [];
    for (const row of page.rows) {
      const a = await this.store.application(String(row.get("applicant_id")));
      if (a?.status === "SUBMITTED")
        items.push({
          applicationId: a.applicationId,
          displayNameSnapshot: a.displayNameSnapshot,
          teachingArea: a.teachingArea,
          submittedAt: a.submittedAt,
        });
    }
    let nextCursor: string | null = null;
    if (page.pageState) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(this.cursorSecret).digest(), iv);
      cipher.setAAD(Buffer.from(binding));
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify({ state: page.pageState, expires: Date.now() + 900000 })),
        cipher.final(),
      ]);
      nextCursor = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
      if (nextCursor.length > 16384) throw unavailable();
    }
    return { items, nextCursor };
  }
}
