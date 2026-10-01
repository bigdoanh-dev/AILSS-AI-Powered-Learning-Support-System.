import { randomUUID } from "node:crypto";
import { generateKeyPair } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../packages/config/src/index.js";
import { AssessmentClients } from "../../apps/assessment-service/src/clients.js";
const { privateKey } = await generateKeyPair("EdDSA");
const config = {
  LEARNING_SERVICE_URL: "http://learning.example.invalid",
  SERVICE_TOKEN_ISSUER: "ailss-internal",
  ASSESSMENT_SERVICE_TOKEN_KID: "test-assessment",
  SERVICE_TOKEN_TTL_SECONDS: 60,
} as AppConfig;
const clients = new AssessmentClients(config, privateKey);
const targetId = randomUUID(),
  ownerLecturerId = randomUUID(),
  requestId = randomUUID();
afterEach(() => vi.restoreAllMocks());
function respond(state: string, studentEligible?: boolean) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          courseId: targetId,
          ownerLecturerId,
          state,
          recordVersion: 2,
          ...(studentEligible ? { studentEligible } : {}),
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      }),
      { status: 200 },
    ),
  );
}
describe("Assessment course lifecycle contract", () => {
  it.each(["DRAFT", "IN_REVIEW", "PUBLISHED", "HIDDEN"])(
    "preserves %s in verified ownership facts",
    async (state) => {
      respond(state);
      expect(await clients.target("COURSE", targetId, requestId)).toEqual({
        targetType: "COURSE",
        targetId,
        ownerLecturerId,
        version: 2,
        courseState: state,
      });
    },
  );
  it.each(["DRAFT", "IN_REVIEW"])(
    "rejects student access to %s despite an eligibility flag",
    async (state) => {
      respond(state, true);
      await expect(
        clients.studentTarget("COURSE", targetId, "student-context", requestId),
      ).rejects.toMatchObject({ kind: "REJECTED", status: 403 });
    },
  );
});
