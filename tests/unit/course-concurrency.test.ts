import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CourseVersioningService,
  InMemoryVersioningRepository,
  type CourseReleaseSyllabus,
} from "../../apps/learning-service/src/versioning/index.js";

describe("Phase 21.10: Course Version Publication Concurrency Stress Test", () => {
  const sampleSyllabus: CourseReleaseSyllabus = {
    modules: [
      {
        moduleId: "mod-1",
        title: "Distributed Concurrency",
        order: 1,
        lessons: [
          {
            lessonId: "les-1",
            title: "Paxos & Raft Under Heavy Load",
            order: 1,
            durationMinutes: 45,
            concepts: ["RAFT_REPLICATION", "CAS"],
            contentHash: "hash-les-1",
          },
        ],
      },
    ],
  };

  it("handles 10 simultaneous publishers racing for the same course version: exactly 1 succeeds, 9 fail with conflict", async () => {
    const repository = new InMemoryVersioningRepository();
    const service = new CourseVersioningService(repository);
    const courseId = randomUUID();

    // 10 concurrent publishers simultaneously call publishRelease
    const publishPromises = Array.from({ length: 10 }, (_, i) =>
      service.publishRelease({
        courseId,
        title: `Concurrent Release from Publisher ${String(i)}`,
        syllabus: sampleSyllabus,
        changeLog: `Commit from worker ${String(i)}`,
        publishedBy: `lecturer-${String(i)}`,
        isLecturerReviewed: true,
      }),
    );

    const results = await Promise.allSettled(publishPromises);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    // Exactly 1 must win the CAS race
    expect(fulfilled).toHaveLength(1);
    // The other 9 must fail cleanly with CONCURRENT_PUBLICATION_CONFLICT
    expect(rejected).toHaveLength(9);

    for (const rej of rejected) {
      const err = rej.reason as Error;
      expect(err.message).toContain("CONCURRENT_PUBLICATION_CONFLICT");
    }

    // Verify repository state: only 1 release exists, version 1
    const releases = await repository.listReleases(courseId);
    expect(releases).toHaveLength(1);
    expect(releases[0]?.version).toBe(1);
  });

  it("handles 10 sequential publishers with retry: achieves monotonic versions 1 through 10 with zero gap or data corruption", async () => {
    const repository = new InMemoryVersioningRepository();
    const service = new CourseVersioningService(repository);
    const courseId = randomUUID();

    async function publishWithRetry(publisherIndex: number, maxRetries = 15): Promise<number> {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const rel = await service.publishRelease({
            courseId,
            title: `Course Release v${String(publisherIndex)}`,
            syllabus: {
              modules: [
                {
                  moduleId: `mod-${String(publisherIndex)}`,
                  title: `Module ${String(publisherIndex)}`,
                  order: 1,
                  lessons: [],
                },
              ],
            },
            changeLog: `Revision by publisher ${String(publisherIndex)} on attempt ${String(attempt)}`,
            publishedBy: `lecturer-${String(publisherIndex)}`,
            isLecturerReviewed: true,
          });
          return rel.version;
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes("CONCURRENT_PUBLICATION_CONFLICT")) {
            // Jitter delay before retry
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 + 2));
            continue;
          }
          throw err;
        }
      }
      throw new Error(`Publisher ${String(publisherIndex)} exceeded max retries`);
    }

    const tasks = Array.from({ length: 10 }, (_, i) => publishWithRetry(i));
    const publishedVersions = await Promise.all(tasks);

    expect(publishedVersions).toHaveLength(10);
    const sortedVersions = [...publishedVersions].sort((a, b) => a - b);
    expect(sortedVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const finalReleases = await repository.listReleases(courseId);
    expect(finalReleases).toHaveLength(10);
  });

  it("supports isolated concurrent publishing across distinct courses without cross-interference", async () => {
    const repository = new InMemoryVersioningRepository();
    const service = new CourseVersioningService(repository);

    const courseIds = Array.from({ length: 5 }, () => randomUUID());

    // 2 publishers per course concurrently
    const crossPublishPromises = courseIds.flatMap((courseId, courseIdx) => [
      service.publishRelease({
        courseId,
        title: `Course ${String(courseIdx)} Release A`,
        syllabus: sampleSyllabus,
        changeLog: "Initial",
        publishedBy: `lecturer-A-${String(courseIdx)}`,
        isLecturerReviewed: true,
      }),
      service.publishRelease({
        courseId,
        title: `Course ${String(courseIdx)} Release B`,
        syllabus: sampleSyllabus,
        changeLog: "Initial",
        publishedBy: `lecturer-B-${String(courseIdx)}`,
        isLecturerReviewed: true,
      }),
    ]);

    const results = await Promise.allSettled(crossPublishPromises);

    // Across 5 courses, each course has 1 winner and 1 loser
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(5);

    for (const courseId of courseIds) {
      const courseReleases = await repository.listReleases(courseId);
      expect(courseReleases).toHaveLength(1);
    }
  });
});
