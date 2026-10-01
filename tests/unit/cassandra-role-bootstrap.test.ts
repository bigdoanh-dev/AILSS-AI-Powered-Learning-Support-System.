import { describe, expect, it, vi } from "vitest";
import { synchronizeCassandraRoles } from "../../scripts/dev/cassandra-roles.mjs";

const roles = [
  "CREATE ROLE IF NOT EXISTS svc_test WITH LOGIN = true AND PASSWORD = 'fixture-only';",
  "ALTER ROLE svc_test WITH LOGIN = true AND PASSWORD = 'fixture-only';",
].join("\n");

describe("Cassandra role provisioning on fresh and existing volumes", () => {
  it("respects the server password update interval on a fresh volume", async () => {
    let elapsed = 0;
    let createdAt: number | undefined;
    let synchronized = false;
    await synchronizeCassandraRoles(
      roles,
      (batch) => {
        if (batch.includes("CREATE ROLE")) createdAt = elapsed;
        if (batch.includes("ALTER ROLE")) {
          if (createdAt === undefined || elapsed - createdAt < 5000)
            throw new Error("Password can only be changed every 5000ms");
          synchronized = true;
        }
      },
      async (milliseconds) => {
        elapsed += milliseconds;
      },
    );
    expect(synchronized).toBe(true);
  });

  it("still synchronizes an existing volume with the configured password", async () => {
    const execute = vi.fn();
    const wait = vi.fn(async () => {});
    await synchronizeCassandraRoles(roles, execute, wait);
    expect(execute.mock.calls[0]?.[0]).not.toContain("ALTER ROLE");
    expect(execute.mock.calls[1]?.[0]).toContain("PASSWORD = 'fixture-only'");
    expect(wait).toHaveBeenCalledWith(5100);
  });

  it("does not continue to rotate credentials when role creation fails", async () => {
    const execute = vi.fn(() => {
      throw new Error("creation failed");
    });
    const wait = vi.fn(async () => {});
    await expect(synchronizeCassandraRoles(roles, execute, wait)).rejects.toThrow("creation failed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
