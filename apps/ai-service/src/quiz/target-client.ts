/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { CryptoKey } from "jose";
import { z } from "zod";
import { signServiceToken } from "../../../../packages/security/src/index.js";
const response = z
  .object({
    data: z
      .object({
        ownerLecturerId: z.string().uuid(),
        recordVersion: z.number().int().positive().optional(),
        version: z.number().int().positive().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export class AiTargetClient {
  constructor(
    private readonly input: {
      learningUrl: string;
      classroomUrl: string;
      key: CryptoKey;
      kid: string;
      deadlineMs: number;
    },
  ) {}
  async owned(type: "COURSE" | "CLASS", id: string, owner: string, correlationId: string) {
    const token = await signServiceToken(this.input.key, {
      issuer: "ailss-internal",
      serviceId: "ai-service",
      audience: type === "COURSE" ? "learning-service" : "classroom-service",
      purpose: type === "COURSE" ? "learning.course.ai-context.read" : "classroom.ai-context.read",
      kid: this.input.kid,
      ttlSeconds: 60,
    });
    try {
      const path =
          type === "COURSE"
            ? `/internal/v1/courses/${encodeURIComponent(id)}/ai-context`
            : `/internal/v1/classes/${encodeURIComponent(id)}/ai-context`,
        r = await fetch(new URL(path, type === "COURSE" ? this.input.learningUrl : this.input.classroomUrl), {
          headers: { authorization: `Service ${token}`, "x-correlation-id": correlationId },
          signal: AbortSignal.timeout(this.input.deadlineMs),
        });
      if (!r.ok) throw new Error(r.status < 500 ? "REJECTED" : "UNAVAILABLE");
      const d = response.parse(await r.json()).data;
      if (d.ownerLecturerId !== owner) throw new Error("REJECTED");
      return { version: d.recordVersion ?? d.version! };
    } catch (e) {
      if (e instanceof Error && e.message === "REJECTED") throw e;
      throw new Error("UNAVAILABLE");
    }
  }
}
