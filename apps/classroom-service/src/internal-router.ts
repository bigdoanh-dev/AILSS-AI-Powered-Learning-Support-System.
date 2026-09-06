import { Router, type Request } from "express";
import type { JWTPayload } from "jose";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { ActorContext } from "../../../packages/security/src/index.js";
import type { ClassroomService } from "./service.js";

interface InternalVerifier {
  readonly caller: string;
  readonly verify: (token: string) => Promise<JWTPayload>;
}

interface ClassFacts {
  getClass(id: string): Promise<
    | {
        classId: string;
        linkedCourseId?: string;
        ownerLecturerId: string;
        classKind: string;
        state: string;
        scheduleState: string;
        scheduleVersion: number;
        version: number;
        name: string;
      }
    | undefined
  >;
  membership(classId: string, studentId: string): Promise<{ state: string } | undefined>;
}

export function classroomInternalRouter(
  repository: ClassFacts,
  service: Pick<
    ClassroomService,
    | "offeringContext"
    | "reserveSchedule"
    | "confirmSchedule"
    | "releaseSchedule"
    | "activatePurchasedMembership"
  >,
  verifiers: Record<
    | "quiz"
    | "interaction"
    | "ai"
    | "learning"
    | "scheduleReserve"
    | "scheduleReserveFulfillment"
    | "scheduleConfirm"
    | "scheduleRelease"
    | "membershipActivate",
    InternalVerifier
  >,
  verifyReservationActor: (token: string) => Promise<ActorContext>,
  verifyQuizActor: (token: string) => Promise<ActorContext>,
  verifyInteractionActor: (token: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  const route = (path: string, verifier: InternalVerifier, includeName = false, includeOwner = false) =>
    router.get(path, async (request, response, next) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        let claims: JWTPayload;
        try {
          claims = await verifier.verify(serviceToken(request));
        } catch {
          throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
        }
        if (claims.sub !== verifier.caller)
          throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
        const classId = z.string().uuid().parse(request.params.id);
        const value = await repository.getClass(classId);
        if (!value || value.state !== "ACTIVE")
          throw new AppError("CLASS_NOT_AVAILABLE", 404, "Class is not available");
        if (path.includes("interaction-eligibility")) {
          const token = optionalHeader(request, "x-actor-context");
          if (!token) throw new AppError("RESOURCE_NOT_FOUND", 404, "Resource not found");
          let actor: ActorContext;
          try {
            actor = await verifyInteractionActor(token);
          } catch {
            throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor context");
          }
          if (actor.correlationId !== context.correlationId)
            throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor context");
          const eligible = actor.roles.includes("STUDENT")
            ? (await repository.membership(classId, actor.userId))?.state === "ACTIVE"
            : actor.roles.includes("LECTURER") && value.ownerLecturerId === actor.userId;
          if (!eligible) throw new AppError("RESOURCE_NOT_FOUND", 404, "Resource not found");
          return response.status(200).json({ eligible: true, reason: "ELIGIBLE", version: value.version });
        }
        let studentEligible: boolean | undefined;
        if (path.includes("quiz-eligibility")) {
          const token = optionalHeader(request, "x-actor-context");
          if (token) {
            let actor: ActorContext;
            try {
              actor = await verifyQuizActor(token);
            } catch {
              throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor context");
            }
            if (actor.correlationId !== context.correlationId || !actor.roles.includes("STUDENT"))
              throw new AppError("STUDENT_NOT_ELIGIBLE", 403, "Student is not eligible");
            const membership = await repository.membership(classId, actor.userId);
            if (!membership || membership.state !== "ACTIVE")
              throw new AppError("STUDENT_NOT_ELIGIBLE", 403, "Student is not eligible");
            studentEligible = true;
          }
        }
        response.status(200).json({
          data: {
            classId: value.classId,
            ...(includeOwner ? { ownerLecturerId: value.ownerLecturerId } : {}),
            ...(value.linkedCourseId ? { linkedCourseId: value.linkedCourseId } : {}),
            classKind: value.classKind,
            state: value.state,
            scheduleState: value.scheduleState,
            scheduleVersion: value.scheduleVersion,
            version: value.version,
            ...(studentEligible ? { studentEligible } : {}),
            ...(includeName ? { name: value.name } : {}),
          },
          meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        next(error);
      }
    });
  route("/internal/v1/classes/:id/quiz-eligibility", verifiers.quiz, false, true);
  route("/internal/v1/classes/:id/interaction-eligibility", verifiers.interaction);
  route("/internal/v1/classes/:id/ai-context", verifiers.ai, true, true);
  router.get("/internal/v1/classes/:id/offering-context", async (request, response, next) => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let claims: JWTPayload;
      try {
        claims = await verifiers.learning.verify(serviceToken(request));
      } catch {
        throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
      }
      if (claims.sub !== verifiers.learning.caller)
        throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
      let classId: string;
      try {
        classId = z.string().uuid().parse(request.params.id);
      } catch {
        throw new AppError("CLASS_NOT_AVAILABLE", 404, "Class is not available");
      }
      const value = await service.offeringContext(classId);
      if (!value) throw new AppError("CLASS_NOT_AVAILABLE", 404, "Class is not available");
      response.status(200).json({
        data: value,
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/internal/v1/schedule-reservations", async (request, response, next) => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let actorRequired = true;
      try {
        await allowed(request, verifiers.scheduleReserve);
      } catch {
        await allowed(request, verifiers.scheduleReserveFulfillment);
        actorRequired = false;
      }
      const body = internalBody(() =>
        z
          .object({
            operationId: z.string().uuid(),
            studentId: z.string().uuid(),
            offeringId: z.string().uuid(),
            classId: z.string().uuid(),
          })
          .strict()
          .parse(request.body),
      );
      if (actorRequired) {
        const actor = await reservationActor(request, verifyReservationActor, context.correlationId);
        if (body.studentId !== actor.userId || !actor.roles.includes("STUDENT"))
          throw new AppError("SCHEDULE_STUDENT_BINDING_FAILED", 403, "Student Actor Context binding failed");
      }
      response.status(201).json({
        data: await service.reserveSchedule(body),
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    "/internal/v1/schedule-reservations/:reservationId/confirm",
    async (request, response, next) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        await allowed(request, verifiers.scheduleConfirm);
        const reservationId = z.string().uuid().parse(request.params.reservationId),
          body = internalBody(() =>
            z
              .object({
                operationId: z.string().uuid(),
                orderId: z.string().uuid(),
                membershipId: z.string().uuid(),
              })
              .strict()
              .parse(request.body),
          );
        response.status(200).json({
          data: await service.confirmSchedule(reservationId, body),
          meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post("/internal/v1/classes/:id/memberships/activate", async (request, response, next) => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      await allowed(request, verifiers.membershipActivate);
      const classId = z.string().uuid().parse(request.params.id);
      const body = internalBody(() =>
        z
          .object({
            action: z.enum(["PREPARE", "ACTIVATE"]),
            operationId: z.string().uuid(),
            studentId: z.string().uuid(),
            offeringId: z.string().uuid(),
            enrollmentId: z.string().uuid(),
            reservationId: z.string().uuid(),
            orderId: z.string().uuid(),
            membershipId: z.string().uuid(),
          })
          .strict()
          .parse(request.body),
      );
      response.status(200).json({
        data: await service.activatePurchasedMembership({
          classId,
          ...body,
          requestId: context.requestId,
        }),
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    "/internal/v1/schedule-reservations/:reservationId/release",
    async (request, response, next) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        await allowed(request, verifiers.scheduleRelease);
        const reservationId = z.string().uuid().parse(request.params.reservationId),
          body = internalBody(() =>
            z
              .object({
                operationId: z.string().uuid(),
                reason: z.enum(["PAYMENT_FAILED", "CANCELLED", "COMPENSATION", "EXPIRED"]),
              })
              .strict()
              .parse(request.body),
          );
        response.status(200).json({
          data: await service.releaseSchedule(reservationId, body),
          meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}

function optionalHeader(request: Request, name: string): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]?.toLowerCase() === name) values.push(request.rawHeaders[i + 1] ?? "");
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !values[0] || values[0].length > 4096) throw new Error("HEADER_REJECTED");
  return values[0];
}

async function allowed(request: Request, verifier: InternalVerifier) {
  let claims: JWTPayload;
  try {
    claims = await verifier.verify(serviceToken(request));
  } catch {
    throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
  }
  if (claims.sub !== verifier.caller)
    throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
}
function internalBody<T>(parse: () => T) {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError)
      throw new AppError("INTERNAL_VALIDATION_FAILED", 400, "Internal request validation failed");
    throw error;
  }
}
async function reservationActor(
  request: Request,
  verify: (token: string) => Promise<ActorContext>,
  correlationId: string,
) {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]?.toLowerCase() === "x-actor-context")
      values.push(request.rawHeaders[i + 1] ?? "");
  try {
    if (values.length !== 1 || !values[0]) throw new Error();
    const actor = await verify(values[0]);
    if (actor.correlationId !== correlationId) throw new Error();
    return actor;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}

function serviceToken(request: Request) {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index]?.toLowerCase() === "authorization")
      values.push(request.rawHeaders[index + 1] ?? "");
  const token = values.length === 1 ? /^Service ([A-Za-z0-9_.-]+)$/u.exec(values[0] ?? "")?.[1] : undefined;
  if (!token || token.length > 4096) throw new Error("SERVICE_HEADER_REJECTED");
  return token;
}
