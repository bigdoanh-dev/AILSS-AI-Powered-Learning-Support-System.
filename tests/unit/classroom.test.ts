import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import { ClassroomService } from "../../apps/classroom-service/src/service.js";
import {
  parseAnnouncement,
  parseClassCreate,
  parseClassJoin,
  parseClassPatch,
  type ClassroomClass,
  type CommandReceipt,
  type Membership,
} from "../../apps/classroom-service/src/model.js";
import type { ClassroomRepository } from "../../apps/classroom-service/src/repository.js";
import type { ClassroomClients } from "../../apps/classroom-service/src/clients.js";

describe("P7.15A Classroom core", () => {
  it("locks strict create, patch, join and announcement DTOs", () => {
    expect(parseClassCreate({ name: "  Private Lab  ", classKind: "PRIVATE" })).toMatchObject({
      name: "Private Lab",
      maxMembers: 10000,
    });
    expect(parseClassJoin({ code: " abcd23 " })).toEqual({ code: "ABCD23" });
    expect(() => parseClassCreate({ name: "Lab", classKind: "PRIVATE", state: "ACTIVE" })).toThrow();
    expect(() => parseClassPatch({})).toThrow();
    expect(() => parseClassPatch({ ownerLecturerId: randomUUID() })).toThrow();
    expect(() => parseAnnouncement({ title: "Hi", body: "x" })).toThrow();
  });

  it("creates one DRAFT class, emits one stable event and exact-replays", async () => {
    const owner = randomUUID(),
      store = new MemoryClassroom(),
      service = classroom(store, owner);
    const input = {
      actor: actor(owner, "LECTURER"),
      request: parseClassCreate({ name: "Private Lab", classKind: "PRIVATE" }),
      key: "create-key",
      requestId: randomUUID(),
    };
    const first = await service.create(input);
    expect(first.data).toMatchObject({ state: "ACTIVE", scheduleState: "DRAFT", version: 1 });
    expect(store.events).toHaveLength(1);
    const replay = await service.create({ ...input, requestId: randomUUID() });
    expect(replay).toMatchObject({ replayed: true, data: { classId: first.data.classId } });
    expect(store.events).toHaveLength(1);
    expect(store.classes).toHaveLength(1);
  });

  it("updates metadata once, preserves schedule version, and treats normalized no-op as no-op", async () => {
    const owner = randomUUID(),
      store = new MemoryClassroom(),
      service = classroom(store, owner);
    const created = await service.create({
      actor: actor(owner, "LECTURER"),
      request: parseClassCreate({ name: "Private Lab", classKind: "PRIVATE" }),
      key: "c",
      requestId: randomUUID(),
    });
    const classId = String(created.data.classId);
    const changed = await service.update({
      classId,
      actor: actor(owner, "LECTURER"),
      request: parseClassPatch({ name: "Revised Lab" }),
      key: "u",
      requestId: randomUUID(),
    });
    expect(changed.data).toMatchObject({ name: "Revised Lab", version: 2, scheduleVersion: 1 });
    const replay = await service.update({
      classId,
      actor: actor(owner, "LECTURER"),
      request: parseClassPatch({ name: "Revised Lab" }),
      key: "u",
      requestId: randomUUID(),
    });
    expect(replay).toMatchObject({ replayed: true, data: { version: 2 } });
    const noOp = await service.update({
      classId,
      actor: actor(owner, "LECTURER"),
      request: parseClassPatch({ name: "Revised Lab" }),
      key: "noop",
      requestId: randomUUID(),
    });
    expect(noOp).toMatchObject({ noOp: true, data: { version: 2 } });
  });

  it("allows PRIVATE DRAFT join once but denies LIVE_COHORT join-code activation", async () => {
    const owner = randomUUID(),
      student = randomUUID(),
      store = new MemoryClassroom(),
      service = classroom(store, owner);
    const created = await service.create({
      actor: actor(owner, "LECTURER"),
      request: parseClassCreate({ name: "Private Lab", classKind: "PRIVATE" }),
      key: "private",
      requestId: randomUUID(),
    });
    const joined = await service.join({
      actor: actor(student, "STUDENT"),
      request: { code: String(created.data.joinCode) },
      key: "join",
      requestId: randomUUID(),
    });
    expect(joined.data).toMatchObject({ studentId: student, state: "ACTIVE", source: "JOIN_CODE" });
    expect(store.events.map((event) => event.eventType)).toContain("classroom.student.joined.v1");
    const live = await service.create({
      actor: actor(owner, "LECTURER"),
      request: parseClassCreate({ name: "Live Cohort", classKind: "LIVE_COHORT" }),
      key: "live",
      requestId: randomUUID(),
    });
    await expect(
      service.join({
        actor: actor(randomUUID(), "STUDENT"),
        request: { code: String(live.data.joinCode) },
        key: "join-live",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LIVE_COHORT_JOIN_CODE_DENIED", status: 409 });
  });

  it("fails authoring closed when canonical Lecturer eligibility is absent", async () => {
    const owner = randomUUID(),
      store = new MemoryClassroom();
    const service = new ClassroomService(
      store as unknown as ClassroomRepository,
      {
        lecturer: async () => {
          throw new Error("identity unavailable");
        },
        course: async () => ({}),
      } as unknown as ClassroomClients,
      "secret",
    );
    await expect(
      service.create({
        actor: actor(owner, "LECTURER"),
        request: parseClassCreate({ name: "Private Lab", classKind: "PRIVATE" }),
        key: "x",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_SERVICE_UNAVAILABLE", status: 503 });
  });
});

function actor(userId: string, role: "LECTURER" | "STUDENT"): ActorContext {
  return {
    userId,
    roles: [role],
    sessionId: randomUUID(),
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: 1,
    expiresAt: 2,
  };
}
function classroom(store: MemoryClassroom, owner: string) {
  return new ClassroomService(
    store as unknown as ClassroomRepository,
    {
      lecturer: async (id: string) => {
        if (id !== owner) throw new Error("not eligible");
        return {};
      },
      course: async (courseId: string) => ({
        courseId,
        ownerLecturerId: owner,
        state: "PUBLISHED",
        recordVersion: 1,
      }),
    } as unknown as ClassroomClients,
    "secret",
  );
}

class MemoryClassroom {
  readonly classes: ClassroomClass[] = [];
  readonly memberships = new Map<string, Membership>();
  readonly codes = new Map<string, { classId: string; state: string; version: number }>();
  readonly commands = new Map<
    string,
    { operationId: string; resourceId: string; status: string; receipt: CommandReceipt }
  >();
  readonly events: { eventId: string; eventType: string }[] = [];
  key(scope: string, hash: number, key: string) {
    return `${scope}:${String(hash)}:${key}`;
  }
  async reserve(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resourceId: string,
    receipt: CommandReceipt,
  ) {
    const id = this.key(scope, hash, key);
    if (this.commands.has(id)) return false;
    this.commands.set(id, { operationId, resourceId, status: "IN_PROGRESS", receipt });
    return true;
  }
  async command(scope: string, hash: number, key: string) {
    return this.commands.get(this.key(scope, hash, key));
  }
  async checkpoint(scope: string, hash: number, key: string, _op: string, receipt: CommandReceipt) {
    const command = this.commands.get(this.key(scope, hash, key));
    if (command) command.receipt = receipt;
  }
  async complete(scope: string, hash: number, key: string, _op: string, receipt: CommandReceipt) {
    const command = this.commands.get(this.key(scope, hash, key));
    if (command) {
      command.status = "COMPLETE";
      command.receipt = receipt;
    }
  }
  async getClass(id: string) {
    return this.classes.find((value) => value.classId === id);
  }
  async createClass(value: ClassroomClass) {
    if (await this.getClass(value.classId)) return false;
    this.classes.push(value);
    return true;
  }
  async updateClass(old: ClassroomClass, next: ClassroomClass) {
    const index = this.classes.findIndex(
      (value) => value.classId === old.classId && value.version === old.version,
    );
    if (index < 0) return false;
    this.classes[index] = next;
    return true;
  }
  async claimCode(code: string, classId: string, version: number) {
    const old = this.codes.get(code);
    if (old) return old.classId === classId && old.version === version && old.state === "ACTIVE";
    this.codes.set(code, { classId, version, state: "ACTIVE" });
    return true;
  }
  async code(code: string) {
    return this.codes.get(code);
  }
  async retireCode(code: string) {
    const old = this.codes.get(code);
    if (old) old.state = "RETIRED";
  }
  async insertLecturer() {}
  async deleteLecturer() {}
  async prepareEvent(input: { eventId: string; eventType: string }) {
    if (!this.events.some((value) => value.eventId === input.eventId)) this.events.push(input);
  }
  async readyEvent() {}
  async membership(classId: string, studentId: string) {
    return this.memberships.get(`${classId}:${studentId}`);
  }
  async createMembership(value: Membership) {
    const key = `${value.classId}:${value.studentId}`;
    if (this.memberships.has(key)) return false;
    this.memberships.set(key, value);
    return true;
  }
  async syncMembership() {}
}
