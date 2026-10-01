import { describe, expect, it, vi } from "vitest";
import { classroomStudentProfileHandler } from "../../apps/identity-service/src/profile/classroom-student.js";

const studentId = "11111111-1111-4111-8111-111111111111";

describe("classroom student identity boundary", () => {
  it("returns only the authorized student's limited profile to Classroom", async () => {
    const getUser = vi.fn(async () => ({
      userId: studentId,
      displayName: "Học viên A",
      emailMasked: "h***@school.edu.vn",
      role: "STUDENT",
      status: "ACTIVE",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      normalizedEmail: "private@school.edu.vn",
    }));
    const verify = vi.fn(async () => ({ sub: "classroom-service" }));
    const handler = classroomStudentProfileHandler({ getUser } as never, verify);
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const response = { status } as never;
    const next = vi.fn();
    const request = (rawHeaders: string[]) => ({ rawHeaders, params: { id: studentId } }) as never;

    await handler(request([]), response, next);
    expect(next.mock.lastCall?.[0]).toMatchObject({ status: 401 });
    expect(getUser).not.toHaveBeenCalled();

    verify.mockResolvedValueOnce({ sub: "learning-service" });
    await handler(request(["authorization", "Service a.b.c"]), response, next);
    expect(next.mock.lastCall?.[0]).toMatchObject({ status: 403 });
    expect(getUser).not.toHaveBeenCalled();

    next.mockClear();
    await handler(request(["authorization", "Service a.b.c"]), response, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.lastCall?.[0].data).toEqual({
      userId: studentId,
      displayName: "Học viên A",
      emailMasked: "h***@school.edu.vn",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  });
});
