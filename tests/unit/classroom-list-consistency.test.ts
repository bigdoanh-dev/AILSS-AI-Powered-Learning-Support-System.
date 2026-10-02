import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ClassroomRepository } from "../../apps/classroom-service/src/repository.js";
import { ClassroomService } from "../../apps/classroom-service/src/service.js";
import type { ClassroomClass, CommandReceipt } from "../../apps/classroom-service/src/model.js";
import type { ClassroomClients } from "../../apps/classroom-service/src/clients.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";

function classroom(owner = randomUUID()): ClassroomClass {
  return {
    classId: randomUUID(),
    ownerLecturerId: owner,
    name: "Linked demo",
    classKind: "INSTITUTIONAL",
    scheduleState: "DRAFT",
    scheduleVersion: 1,
    maxMembers: 20,
    state: "ACTIVE",
    activeCodeHash: "hash",
    version: 1,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
  };
}

describe("Classroom canonical lists and schedule projection", () => {
  it("returns each owned class once despite old timestamp rows, excluding closed/foreign classes", async () => {
    const owner = randomUUID();
    const current = classroom(owner),
      closed = { ...classroom(owner), state: "CLOSED" as const },
      foreign = classroom();
    const values = new Map([current, closed, foreign].map((value) => [value.classId, value]));
    const execute = vi.fn(async () =>
      [current, current, closed, foreign].map((value) => ({ class_id: value.classId })),
    );
    const repo = new ClassroomRepository({ execute } as unknown as CassandraClient);
    const get = vi.spyOn(repo, "getClass").mockImplementation(async (id) => values.get(id));
    await expect(repo.listLecturer(owner)).resolves.toEqual([current]);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("resolves duplicate student projections once and still checks active membership", async () => {
    const current = classroom(),
      removed = classroom();
    const execute = vi.fn(async () =>
      [current, current, removed].map((value) => ({ class_id: value.classId })),
    );
    const repo = new ClassroomRepository({ execute } as unknown as CassandraClient);
    vi.spyOn(repo, "getClass").mockImplementation(async (id) => (id === current.classId ? current : removed));
    const membership = vi
      .spyOn(repo, "membership")
      .mockImplementation(async (id) => ({ state: id === current.classId ? "ACTIVE" : "REMOVED" }) as never);
    await expect(repo.listStudent(randomUUID())).resolves.toEqual([current]);
    expect(membership).toHaveBeenCalledTimes(2);
  });

  it("moves the lecturer index when publishing and recovers its original timestamp after an interrupted write", async () => {
    let canonical = classroom();
    const old = canonical.updatedAt;
    const sessionId = randomUUID();
    const session = {
      sessionId,
      classId: canonical.classId,
      status: "DRAFT",
      scheduleVersion: 1,
      startAt: new Date("2026-10-09T02:00:00Z"),
      endAt: new Date("2026-10-09T03:00:00Z"),
    };
    let command: { operationId: string; status: string; receipt: CommandReceipt } | undefined;
    const indexes = new Set([old.toISOString()]);
    const remove = vi.fn(async (value: ClassroomClass) => {
      indexes.delete(value.updatedAt.toISOString());
    });
    const insert = vi.fn(async (value: ClassroomClass) => {
      indexes.add(value.updatedAt.toISOString());
    });
    insert.mockImplementationOnce(async () => {
      throw Error("projection interrupted");
    });
    const repo = {
      getClass: async () => canonical,
      reserve: async (
        _scope: string,
        _hash: number,
        _key: string,
        operationId: string,
        _id: string,
        receipt: CommandReceipt,
      ) => {
        command ||= { operationId, receipt, status: "IN_PROGRESS" };
      },
      command: async () => command,
      checkpoint: async (
        _scope: string,
        _hash: number,
        _key: string,
        _operation: string,
        receipt: CommandReceipt,
      ) => {
        command!.receipt = receipt;
      },
      hasActiveMembers: async () => false,
      listClassSessionIds: async () => [sessionId],
      getSession: async () => session,
      markSessionScheduled: async (_id: string, version: number) => {
        session.status = "SCHEDULED";
        session.scheduleVersion = version;
        return true;
      },
      updateSessionProjectionStatus: async () => {},
      publishSchedule: async (_value: ClassroomClass, version: number, now: Date) => {
        if (canonical.scheduleState === "PUBLISHED") return false;
        canonical = { ...canonical, scheduleState: "PUBLISHED", scheduleVersion: version, updatedAt: now };
        return true;
      },
      writeManifest: async () => {},
      deleteLecturer: remove,
      insertLecturer: insert,
      complete: async (
        _scope: string,
        _hash: number,
        _key: string,
        _operation: string,
        receipt: CommandReceipt,
      ) => {
        command!.receipt = receipt;
        command!.status = "COMPLETE";
      },
    };
    const service = new ClassroomService(
      repo as unknown as ClassroomRepository,
      { lecturer: async () => ({}) } as unknown as ClassroomClients,
      "test-secret",
    );
    const input = {
      classId: canonical.classId,
      actor: { userId: canonical.ownerLecturerId, roles: ["LECTURER"] } as ActorContext,
      key: "publish-linked",
      requestId: randomUUID(),
    };
    await expect(service.publishSchedule(input)).rejects.toThrow("projection interrupted");
    await expect(service.publishSchedule(input)).resolves.toMatchObject({
      data: { scheduleState: "PUBLISHED" },
    });
    expect(remove.mock.calls.every(([value]) => value.updatedAt.getTime() === old.getTime())).toBe(true);
    expect([...indexes]).toEqual([canonical.updatedAt.toISOString()]);
    const replay = await service.publishSchedule(input);
    expect(replay.replayed).toBe(true);
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
