import type { CryptoKey } from "jose";
import { z } from "zod";
import { signServiceToken } from "../../../../packages/security/src/index.js";
import type { ObjectiveQuiz } from "../../../../packages/contracts/src/objective-v1.js";

const resultSchema = z
  .object({
    data: z
      .object({
        draftId: z.string().uuid(),
        approvedDraftVersion: z.literal(2),
        quizId: z.string().uuid(),
        quizVersion: z.literal(1),
        status: z.literal("DRAFT"),
      })
      .strict(),
  })
  .strict();

export interface AssessmentImportRequest {
  importOperationId: string;
  approvedDraftVersion: 2;
  approvedDraftChecksum: string;
  jobId: string;
  targetType: "COURSE" | "CLASS";
  targetId: string;
  targetVersion: number;
  ownerLecturerId: string;
  quiz: ObjectiveQuiz;
}

export class AiAssessmentClient {
  constructor(
    private readonly input: {
      baseUrl: string;
      key: CryptoKey;
      kid: string;
      issuer: string;
      ttlSeconds: number;
      deadlineMs: number;
    },
  ) {}

  async importDraft(
    draftId: string,
    request: AssessmentImportRequest,
    actorContext: string,
    correlationId: string,
  ) {
    const token = await signServiceToken(this.input.key, {
      issuer: this.input.issuer,
      serviceId: "ai-service",
      audience: "assessment-service",
      purpose: "assessment.ai-draft.import",
      kid: this.input.kid,
      ttlSeconds: this.input.ttlSeconds,
    });
    try {
      const response = await fetch(
        new URL(`/internal/v1/ai-drafts/${encodeURIComponent(draftId)}/import`, this.input.baseUrl),
        {
          method: "POST",
          headers: {
            authorization: `Service ${token}`,
            "x-actor-context": actorContext,
            "x-correlation-id": correlationId,
            "idempotency-key": request.importOperationId,
            "content-type": "application/json",
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.input.deadlineMs),
        },
      );
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 422].includes(response.status))
          throw new Error(`REJECTED:${String(response.status)}`);
        throw new Error("UNAVAILABLE");
      }
      return resultSchema.parse(await response.json()).data;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "UNAVAILABLE" || error.message.startsWith("REJECTED:"))
      )
        throw error;
      throw new Error("UNAVAILABLE");
    }
  }
}
