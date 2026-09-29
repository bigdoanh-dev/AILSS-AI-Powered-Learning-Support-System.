import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineStore } from "../src/offline-store";

vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 4 }));
vi.mock("expo-crypto", () => ({ getRandomBytes: (size: number) => new Uint8Array(size).fill(1) }));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: vi.fn(), deleteDatabaseAsync: vi.fn(async () => {}) }));

function memoryDatabase() {
  const exec: string[] = [];
  const cache = new Map<string, { payload_json: string; synced_at: string }>();
  const operations = new Map<string, Record<string, string | number | undefined>>();
  const keyOf = (userId: string, kind: string, courseId: string) => `${userId}|${kind}|${courseId}`;
  return {
    exec,
    cache,
    operations,
    async execAsync(sql: string) {
      exec.push(sql);
    },
    async runAsync(sql: string, ...params: (string | number | null)[]) {
      if (sql.includes("INSERT INTO cache_records")) {
        cache.set(keyOf(String(params[0]), String(params[1]), String(params[2])), {
          payload_json: String(params[3]),
          synced_at: String(params[4]),
        });
      } else if (sql.includes("DELETE FROM cache_records WHERE synced_at")) {
        const cutoff = Date.parse(String(params[0]));
        for (const [key, row] of cache) {
          const syncedAt = Date.parse(row.synced_at);
          if (!Number.isFinite(syncedAt) || syncedAt <= cutoff) cache.delete(key);
        }
      } else if (sql.includes("DELETE FROM cache_records")) {
        for (const key of cache.keys()) {
          const [userId, kind, courseId] = key.split("|");
          if (userId === params[0] && (params.length === 1 || (kind === params[1] && courseId === params[2])))
            cache.delete(key);
        }
      } else if (sql.includes("INSERT OR IGNORE INTO lesson_completion_queue")) {
        const [operationId, userId, courseId, resourceId, idempotencyKey, createdAt] = params;
        if (![...operations.values()].some((row) => row.idempotencyKey === idempotencyKey))
          operations.set(String(operationId), {
            operationId: String(operationId),
            userId: String(userId),
            courseId: String(courseId),
            resourceId: String(resourceId),
            idempotencyKey: String(idempotencyKey),
            createdAt: String(createdAt),
            attemptCount: 0,
            state: "PENDING",
          });
      } else if (sql.includes("UPDATE lesson_completion_queue")) {
        const [state, increment, errorCode, userId, operationId] = params;
        const row = operations.get(String(operationId));
        if (row && row.userId === userId) {
          row.state = String(state);
          row.attemptCount = Number(row.attemptCount) + Number(increment);
          row.lastErrorCode = errorCode == null ? undefined : String(errorCode);
        }
      } else if (sql.includes("DELETE FROM lesson_completion_queue")) {
        for (const [operationId, row] of operations)
          if (row.userId === params[0]) operations.delete(operationId);
      }
      return {};
    },
    async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null> {
      if (sql.includes("PRAGMA cipher_version")) return { cipher_version: "4.7.0" } as T;
      if (sql.includes("PRAGMA user_version")) return { user_version: 0 } as T;
      if (sql.includes("SELECT 1 AS found"))
        return (
          [...cache.keys()].some((key) => key.startsWith(`${params[0]}|`)) ? { found: 1 } : null
        ) as T | null;
      if (sql.includes("FROM cache_records")) {
        return (cache.get(keyOf(String(params[0]), String(params[1]), String(params[2]))) ??
          null) as T | null;
      }
      if (sql.includes("FROM lesson_completion_queue")) {
        const rows = [...operations.values()];
        const row = sql.includes("OR idempotency_key")
          ? rows.find((value) => value.operationId === params[0] || value.idempotencyKey === params[1])
          : rows
              .filter((value) => value.userId === params[0] && value.resourceId === params[1])
              .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
        return (row ?? null) as T | null;
      }
      return null;
    },
    async getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]> {
      if (!sql.includes("FROM lesson_completion_queue")) return [];
      const [userId, ...states] = params;
      return [...operations.values()]
        .filter((row) => row.userId === userId && states.includes(row.state ?? null))
        .map((row) => ({ ...row })) as T[];
    },
  };
}

describe("SQLCipher offline store", () => {
  let db: ReturnType<typeof memoryDatabase>;
  let secrets: { getItemAsync: ReturnType<typeof vi.fn>; setItemAsync: ReturnType<typeof vi.fn> };
  let store: OfflineStore;
  beforeEach(() => {
    db = memoryDatabase();
    let key: string | null = null;
    secrets = {
      getItemAsync: vi.fn(async () => key),
      setItemAsync: vi.fn(async (_name: string, value: string) => {
        key = value;
      }),
    };
    store = new OfflineStore(
      "research_local",
      async () => db as never,
      secrets as never,
      () => "a".repeat(64),
    );
  });

  it("applies a device-keyed SQLCipher key before reading the schema and migrates schema version 1", async () => {
    await store.hasUserData("student-1");
    expect(secrets.setItemAsync).toHaveBeenCalledWith(
      "ailss.offline.key.research_local",
      "a".repeat(64),
      expect.anything(),
    );
    expect(db.exec[0]).toContain(`PRAGMA key = "x'${"a".repeat(64)}'"`);
    expect(db.exec[0]).toContain("foreign_keys = ON");
    expect(db.exec[1]).toContain("CREATE TABLE cache_records");
    expect(db.exec[1]).toContain("CREATE TABLE lesson_completion_queue");
    expect(db.exec[1]).toContain("PRAGMA user_version = 1");
    expect(db.exec[2]).toContain("cache_records_synced_at_idx");
  });

  it("purges expired cache deterministically while retaining fresh snapshots", async () => {
    await store.hasUserData("student-1");
    db.cache.set("student-1|COURSES|expired-course", {
      payload_json: "[]",
      synced_at: "2026-08-22T00:00:00.000Z",
    });
    db.cache.set("student-1|MASTERY|fresh-course", {
      payload_json: "[]",
      synced_at: "2026-08-25T00:00:00.000Z",
    });

    await store.purgeExpiredCache(new Date("2026-09-23T00:00:00.000Z"));

    expect(db.cache.has("student-1|COURSES|expired-course")).toBe(false);
    expect(db.cache.has("student-1|MASTERY|fresh-course")).toBe(true);
  });

  it("stores user-scoped snapshots and a durable idempotent completion queue", async () => {
    const syncedAt = await store.writeCache("student-1", "MASTERY", "course-1", [{ conceptId: "c1" }]);
    expect(await store.readCache("student-1", "MASTERY", "course-1")).toEqual({
      value: [{ conceptId: "c1" }],
      syncedAt,
    });
    expect(await store.readCache("student-2", "MASTERY", "course-1")).toBeNull();

    const operation = {
      operationId: "op-1",
      userId: "student-1",
      courseId: "course-1",
      resourceId: "lesson-1",
      idempotencyKey: "idem-1",
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    const first = await store.enqueueLessonCompletion(operation);
    const repeated = await store.enqueueLessonCompletion({ ...operation, operationId: "op-duplicate" });
    expect(first.operationId).toBe("op-1");
    expect(repeated.operationId).toBe("op-1");
    expect(await store.listQueueableCompletions("student-1")).toMatchObject([
      { operationId: "op-1", state: "PENDING", attemptCount: 0 },
    ]);
    const restartedStore = new OfflineStore(
      "research_local",
      async () => db as never,
      secrets as never,
      () => "b".repeat(64),
    );
    expect(await restartedStore.listQueueableCompletions("student-1")).toMatchObject([
      { operationId: "op-1", idempotencyKey: "idem-1", state: "PENDING" },
    ]);
    await store.setCompletionState("student-1", "op-1", "SYNCING", { incrementAttempt: true });
    expect(await store.listQueueableCompletions("student-1")).toMatchObject([
      { state: "SYNCING", attemptCount: 1 },
    ]);

    await store.clearUserData("student-1");
    expect(await store.readCache("student-1", "MASTERY", "course-1")).toBeNull();
    expect(await store.listQueueableCompletions("student-1")).toEqual([]);
  });
});
