import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import { LearningCommerceService } from "../../apps/learning-service/src/commerce/service.js";

describe("My courses uses current course access", () => {
  it("rejects a paid course through the free registration endpoint without granting access", async () => {
    const courseId = randomUUID();
    let command: unknown;
    const repo = {
      reserve: vi.fn(async (...args: unknown[]) => {
        command = { operationId: args[3], resourceId: args[4], receipt: args[5], status: "PENDING" };
      }),
      command: vi.fn(async () => command),
      course: vi.fn(async () => ({ courseId, state: "PUBLISHED" })),
      offering: vi.fn(async () => ({
        courseId,
        offeringType: "SELF_PACED",
        state: "PUBLISHED",
        price: "199000",
      })),
      createEnrollment: vi.fn(),
      grantEntitlement: vi.fn(),
    };
    const service = new LearningCommerceService(
      repo as unknown as LearningCommerceRepository,
      {} as never,
      {} as never,
      "test",
    );
    await expect(
      service.freeEnroll({
        courseId,
        actor: { userId: randomUUID(), roles: ["STUDENT"] } as never,
        key: "paid-course-cannot-register-free",
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PURCHASE_REQUIRED", status: 409 });
    expect(repo.createEnrollment).not.toHaveBeenCalled();
    expect(repo.grantEntitlement).not.toHaveBeenCalled();
  });

  it("does not fulfill an order awaiting payment", async () => {
    const repo = {
      order: vi.fn(async () => ({ state: "PENDING", fulfillmentState: "NOT_STARTED", version: 1 })),
      grantEntitlement: vi.fn(),
      markFulfillment: vi.fn(),
    };
    const service = new LearningCommerceService(
      repo as unknown as LearningCommerceRepository,
      {} as never,
      {} as never,
      "test",
    );
    await expect(service.fulfill(randomUUID(), randomUUID())).resolves.toBe(1);
    expect(repo.grantEntitlement).not.toHaveBeenCalled();
    expect(repo.markFulfillment).not.toHaveBeenCalled();
  });

  it("excludes revoked and missing entitlements even when enrollment projections remain ACTIVE", async () => {
    const studentId = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const enrolledAt = new Date("2026-10-02T01:00:00Z");
    const execute = vi.fn(async (query: string, params: unknown[]) => {
      if (query.includes("FROM courses_by_student_bucket")) {
        expect(String(params[0])).toBe(studentId);
        return String(params[1]) === "2026-10-01"
          ? ids.map((courseId) => ({ course_id: courseId, title: courseId, enrolled_at: enrolledAt }))
          : [];
      }
      if (query.includes("FROM entitlement_by_student_course")) {
        expect(String(params[0])).toBe(studentId);
        const id = String(params[1]);
        return id === ids[2]
          ? []
          : [
              {
                student_id: studentId,
                course_id: id,
                entitlement_id: randomUUID(),
                state: id === ids[0] ? "ACTIVE" : "REVOKED",
                source_offering_id: randomUUID(),
                source_enrollment_id: randomUUID(),
                granted_at: enrolledAt,
                updated_at: enrolledAt,
                version: 1,
              },
            ];
      }
      throw Error("Unexpected query");
    });
    const repo = new LearningCommerceRepository({ execute } as unknown as CassandraClient);
    await expect(repo.myCourses(studentId, enrolledAt)).resolves.toEqual([
      {
        courseId: ids[0],
        title: ids[0],
        enrolledAt: enrolledAt.toISOString(),
        state: "ACTIVE",
      },
    ]);
  });

  it("returns no course access for a new student with no registrations", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repo = new LearningCommerceRepository({ execute } as unknown as CassandraClient);
    await expect(repo.myCourses(randomUUID())).resolves.toEqual([]);
    expect(execute.mock.calls.every(([query]) => String(query).includes("courses_by_student_bucket"))).toBe(
      true,
    );
  });

  it("propagates authority lookup failures instead of claiming access", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query.includes("FROM courses_by_student_bucket"))
        return [
          {
            course_id: randomUUID(),
            title: "Course",
            enrolled_at: new Date(),
          },
        ];
      throw Error("Entitlement store unavailable");
    });
    const repo = new LearningCommerceRepository({ execute } as unknown as CassandraClient);
    await expect(repo.myCourses(randomUUID())).rejects.toThrow("Entitlement store unavailable");
  });
});
