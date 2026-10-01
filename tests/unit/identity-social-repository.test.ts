import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import { IdentityExternalAuthRepository } from "../../apps/identity-service/src/external-auth/repository.js";
import { identitySearchShard } from "../../apps/identity-service/src/admin/model.js";

const schema = readFileSync(
  new URL("../../database/migrations/dev/010_identity_schema.cql", import.meta.url),
  "utf8",
);
const projectionSchema = schema.match(
  /CREATE TABLE IF NOT EXISTS identity_keyspace\.users_by_role_status_bucket\s*\(([\s\S]*?)\n\)/,
)?.[1];
const primaryKeySpec = projectionSchema?.match(/PRIMARY KEY\s*\(([^\n]+)\)/)?.[1] ?? "";
const primaryKeys = primaryKeySpec
  .replace(/[()]/g, "")
  .split(",")
  .map((key) => key.trim());

describe("social account Cassandra projection", () => {
  it("writes all schema primary keys and the same shard used by account management", async () => {
    expect(primaryKeys).toContain("updated_at");
    const execute = vi.fn(async (query: string) => {
      if (/INSERT INTO users_by_role_status_bucket/.test(query)) {
        const columns = (query.match(/users_by_role_status_bucket\s*\(([^)]+)\)/)?.[1] ?? "")
          .split(",")
          .map((column) => column.trim());
        // A real Cassandra insert rejects an omitted clustering key. Use the
        // migration's keys so this test catches drift in the repository SQL.
        for (const key of primaryKeys ?? []) {
          if (!columns.includes(key)) throw new Error(`Missing mandatory PRIMARY KEY part ${key}`);
        }
      }
      return [];
    });
    const repo = new IdentityExternalAuthRepository({ execute } as unknown as CassandraClient);
    const now = new Date("2026-10-01T00:00:00Z");
    const userId = "ae33736a-ec40-42bc-8679-f2ab13d9d358";
    await expect(
      repo.createSocialUser({
        userId,
        email: "social-test@example.invalid",
        displayName: "Google Student",
        provider: "GOOGLE",
        providerSubject: "test-google-subject",
        now,
      }),
    ).resolves.toMatchObject({ userId, role: "STUDENT", status: "ACTIVE" });
    const projection = execute.mock.calls.find(([query]) =>
      /INSERT INTO users_by_role_status_bucket/.test(query),
    );
    expect(projection).toBeDefined();
    const [, params, consistency] = projection as unknown as [string, unknown[], string];
    expect(params[0]).toBe(identitySearchShard(userId));
    expect(params[1]).toEqual(now);
    expect(String(params[2])).toBe(userId);
    expect(params[3]).toBe("Google Student");
    expect(String(params[4])).toBe("1");
    expect(consistency).toBe("LOCAL_QUORUM");
    expect(
      execute.mock.calls.some(([query]) => /INSERT INTO external_identity_by_provider_subject/.test(query)),
    ).toBe(true);
    expect(execute.mock.calls.some(([query]) => /INSERT INTO external_identities_by_user/.test(query))).toBe(
      true,
    );
  });
});
