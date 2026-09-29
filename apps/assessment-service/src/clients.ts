import type { CryptoKey } from "jose";
import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { loadPrivateKey, signServiceToken } from "../../../packages/security/src/index.js";

const envelope = <T extends z.ZodType>(data: T) =>
  z
    .object({
      data,
      meta: z.object({ requestId: z.string().uuid(), timestamp: z.string().datetime() }).strict(),
    })
    .strict();
const lecturer = envelope(
  z
    .object({
      userId: z.string().uuid(),
      displayName: z.string().min(1),
      avatarRef: z.null(),
      resourceVersion: z.number().int().nonnegative(),
    })
    .strict(),
);
const course = envelope(
  z
    .object({
      courseId: z.string().uuid(),
      ownerLecturerId: z.string().uuid(),
      state: z.enum(["PUBLISHED", "HIDDEN"]),
      recordVersion: z.number().int().positive(),
      studentEligible: z.boolean().optional(),
    })
    .strict(),
);
const klass = envelope(
  z
    .object({
      classId: z.string().uuid(),
      ownerLecturerId: z.string().uuid(),
      linkedCourseId: z.string().uuid().optional(),
      classKind: z.string().min(1),
      state: z.literal("ACTIVE"),
      scheduleState: z.string().min(1),
      scheduleVersion: z.number().int().positive(),
      version: z.number().int().positive(),
      studentEligible: z.boolean().optional(),
    })
    .strict(),
);

export interface TargetFacts {
  targetType: "COURSE" | "CLASS";
  targetId: string;
  ownerLecturerId: string;
  version: number;
}

export class AssessmentDependencyError extends Error {
  public constructor(
    public readonly dependency: "IDENTITY" | "LEARNING" | "CLASSROOM",
    public readonly kind: "REJECTED" | "UNAVAILABLE",
    public readonly status?: number,
  ) {
    super(`${dependency}_${kind}`);
  }
}

export class AssessmentClients {
  public constructor(
    private readonly config: AppConfig,
    private readonly privateKey: CryptoKey,
  ) {}

  async eligibleLecturer(userId: string, correlationId: string): Promise<void> {
    await this.get(
      new URL(
        `/internal/v1/users/${encodeURIComponent(userId)}/public-profile`,
        this.config.IDENTITY_SERVICE_URL,
      ),
      "identity-service",
      "identity.public-profile.read",
      500,
      correlationId,
      lecturer,
      "IDENTITY",
    );
  }

  async target(
    targetType: "COURSE" | "CLASS",
    targetId: string,
    correlationId: string,
  ): Promise<TargetFacts> {
    if (targetType === "COURSE") {
      const value = await this.get(
        new URL(
          `/internal/v1/courses/${encodeURIComponent(targetId)}/quiz-eligibility`,
          this.config.LEARNING_SERVICE_URL,
        ),
        "learning-service",
        "learning.course.quiz-eligibility.read",
        800,
        correlationId,
        course,
        "LEARNING",
      );
      return {
        targetType,
        targetId: value.data.courseId,
        ownerLecturerId: value.data.ownerLecturerId,
        version: value.data.recordVersion,
      };
    }
    const value = await this.get(
      new URL(
        `/internal/v1/classes/${encodeURIComponent(targetId)}/quiz-eligibility`,
        this.config.CLASSROOM_SERVICE_URL,
      ),
      "classroom-service",
      "classroom.quiz-eligibility.read",
      800,
      correlationId,
      klass,
      "CLASSROOM",
    );
    return {
      targetType,
      targetId: value.data.classId,
      ownerLecturerId: value.data.ownerLecturerId,
      version: value.data.version,
    };
  }

  async studentTarget(
    targetType: "COURSE" | "CLASS",
    targetId: string,
    actorContext: string,
    correlationId: string,
  ): Promise<TargetFacts> {
    const facts = await this.targetWithActor(targetType, targetId, actorContext, correlationId);
    return facts;
  }

  private async targetWithActor(
    targetType: "COURSE" | "CLASS",
    targetId: string,
    actorContext: string,
    correlationId: string,
  ): Promise<TargetFacts> {
    const dependency = targetType === "COURSE" ? "LEARNING" : "CLASSROOM";
    if (targetType === "COURSE") {
      const value = await this.get(
        new URL(
          `/internal/v1/courses/${encodeURIComponent(targetId)}/quiz-eligibility`,
          this.config.LEARNING_SERVICE_URL,
        ),
        "learning-service",
        "learning.course.quiz-eligibility.read",
        800,
        correlationId,
        course,
        dependency,
        actorContext,
      );
      if (value.data.studentEligible !== true)
        throw new AssessmentDependencyError(dependency, "REJECTED", 403);
      return {
        targetType,
        targetId: value.data.courseId,
        ownerLecturerId: value.data.ownerLecturerId,
        version: value.data.recordVersion,
      };
    }
    const value = await this.get(
      new URL(
        `/internal/v1/classes/${encodeURIComponent(targetId)}/quiz-eligibility`,
        this.config.CLASSROOM_SERVICE_URL,
      ),
      "classroom-service",
      "classroom.quiz-eligibility.read",
      800,
      correlationId,
      klass,
      dependency,
      actorContext,
    );
    if (value.data.studentEligible !== true) throw new AssessmentDependencyError(dependency, "REJECTED", 403);
    return {
      targetType,
      targetId: value.data.classId,
      ownerLecturerId: value.data.ownerLecturerId,
      version: value.data.version,
    };
  }

  private async get<T extends z.ZodType>(
    url: URL,
    audience: string,
    purpose: string,
    deadlineMs: number,
    correlationId: string,
    schema: T,
    dependency: AssessmentDependencyError["dependency"],
    actorContext?: string,
  ): Promise<z.infer<T>> {
    const token = await signServiceToken(this.privateKey, {
      issuer: this.config.SERVICE_TOKEN_ISSUER,
      serviceId: "assessment-service",
      audience,
      purpose,
      kid: this.config.ASSESSMENT_SERVICE_TOKEN_KID,
      ttlSeconds: this.config.SERVICE_TOKEN_TTL_SECONDS,
    });
    try {
      const response = await fetch(url, {
        headers: {
          authorization: `Service ${token}`,
          "x-correlation-id": correlationId,
          ...(actorContext ? { "x-actor-context": actorContext } : {}),
        },
        signal: AbortSignal.timeout(deadlineMs),
      });
      if ([400, 401, 403, 404, 409].includes(response.status))
        throw new AssessmentDependencyError(dependency, "REJECTED", response.status);
      if (!response.ok) throw new AssessmentDependencyError(dependency, "UNAVAILABLE", response.status);
      return schema.parse(await response.json());
    } catch (error) {
      if (error instanceof AssessmentDependencyError) throw error;
      throw new AssessmentDependencyError(dependency, "UNAVAILABLE");
    }
  }
}

export async function createAssessmentClients(config: AppConfig): Promise<AssessmentClients> {
  if (!config.SERVICE_TOKEN_PRIVATE_KEY_PATH)
    throw new Error("Assessment dependencies require a service-token private key");
  return new AssessmentClients(config, await loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH));
}
