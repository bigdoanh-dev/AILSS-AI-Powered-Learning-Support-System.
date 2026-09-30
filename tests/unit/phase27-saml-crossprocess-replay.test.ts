/**
 * Phase 27.3: Real Cross-Process Distributed SAML Replay Store
 *
 * Requirements:
 * 1. Verifies physical shared state backend:
 *    - Not restricted to in-process memory
 *    - Classified as DURABLE_CROSS_PROCESS_FS or CASSANDRA
 * 2. Cross-process assertion consumption:
 *    - Separate OS processes sharing state directory / backend
 *    - Process A consumes assertion -> Accepted
 *    - Process B attempts to replay identical assertion -> Rejected (SAML_REPLAY_ATTACK_DETECTED)
 * 3. Process restart survivability:
 *    - Processes terminate, new instance starts
 *    - Replay attempt before expiration remains strictly rejected
 * 4. Cassandra LWT Paxos query verification
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  DurableCrossProcessReplayCluster,
  CassandraSamlReplayStore,
  DistributedSamlReplayStore,
  type SamlReplayRecord,
} from "../../packages/security/src/saml.js";

describe("Phase 27.3: Real Cross-Process Distributed SAML Replay Defense", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ailss-replay-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("verifies backend classification of durable and Cassandra replay stores", () => {
    const durableCluster = new DurableCrossProcessReplayCluster(tempDir);
    expect(durableCluster.backendClassification).toBe("DURABLE_CROSS_PROCESS_FS");

    const distributedStore = new DistributedSamlReplayStore(durableCluster, {
      tenantId: "tenant-pilot-polytech",
    });
    expect(distributedStore.backendClassification).toBe("DURABLE_CROSS_PROCESS_FS");

    const cassandraStore = new CassandraSamlReplayStore({
      tenantId: "tenant-pilot-polytech",
      storageDir: tempDir,
    });
    expect(cassandraStore.backendClassification).toBe("CASSANDRA");
  });

  it("enforces atomic consumption and replay detection across separate OS child processes", async () => {
    const assertionId = "AS-CROSS-PROCESS-9921";
    const tenantId = "tenant-pilot-polytech";

    // Helper to run a separate Node child process that consumes an assertion
    function runChildProcessConsumer(id: string): Promise<{ accepted: boolean; pid: number }> {
      return new Promise((resolve, reject) => {
        const scriptCode = `
          import { DurableCrossProcessReplayCluster, DistributedSamlReplayStore } from "./packages/security/src/saml.ts";
          const cluster = new DurableCrossProcessReplayCluster("${tempDir}");
          const store = new DistributedSamlReplayStore(cluster, { tenantId: "${tenantId}" });
          const now = new Date();
          const record = {
            tenantId: "${tenantId}",
            idpIssuer: "https://idp.polytech.edu.vn",
            assertionId: "${id}",
            issuedAt: now,
            expiresAt: new Date(now.getTime() + 300000),
            consumedAt: now,
          };
          const accepted = store.consume(record);
          console.log(JSON.stringify({ accepted, pid: process.pid }));
        `;

        const child = spawn(process.execPath, ["--import", "tsx", "-e", scriptCode], {
          stdio: ["ignore", "pipe", "inherit"],
        });

        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });

        child.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`Child process failed with code ${String(code)}`));
            return;
          }
          try {
            const parsed = JSON.parse(output.trim()) as { accepted: boolean; pid: number };
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });

        child.on("error", reject);
      });
    }

    // Process 1: First consumer
    const proc1Result = await runChildProcessConsumer(assertionId);
    expect(proc1Result.accepted).toBe(true);

    // Process 2: Second consumer (distinct PID) attempting replay of the exact same assertion
    const proc2Result = await runChildProcessConsumer(assertionId);
    expect(proc2Result.pid).not.toBe(proc1Result.pid); // Strictly independent process memory space!
    expect(proc2Result.accepted).toBe(false); // REJECTED across process boundaries!
  }, 30000);

  it("preserves replay defense after complete process restart", async () => {
    const assertionId = "AS-RESTART-SURVIVAL-881";
    const tenantId = "tenant-pilot-polytech";

    // Instance 1 creates durable record and consumes
    const instance1 = new DistributedSamlReplayStore(new DurableCrossProcessReplayCluster(tempDir), {
      tenantId,
    });

    const now = new Date();
    const record: SamlReplayRecord = {
      tenantId,
      idpIssuer: "https://idp.polytech.edu.vn",
      assertionId,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 600000),
      consumedAt: now,
    };

    expect(instance1.consume(record)).toBe(true);

    // Complete process shutdown / restart simulated by creating a completely fresh instance pointing to same storage
    const restartedInstance = new DistributedSamlReplayStore(new DurableCrossProcessReplayCluster(tempDir), {
      tenantId,
    });

    // The restarted instance MUST remember the assertion was consumed
    expect(restartedInstance.has(assertionId)).toBe(true);
    expect(restartedInstance.consume(record)).toBe(false); // Strictly rejected!
  });

  it("Cassandra store executes Paxos LWT IF NOT EXISTS query with TTL", async () => {
    let executedQuery = "";
    let executedParams: unknown[] = [];

    const mockCassandraClient = {
      execute: async (query: string, params: unknown[]) => {
        executedQuery = query;
        executedParams = params;
        return { wasApplied: () => true };
      },
    };

    const cassandraStore = new CassandraSamlReplayStore({
      client: mockCassandraClient,
      tenantId: "tenant-pilot-polytech",
    });

    const now = new Date();
    const record: SamlReplayRecord = {
      tenantId: "tenant-pilot-polytech",
      idpIssuer: "https://idp.polytech.edu.vn",
      assertionId: "AS-CAS-99",
      responseId: "RESP-01",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 300000),
      consumedAt: now,
    };

    const accepted = await cassandraStore.consume(record);
    expect(accepted).toBe(true);
    expect(executedQuery).toContain("INSERT INTO system_saml_replays");
    expect(executedQuery).toContain("IF NOT EXISTS");
    expect(executedQuery).toContain("USING TTL");
    expect(executedParams[0]).toBe("tenant-pilot-polytech");
    expect(executedParams[1]).toBe("AS-CAS-99");
  });
});
