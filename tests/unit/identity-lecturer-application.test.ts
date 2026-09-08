import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApplicationService } from "../../apps/identity-service/src/lecturer-application/service.js";
import {
  applicationBodySchema,
  type Application,
  type Command,
} from "../../apps/identity-service/src/lecturer-application/model.js";
import type { ApplicationRepository } from "../../apps/identity-service/src/lecturer-application/repository.js";
import type { IdentityAdminRepository } from "../../apps/identity-service/src/admin/repository.js";
import type { IdentityRegistrationRepository } from "../../apps/identity-service/src/registration/repository.js";
import type { ProtectedIdentityRequestValidator } from "../../apps/identity-service/src/profile/validator.js";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { AdminUser } from "../../apps/identity-service/src/admin/model.js";
import type { EventEnvelope } from "../../packages/contracts/src/index.js";
const body = {
  professionalTitle: "Lecturer",
  institution: "University",
  teachingArea: "Databases",
  motivation: "I want to teach database systems.",
};
function fixture() {
  const student = randomUUID(),
    admin = randomUUID(),
    apps = new Map<string, Application>(),
    commands = new Map<string, Command>(),
    intents: Command[] = [],
    locators = new Map<string, string>(),
    pending = new Set<string>(),
    events = new Map<string, EventEnvelope>();
  const user: { -readonly [K in keyof AdminUser]: AdminUser[K] } = {
    userId: student,
    displayName: "Applicant",
    emailMasked: "a***@example.test",
    normalizedEmail: "applicant@example.test",
    role: "STUDENT",
    status: "ACTIVE",
    lecturerVerified: false,
    tokenVersion: 1,
    credentialVersion: 1,
    securityOperationId: null,
    profileVersion: 1,
    createdAt: new Date("2026-09-07"),
    updatedAt: new Date("2026-09-07"),
    shard: 0,
  };
  let marker: string | null = null,
    roleWrites = 0,
    fault = "",
    fired = false;
  const hit = (stage: string) => {
    if (stage === fault && !fired) {
      fired = true;
      throw Error("injected crash");
    }
  };
  const copy = <T>(v: T): T => structuredClone(v);
  const store = {
    application: async (id: string) => copy(apps.get(id)),
    locate: async (id: string) => locators.get(id),
    command: async (scope: string, key: string) => copy(commands.get(scope + key)),
    intent: async (c: Command) => {
      intents.push(copy(c));
      hit("intent");
    },
    reserve: async (c: Command) => {
      if (!commands.has(c.scope + c.key)) commands.set(c.scope + c.key, copy(c));
      hit("reserve");
      return copy(commands.get(c.scope + c.key)) as Command;
    },
    finish: async (c: Command) => {
      commands.set(c.scope + c.key, copy(c));
      hit("finish");
    },
    insert: async (a: Application) => {
      if (!apps.has(a.applicantId)) apps.set(a.applicantId, copy(a));
      hit("insert");
      return copy(apps.get(a.applicantId));
    },
    locator: async (a: Application) => {
      locators.set(a.applicationId, a.applicantId);
      hit("locator");
    },
    pending: async (a: Application) => {
      pending.add(a.applicationId);
      hit("pending");
    },
    removePending: async (a: Application) => {
      pending.delete(a.applicationId);
      hit("cleanup");
    },
    claim: async (c: Command) => {
      const a = apps.get(c.applicantId);
      if (a?.status === "SUBMITTED" && !a.reviewOperationId) a.reviewOperationId = c.operationId;
      hit("claim");
      return copy(a);
    },
    releaseFailedClaim: async (c: Command) => {
      const a = apps.get(c.applicantId);
      if (a?.status === "SUBMITTED" && a.reviewOperationId === c.operationId) a.reviewOperationId = null;
    },
    terminal: async (c: Command) => {
      const a = apps.get(c.applicantId);
      if (!a || a.reviewOperationId !== c.operationId) throw Error();
      a.status = c.kind === "APPROVE" ? "APPROVED" : "REJECTED";
      a.version = 2;
      a.reviewerId = c.actorId;
      a.decision = c.kind === "APPROVE" ? "APPROVE" : "REJECT";
      a.decidedAt = c.createdAt;
      hit("terminal");
      return copy(a);
    },
    promote: async (c: Command) => {
      if (
        user.role === "STUDENT" &&
        user.status === "ACTIVE" &&
        user.tokenVersion === c.expectedUser?.tokenVersion
      ) {
        user.role = "LECTURER";
        user.tokenVersion++;
        user.securityOperationId = c.operationId;
        user.updatedAt = new Date(c.createdAt);
        roleWrites++;
      }
      hit("role");
    },
  };
  const users = {
    getUser: async () => copy(user),
    getCredential: async () => ({ securityOperationId: marker }),
    synchronizeCredentialMarker: async (input: { operationId: string }) => {
      marker = input.operationId;
      hit("marker");
      return true;
    },
    removeProjection: async () => true,
    insertProjection: async () => {
      hit("projection");
      return true;
    },
  };
  const outbox = {
    prepareOutbox: async (event: EventEnvelope) => {
      events.set(event.eventId, event);
      hit("audit");
      return {};
    },
    markOutboxReady: async () => undefined,
  };
  const actor = (isAdmin = false): ActorContext => ({
    userId: isAdmin ? admin : student,
    roles: [isAdmin ? "ADMIN" : user.role],
    sessionId: randomUUID(),
    tokenVersion: isAdmin ? 1 : user.tokenVersion,
    correlationId: randomUUID(),
    issuedAt: 1,
    expiresAt: 9999999999,
  });
  const validator = {
    validate: async (a: ActorContext) => {
      if (a.userId === admin) return { user: { ...user, userId: admin, role: "ADMIN" } };
      if (a.tokenVersion !== user.tokenVersion || user.status !== "ACTIVE") throw Error("stale");
      return { user: copy(user) };
    },
  };
  const service = new ApplicationService(
    store as unknown as ApplicationRepository,
    users as unknown as IdentityAdminRepository,
    outbox as unknown as IdentityRegistrationRepository,
    validator as unknown as ProtectedIdentityRequestValidator,
    "x".repeat(32),
  );
  async function repair() {
    for (const c of intents) {
      const current = await store.reserve(c);
      await service.resume(current).catch(() => undefined);
    }
  }
  return {
    service,
    actor,
    user,
    apps,
    commands,
    intents,
    events,
    pending,
    repair,
    roleWrites: () => roleWrites,
    setFault: (stage: string) => {
      fault = stage;
      fired = false;
    },
    setMarker: (m: string) => {
      marker = m;
    },
    marker: () => marker,
  };
}
describe("P12.2B Lecturer application", () => {
  it("normalizes NFC and counts code points, rejects role injection", () => {
    expect(applicationBodySchema.parse({ ...body, institution: "  e\u0301  " })).toMatchObject({
      institution: "é",
    });
    expect(
      applicationBodySchema.parse({ ...body, professionalTitle: "😀".repeat(120) }).professionalTitle,
    ).toHaveLength(240);
    expect(() => applicationBodySchema.parse({ ...body, role: "LECTURER" })).toThrow();
  });
  it("submission grants no privilege and has historical replay after approval", async () => {
    const f = fixture(),
      a = f.actor(),
      result = await f.service.submit(a, body, "key", randomUUID());
    expect(f.user).toMatchObject({
      role: "STUDENT",
      status: "ACTIVE",
      tokenVersion: 1,
      lecturerVerified: false,
    });
    await f.service.decide(f.actor(true), result.applicationId, "APPROVE", "decision", randomUUID());
    expect(f.user).toMatchObject({ role: "LECTURER", lecturerVerified: false, tokenVersion: 2 });
    expect(await f.service.submit(f.actor(), body, "key", randomUUID())).toEqual(result);
    expect(f.roleWrites()).toBe(1);
    expect((await f.service.mine(f.actor()))?.result).toBe("APPROVED_AWAITING_VERIFICATION");
  });
  it("same key changed body and different key conflict", async () => {
    const f = fixture();
    await f.service.submit(f.actor(), body, "key", randomUUID());
    await expect(
      f.service.submit(f.actor(), { ...body, motivation: body.motivation + "!" }, "key", randomUUID()),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(f.service.submit(f.actor(), body, "another", randomUUID())).rejects.toMatchObject({
      code: "APPLICATION_EXISTS",
    });
    expect(f.apps.size).toBe(1);
  });
  for (const stage of ["intent", "reserve", "insert", "locator", "pending", "audit", "finish"])
    it(`submission recovers after ${stage}`, async () => {
      const f = fixture();
      f.setFault(stage);
      await f.service.submit(f.actor(), body, "key", randomUUID()).catch(() => undefined);
      await f.repair();
      const result = await f.service.submit(f.actor(), body, "key", randomUUID());
      expect(result.status).toBe("SUBMITTED");
      expect(f.apps.size).toBe(1);
      expect(f.events.size).toBe(1);
      expect(f.user.role).toBe("STUDENT");
    });
  for (const decision of ["APPROVE", "REJECT"] as const)
    for (const stage of decision === "APPROVE"
      ? [
          "intent",
          "reserve",
          "claim",
          "role",
          "marker",
          "projection",
          "terminal",
          "cleanup",
          "audit",
          "finish",
        ]
      : ["intent", "reserve", "claim", "terminal", "cleanup", "audit", "finish"])
      it(`${decision} recovers after ${stage}`, async () => {
        const f = fixture(),
          a = await f.service.submit(f.actor(), body, "submit", randomUUID());
        f.setFault(stage);
        await f.service
          .decide(f.actor(true), a.applicationId, decision, "decision", randomUUID())
          .catch(() => undefined);
        await f.repair();
        const result = await f.service.decide(
          f.actor(true),
          a.applicationId,
          decision,
          "decision",
          randomUUID(),
        );
        expect(result.status).toBe(decision === "APPROVE" ? "APPROVED" : "REJECTED");
        expect(f.roleWrites()).toBe(decision === "APPROVE" ? 1 : 0);
        expect(f.pending.size).toBe(0);
        expect(f.events.size).toBe(2);
      });
  it("approve versus reject elects only one winner", async () => {
    const f = fixture(),
      a = await f.service.submit(f.actor(), body, "submit", randomUUID());
    const result = await Promise.allSettled(
      ["APPROVE", "REJECT"].map((d) =>
        f.service.decide(f.actor(true), a.applicationId, d as "APPROVE" | "REJECT", d, randomUUID()),
      ),
    );
    expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(f.roleWrites()).toBeLessThanOrEqual(1);
  });
  it("reject replay leaves Student security unchanged and changed decision conflicts", async () => {
    const f = fixture(),
      a = await f.service.submit(f.actor(), body, "submit", randomUUID()),
      before = structuredClone(f.user),
      admin = f.actor(true),
      r = await f.service.decide(admin, a.applicationId, "REJECT", "key", randomUUID());
    expect(await f.service.decide(admin, a.applicationId, "REJECT", "key", randomUUID())).toEqual(r);
    expect(f.user).toEqual(before);
    await expect(
      f.service.decide(admin, a.applicationId, "APPROVE", "key", randomUUID()),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("rejects non-admin review", async () => {
    const f = fixture(),
      a = await f.service.submit(f.actor(), body, "submit", randomUUID());
    await expect(
      f.service.decide(f.actor(), a.applicationId, "APPROVE", "key", randomUUID()),
    ).rejects.toMatchObject({ code: "ADMIN_ROLE_REQUIRED" });
  });
  it("does not promote a disabled applicant", async () => {
    const f = fixture(),
      a = await f.service.submit(f.actor(), body, "submit", randomUUID());
    f.user.status = "SUSPENDED";
    await expect(
      f.service.decide(f.actor(true), a.applicationId, "APPROVE", "key", randomUUID()),
    ).rejects.toMatchObject({ code: "APPLICATION_TARGET_INELIGIBLE" });
    expect(f.roleWrites()).toBe(0);
  });
  it("recovery after role CAS does not re-enable or overwrite a newer security marker", async () => {
    const f = fixture(),
      a = await f.service.submit(f.actor(), body, "submit", randomUUID());
    f.setFault("role");
    await f.service
      .decide(f.actor(true), a.applicationId, "APPROVE", "key", randomUUID())
      .catch(() => undefined);
    f.user.status = "SUSPENDED";
    f.user.tokenVersion++;
    f.user.securityOperationId = randomUUID();
    f.setMarker(f.user.securityOperationId);
    const marker = f.marker();
    await f.repair();
    expect(f.user.status).toBe("SUSPENDED");
    expect(f.marker()).toBe(marker);
    expect(f.roleWrites()).toBe(1);
    expect(f.apps.values().next().value?.status).toBe("APPROVED");
  });
  it("password epoch change after claim prevents stale promotion", async () => {
    const f = fixture(),
      a = await f.service.submit(f.actor(), body, "submit", randomUUID());
    f.setFault("claim");
    await f.service
      .decide(f.actor(true), a.applicationId, "APPROVE", "decision", randomUUID())
      .catch(() => undefined);
    f.user.tokenVersion++;
    f.user.credentialVersion++;
    f.user.securityOperationId = randomUUID();
    const before = structuredClone(f.user);
    await f.repair();
    expect(f.user).toEqual(before);
    expect(f.roleWrites()).toBe(0);
    await expect(
      f.service.decide(f.actor(true), a.applicationId, "APPROVE", "decision", randomUUID()),
    ).rejects.toMatchObject({ code: "APPLICATION_TARGET_INELIGIBLE" });
  });
  it("a failed promotion claim does not block a later rejection", async () => {
    const f = fixture(),
      a = await f.service.submit(f.actor(), body, "submit", randomUUID());
    f.setFault("claim");
    await f.service
      .decide(f.actor(true), a.applicationId, "APPROVE", "old", randomUUID())
      .catch(() => undefined);
    f.user.tokenVersion++;
    await f.repair();
    expect(
      await f.service.decide(f.actor(true), a.applicationId, "REJECT", "new", randomUUID()),
    ).toMatchObject({ status: "REJECTED" });
  });
  it("denies self review from canonical applicant identity", async () => {
    const f = fixture(),
      a = await f.service.submit(f.actor(), body, "submit", randomUUID()),
      admin = f.actor(true);
    const row = f.apps.get(f.user.userId);
    if (!row) throw Error();
    row.applicantId = admin.userId;
    await expect(
      f.service.decide(admin, a.applicationId, "APPROVE", "decision", randomUUID()),
    ).rejects.toMatchObject({ code: "ADMIN_ROLE_REQUIRED" });
  });
  it("audit contains no application text or credentials", async () => {
    const f = fixture();
    await f.service.submit(f.actor(), body, "key", randomUUID());
    for (const e of f.events.values()) {
      expect(JSON.stringify(e)).not.toContain(body.motivation);
      expect(JSON.stringify(e)).not.toContain(f.user.normalizedEmail);
      expect(Object.keys(e.data)).toEqual([
        "action",
        "actorType",
        "actorId",
        "targetType",
        "targetId",
        "outcome",
        "requestId",
      ]);
    }
  });
});
