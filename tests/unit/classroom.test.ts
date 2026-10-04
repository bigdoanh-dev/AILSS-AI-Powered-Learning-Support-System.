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
    expect(first.data.joinCode).toMatch(/^[A-Z2-9]{6}$/u);
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

  it("stores valid class images and closes an empty draft with idempotent deletion", async () => {
    const owner = randomUUID();
    const store = new MemoryClassroom();
    const service = classroom(store, owner);
    const created = await service.create({
      actor: actor(owner, "LECTURER"),
      request: parseClassCreate({ name: "Private Lab", classKind: "PRIVATE" }),
      key: "create-image",
      requestId: randomUUID(),
    });
    const classId = String(created.data.classId);
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y3MHVYAAAAASUVORK5CYII=";
    expect(() => parseClassPatch({ photoDataUrl: "data:image/png;base64,aGVsbG8=" })).toThrow();
    await service.update({
      classId,
      actor: actor(owner, "LECTURER"),
      request: parseClassPatch({ photoDataUrl: image, coverDataUrl: image }),
      key: "images",
      requestId: randomUUID(),
    });
    expect((await store.getClass(classId))?.photoDataUrl).toBe(image);
    const input = { classId, actor: actor(owner, "LECTURER"), key: "delete-image", requestId: randomUUID() };
    expect(await service.deleteClass(input)).toMatchObject({ data: { classId, deleted: true } });
    expect((await store.getClass(classId))?.state).toBe("CLOSED");
    expect(await service.deleteClass(input)).toMatchObject({ replayed: true });
  });

  it("refuses to delete a class with active students", async () => {
    const owner = randomUUID(),
      student = randomUUID(),
      store = new MemoryClassroom();
    const service = classroom(store, owner);
    const created = await service.create({
      actor: actor(owner, "LECTURER"),
      request: parseClassCreate({ name: "Private Lab", classKind: "PRIVATE" }),
      key: "create-members",
      requestId: randomUUID(),
    });
    await service.join({
      actor: actor(student, "STUDENT"),
      request: { code: String(created.data.joinCode) },
      key: "join-member",
      requestId: randomUUID(),
    });
    await expect(
      service.deleteClass({
        classId: String(created.data.classId),
        actor: actor(owner, "LECTURER"),
        key: "delete-members",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CLASS_DELETE_NOT_EMPTY", status: 409 });
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

  it("fans announcements out once to ACTIVE members and excludes the author", async () => {
    const owner = randomUUID(),
      studentA = randomUUID(),
      studentB = randomUUID(),
      store = new MemoryClassroom(),
      service = classroom(store, owner);
    const created = await service.create({
      actor: actor(owner, "LECTURER"),
      request: parseClassCreate({ name: "Private Lab", classKind: "PRIVATE" }),
      key: "fanout-class",
      requestId: randomUUID(),
    });
    for (const [key, studentId] of [
      ["join-a", studentA],
      ["join-b", studentB],
    ] as const)
      await service.join({
        actor: actor(studentId, "STUDENT"),
        request: { code: String(created.data.joinCode) },
        key,
        requestId: randomUUID(),
      });
    const input = {
      classId: String(created.data.classId),
      actor: actor(owner, "LECTURER"),
      request: parseAnnouncement({ title: "Lịch học", body: "Chi tiết nội bộ" }),
      key: "announcement",
      requestId: randomUUID(),
    };
    const first = await service.announce(input);
    const notifications = store.events.filter(
      (value) => value.eventType === "system.notification.requested.v1",
    );
    expect(notifications).toHaveLength(2);
    expect(notifications.map((value) => value.data?.recipientId).sort()).toEqual([studentA, studentB].sort());
    expect(notifications.every((value) => value.data?.recipientId !== owner)).toBe(true);
    expect(
      notifications.every((value) => value.data?.body === `Thông báo lớp mới: ${String(value.data?.title)}`),
    ).toBe(true);
    await service.announce({ ...input, requestId: randomUUID() });
    expect(
      store.events.filter((value) => value.eventType === "system.notification.requested.v1"),
    ).toHaveLength(2);
    expect(first.data.announcementId).toBeTruthy();
  });

  it("shows canonical learner profile, warns one learner, removes a join-code member, and permits rejoin", async () => {
    const owner = randomUUID(),
      studentId = randomUUID(),
      store = new MemoryClassroom();
    const service = classroom(store, owner);
    const created = await service.create({
      actor: actor(owner, "LECTURER"),
      request: parseClassCreate({ name: "Trường học A", classKind: "INSTITUTIONAL" }),
      key: "new-institutional-class",
      requestId: randomUUID(),
    });
    const classId = String(created.data.classId);
    await service.join({
      actor: actor(studentId, "STUDENT"),
      request: { code: String(created.data.joinCode) },
      key: "join-institutional-class",
      requestId: randomUUID(),
    });
    const member = (await service.roster(classId, actor(owner, "LECTURER"), randomUUID()))[0];
    expect(member).toMatchObject({
      studentId,
      displayName: "Học viên thử nghiệm",
      emailMasked: "h***@school.edu.vn",
    });
    const warning = await service.warnStudent({
      classId,
      studentId,
      actor: actor(owner, "LECTURER"),
      request: { reason: "Vui lòng cải thiện chuyên cần" },
      key: "first-warning",
      requestId: randomUUID(),
    });
    expect(warning.data.studentId).toBe(studentId);
    expect(
      store.events.find(
        (event) => event.data?.recipientId === studentId && event.data?.notificationType === "ACADEMIC",
      ),
    ).toBeDefined();
    const removal = {
      classId,
      studentId,
      actor: actor(owner, "LECTURER"),
      key: "remove-student",
      requestId: randomUUID(),
    };
    await service.removeStudent(removal);
    await expect(service.removeStudent({ ...removal, requestId: randomUUID() })).resolves.toMatchObject({
      replayed: true,
    });
    expect(await service.roster(classId, actor(owner, "LECTURER"), randomUUID())).toHaveLength(0);
    await expect(service.detail(classId, actor(studentId, "STUDENT"), randomUUID())).rejects.toMatchObject({
      status: 403,
    });
    await service.join({
      actor: actor(studentId, "STUDENT"),
      request: { code: String(created.data.joinCode) },
      key: "rejoin-institutional-class",
      requestId: randomUUID(),
    });
    expect(await service.roster(classId, actor(owner, "LECTURER"), randomUUID())).toHaveLength(1);
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
      student: async (userId: string) => ({
        userId,
        displayName: "Học viên thử nghiệm",
        emailMasked: "h***@school.edu.vn",
        createdAt: "2026-09-01T00:00:00.000Z",
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
  readonly events: { eventId: string; eventType: string; data?: Record<string, unknown> }[] = [];
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
  async closeClass(old: ClassroomClass, now: Date) {
    const current = await this.getClass(old.classId);
    if (!current || current.version !== old.version || current.state !== "ACTIVE") return false;
    this.classes[this.classes.indexOf(current)] = {
      ...current,
      state: "CLOSED",
      version: current.version + 1,
      updatedAt: now,
    };
    return true;
  }
  async hasActiveMembers(classId: string) {
    return (await this.roster(classId)).length > 0;
  }
  async listClassSessionIds() {
    return [];
  }
  async prepareEvent(input: { eventId: string; eventType: string; data?: Record<string, unknown> }) {
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
  async roster(classId: string) {
    return [...this.memberships.values()].filter(
      (value) => value.classId === classId && value.state === "ACTIVE",
    );
  }
  async removeMembership(value: Membership) {
    const key = `${value.classId}:${value.studentId}`;
    const current = this.memberships.get(key);
    if (!current || current.state !== "ACTIVE" || current.version !== value.version) return false;
    this.memberships.set(key, { ...current, state: "REMOVED", version: current.version + 1 });
    return true;
  }
  async removeMembershipProjections() {}
  async restoreRemovedMembership(previous: Membership, next: Membership) {
    const key = `${previous.classId}:${previous.studentId}`;
    const current = this.memberships.get(key);
    if (current?.state !== "REMOVED" || current.version !== previous.version) return false;
    this.memberships.set(key, next);
    return true;
  }
  async activeRecipientIds(classId: string) {
    return [...this.memberships.values()]
      .filter((value) => value.classId === classId && value.state === "ACTIVE")
      .map((value) => value.studentId);
  }
  async insertAnnouncement() {}
}
