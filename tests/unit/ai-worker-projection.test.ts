import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { QuizWorkerRepository, type WorkerJob } from "../../apps/ai-worker/src/repository.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";

describe("quiz worker read projection convergence", () => {
  it("indexes the canonical state and removes stale state entries", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repo = new QuizWorkerRepository({ execute } as unknown as CassandraClient);
    const job: WorkerJob = {
      jobId: randomUUID(),
      lecturerId: randomUUID(),
      documentId: randomUUID(),
      targetType: "COURSE",
      targetId: randomUUID(),
      state: "AI_DRAFT",
      operationId: randomUUID(),
      version: 4,
      constraints: { questionCount: 1, questionTypes: ["TRUE_FALSE"], difficulty: "EASY" },
      createdAt: new Date(),
    };
    vi.spyOn(repo, "job").mockResolvedValue(job);
    await repo.syncProjection(job.jobId);
    expect(execute.mock.calls[0]?.[1]?.[1]).toBe("AI_DRAFT");
    expect(execute.mock.calls.slice(1).map((call) => String((call[1] as unknown[])[1]))).toEqual([
      "QUEUED",
      "PROCESSING",
      "VALIDATING",
      "FAILED",
      "CANCELLED",
    ]);
  });
  it("reconciles again if cancellation wins during projection writes", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repo = new QuizWorkerRepository({ execute } as unknown as CassandraClient);
    const base: WorkerJob = {
      jobId: randomUUID(),
      lecturerId: randomUUID(),
      documentId: randomUUID(),
      targetType: "COURSE",
      targetId: randomUUID(),
      state: "VALIDATING",
      operationId: randomUUID(),
      version: 3,
      constraints: { questionCount: 1, questionTypes: ["TRUE_FALSE"], difficulty: "EASY" },
      createdAt: new Date(),
    };
    vi.spyOn(repo, "job")
      .mockResolvedValueOnce(base)
      .mockResolvedValue({ ...base, state: "CANCELLED", version: 4 });
    await repo.syncProjection(base.jobId);
    expect(execute.mock.calls[6]?.[1]?.[1]).toBe("CANCELLED");
  });
});
