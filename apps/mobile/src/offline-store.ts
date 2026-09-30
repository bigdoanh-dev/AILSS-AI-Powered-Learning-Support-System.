import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

export type CacheKind = "COURSES" | "MASTERY" | "STUDY_PLAN";
export type CompletionState =
  "PENDING" | "SYNCING" | "SYNCED" | "FAILED_RETRYABLE" | "FAILED_FINAL" | "CONFLICT";

export interface CachedValue<T> {
  value: T;
  syncedAt: string;
}

export interface LessonCompletionOperation {
  operationId: string;
  userId: string;
  courseId: string;
  resourceId: string;
  idempotencyKey: string;
  createdAt: string;
  attemptCount: number;
  state: CompletionState;
  lastErrorCode?: string;
}

type SqlValue = string | number | null;
interface Database {
  closeAsync?(): Promise<void>;
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
}
interface SecretStore {
  getItemAsync(key: string, options?: SecureStore.SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
}

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const schemaVersion = 1;
const cacheTtlMs = 30 * 24 * 60 * 60 * 1000;
const queueableStates: CompletionState[] = ["PENDING", "SYNCING", "FAILED_RETRYABLE"];

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertIdentity(value: string): void {
  if (!value || value.length > 256) throw new Error("INVALID_OFFLINE_SCOPE");
}

export class OfflineStore {
  private database?: Database;
  private initializing?: Promise<Database>;

  constructor(
    private readonly scope: string,
    private readonly openDatabase: (name: string) => Promise<Database> = (name) =>
      SQLite.openDatabaseAsync(name),
    private readonly secrets: Pick<SecretStore, "getItemAsync" | "setItemAsync"> = SecureStore,
    private readonly makeKey: () => string = () => hex(Crypto.getRandomBytes(32)),
    private readonly deleteDatabase: (name: string) => Promise<void> = (name) =>
      SQLite.deleteDatabaseAsync(name),
  ) {}

  private async db(): Promise<Database> {
    if (this.database) return this.database;
    if (this.initializing) return this.initializing;
    this.initializing = this.initialize().finally(() => {
      this.initializing = undefined;
    });
    this.database = await this.initializing;
    return this.database;
  }

  private async initialize(): Promise<Database> {
    const keyName = `ailss.offline.key.${this.scope}`;
    let key = await this.secrets.getItemAsync(keyName, secureOptions);
    if (!key) {
      key = this.makeKey();
      await this.secrets.setItemAsync(keyName, key, secureOptions);
    }
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("INVALID_OFFLINE_DATABASE_KEY");
    const databaseName = `ailss-offline-${this.scope}-v1.db`;
    const database = await this.openDatabase(databaseName);
    // Key material is generated hex, never user-controlled. Apply before any schema/data read.
    await database.execAsync(`PRAGMA key = "x'${key}'"; PRAGMA foreign_keys = ON;`);
    const cipher = await database.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version");
    if (!cipher?.cipher_version) {
      await database.closeAsync?.().catch(() => {});
      throw new Error("SQLCIPHER_REQUIRED_FOR_OFFLINE_STORAGE");
    }
    const version = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
    const currentVersion = Number(version?.user_version ?? 0);
    if (currentVersion > schemaVersion) throw new Error("OFFLINE_DATABASE_NEWER_THAN_APP");
    if (currentVersion < 1) {
      await database
        .execAsync(
          `
        BEGIN EXCLUSIVE;
        CREATE TABLE cache_records (
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('COURSES','MASTERY','STUDY_PLAN')),
          course_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          PRIMARY KEY (user_id, kind, course_id)
        );
        CREATE TABLE lesson_completion_queue (
          operation_id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          course_id TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL CHECK (state IN ('PENDING','SYNCING','SYNCED','FAILED_RETRYABLE','FAILED_FINAL','CONFLICT')),
          last_error_code TEXT
        );
        CREATE INDEX lesson_completion_user_state_idx ON lesson_completion_queue(user_id, state, created_at);
        PRAGMA user_version = 1;
        COMMIT;
      `,
        )
        .catch(async (error) => {
          await database.execAsync("ROLLBACK;").catch(() => {});
          throw error;
        });
    }
    await database.execAsync(
      "CREATE INDEX IF NOT EXISTS cache_records_synced_at_idx ON cache_records(synced_at);",
    );
    await this.purgeExpiredCacheFrom(database, new Date());
    // Remove the never-shipped plaintext database name used during early local development.
    await this.deleteDatabase(`ailss-offline-${this.scope}.db`).catch(() => {});
    return database;
  }

  private async purgeExpiredCacheFrom(database: Database, now: Date): Promise<void> {
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) throw new Error("INVALID_CACHE_PURGE_TIME");
    const cutoff = new Date(nowMs - cacheTtlMs).toISOString();
    await database.runAsync(
      "DELETE FROM cache_records WHERE synced_at <= ? OR julianday(synced_at) IS NULL",
      cutoff,
    );
  }

  async purgeExpiredCache(now = new Date()): Promise<void> {
    await this.purgeExpiredCacheFrom(await this.db(), now);
  }

  async writeCache<T>(userId: string, kind: CacheKind, courseId: string, value: T): Promise<string> {
    assertIdentity(userId);
    assertIdentity(courseId);
    const database = await this.db();
    await this.purgeExpiredCacheFrom(database, new Date());
    const syncedAt = new Date().toISOString();
    await database.runAsync(
      `INSERT INTO cache_records(user_id,kind,course_id,payload_json,synced_at)
       VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind,course_id) DO UPDATE SET payload_json=excluded.payload_json,synced_at=excluded.synced_at`,
      userId,
      kind,
      courseId,
      JSON.stringify(value),
      syncedAt,
    );
    return syncedAt;
  }

  async readCache<T>(userId: string, kind: CacheKind, courseId: string): Promise<CachedValue<T> | null> {
    assertIdentity(userId);
    assertIdentity(courseId);
    const database = await this.db();
    await this.purgeExpiredCacheFrom(database, new Date());
    const row = await database.getFirstAsync<{ payload_json: string; synced_at: string }>(
      "SELECT payload_json,synced_at FROM cache_records WHERE user_id=? AND kind=? AND course_id=?",
      userId,
      kind,
      courseId,
    );
    if (!row) return null;
    if (!Number.isFinite(Date.parse(row.synced_at)) || Date.now() - Date.parse(row.synced_at) > cacheTtlMs) {
      await (
        await this.db()
      ).runAsync(
        "DELETE FROM cache_records WHERE user_id=? AND kind=? AND course_id=?",
        userId,
        kind,
        courseId,
      );
      return null;
    }
    try {
      return { value: JSON.parse(row.payload_json) as T, syncedAt: row.synced_at };
    } catch {
      await (
        await this.db()
      ).runAsync(
        "DELETE FROM cache_records WHERE user_id=? AND kind=? AND course_id=?",
        userId,
        kind,
        courseId,
      );
      return null;
    }
  }

  async hasUserData(userId: string): Promise<boolean> {
    assertIdentity(userId);
    const database = await this.db();
    await this.purgeExpiredCacheFrom(database, new Date());
    const row = await database.getFirstAsync<{ found: number }>(
      "SELECT 1 AS found FROM cache_records WHERE user_id=? LIMIT 1",
      userId,
    );
    return row?.found === 1;
  }

  async deleteCache(userId: string, kind: CacheKind, courseId: string): Promise<void> {
    assertIdentity(userId);
    assertIdentity(courseId);
    await (
      await this.db()
    ).runAsync(
      "DELETE FROM cache_records WHERE user_id=? AND kind=? AND course_id=?",
      userId,
      kind,
      courseId,
    );
  }

  async clearUserData(userId: string): Promise<void> {
    assertIdentity(userId);
    const database = await this.db();
    await database.execAsync("BEGIN IMMEDIATE;");
    try {
      await database.runAsync("DELETE FROM cache_records WHERE user_id=?", userId);
      await database.runAsync("DELETE FROM lesson_completion_queue WHERE user_id=?", userId);
      await database.execAsync("COMMIT;");
    } catch (error) {
      await database.execAsync("ROLLBACK;").catch(() => {});
      throw error;
    }
  }

  async enqueueLessonCompletion(
    operation: Omit<LessonCompletionOperation, "attemptCount" | "state" | "lastErrorCode">,
  ): Promise<LessonCompletionOperation> {
    assertIdentity(operation.userId);
    assertIdentity(operation.courseId);
    assertIdentity(operation.resourceId);
    const database = await this.db();
    await database.runAsync(
      `INSERT OR IGNORE INTO lesson_completion_queue
       (operation_id,user_id,course_id,resource_id,idempotency_key,created_at,attempt_count,state)
       VALUES(?,?,?,?,?,?,0,'PENDING')`,
      operation.operationId,
      operation.userId,
      operation.courseId,
      operation.resourceId,
      operation.idempotencyKey,
      operation.createdAt,
    );
    const saved = await database.getFirstAsync<LessonCompletionOperation>(
      `SELECT operation_id AS operationId,user_id AS userId,course_id AS courseId,
       resource_id AS resourceId,idempotency_key AS idempotencyKey,created_at AS createdAt,
       attempt_count AS attemptCount,state,last_error_code AS lastErrorCode
       FROM lesson_completion_queue WHERE operation_id=? OR idempotency_key=? LIMIT 1`,
      operation.operationId,
      operation.idempotencyKey,
    );
    if (!saved) throw new Error("OFFLINE_QUEUE_INSERT_FAILED");
    return saved;
  }

  async listQueueableCompletions(userId: string): Promise<LessonCompletionOperation[]> {
    assertIdentity(userId);
    const states = queueableStates.map(() => "?").join(",");
    return (await this.db()).getAllAsync<LessonCompletionOperation>(
      `SELECT operation_id AS operationId,user_id AS userId,course_id AS courseId,
       resource_id AS resourceId,idempotency_key AS idempotencyKey,created_at AS createdAt,
       attempt_count AS attemptCount,state,last_error_code AS lastErrorCode
       FROM lesson_completion_queue WHERE user_id=? AND state IN (${states}) ORDER BY created_at,operation_id`,
      userId,
      ...queueableStates,
    );
  }

  async lessonCompletionState(userId: string, resourceId: string): Promise<LessonCompletionOperation | null> {
    assertIdentity(userId);
    assertIdentity(resourceId);
    return (await this.db()).getFirstAsync<LessonCompletionOperation>(
      `SELECT operation_id AS operationId,user_id AS userId,course_id AS courseId,
       resource_id AS resourceId,idempotency_key AS idempotencyKey,created_at AS createdAt,
       attempt_count AS attemptCount,state,last_error_code AS lastErrorCode
       FROM lesson_completion_queue WHERE user_id=? AND resource_id=?
       ORDER BY created_at DESC LIMIT 1`,
      userId,
      resourceId,
    );
  }

  async setCompletionState(
    userId: string,
    operationId: string,
    state: CompletionState,
    options: { incrementAttempt?: boolean; errorCode?: string } = {},
  ): Promise<void> {
    assertIdentity(userId);
    await (
      await this.db()
    ).runAsync(
      `UPDATE lesson_completion_queue SET state=?,attempt_count=attempt_count+?,last_error_code=?
       WHERE user_id=? AND operation_id=?`,
      state,
      options.incrementAttempt ? 1 : 0,
      options.errorCode ?? null,
      userId,
      operationId,
    );
  }
}
