import { Router, type Request, type RequestHandler } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { ActorContext } from "../../../packages/security/src/index.js";
import {
  parseAnnouncement,
  parseClassCreate,
  parseClassJoin,
  parseClassPatch,
  parseManualAttendance,
  parseSessionPatch,
  parseSessionWrite,
} from "./model.js";
import type { ClassroomService } from "./service.js";
const uuid = z.string().uuid();
export function classroomRouter(
  service: ClassroomService,
  verify: Record<
    | "create"
    | "detail"
    | "update"
    | "join"
    | "studentList"
    | "ownedList"
    | "roster"
    | "reset"
    | "announce"
    | "announcements"
    | "sessionCreate"
    | "sessionUpdate"
    | "sessionList"
    | "sessionDetail"
    | "attendance"
    | "attendanceHistory"
    | "presenceTicket"
    | "manualAttendance"
    | "schedulePublish"
    | "schedule",
    (token: string) => Promise<ActorContext>
  >,
): Router {
  const r = Router();
  r.post(
    "/api/v1/classes",
    handler(async (req, c) => ({
      status: 201,
      result: await service.create({
        actor: await actor(req, verify.create, c.correlationId),
        request: body(() => parseClassCreate(req.body)),
        key: idempotency(req),
        requestId: c.requestId,
      }),
    })),
  );
  r.put(
    "/api/v1/class-sessions/:sessionId/attendance/:studentId",
    handler(async (req, c) => ({
      status: 200,
      result: await service.manualAttendance({
        sessionId: sid(req.params.sessionId),
        studentId: student(req.params.studentId),
        actor: await actor(req, verify.manualAttendance, c.correlationId),
        request: body(() => parseManualAttendance(req.body)),
        key: idempotency(req),
        requestId: c.requestId,
      }),
    })),
  );
  r.post(
    "/api/v1/classes/join",
    handler(async (req, c) => ({
      status: 201,
      result: await service.join({
        actor: await actor(req, verify.join, c.correlationId),
        request: body(() => parseClassJoin(req.body)),
        key: idempotency(req),
        requestId: c.requestId,
      }),
    })),
  );
  r.get(
    "/api/v1/me/classes",
    handler(async (req, c) => ({
      status: 200,
      result: { data: await service.studentClasses(await actor(req, verify.studentList, c.correlationId)) },
    })),
  );
  r.get(
    "/api/v1/me/owned-classes",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.ownedClasses(await actor(req, verify.ownedList, c.correlationId), c.requestId),
      },
    })),
  );
  r.get(
    "/api/v1/me/schedule",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.studentSchedule(
          await actor(req, verify.schedule, c.correlationId),
          dateParam(req.query.from, "from"),
          dateParam(req.query.to, "to"),
        ),
      },
    })),
  );
  r.get(
    "/api/v1/classes/:classId",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.detail(
          id(req.params.classId),
          await actor(req, verify.detail, c.correlationId),
          c.requestId,
        ),
      },
    })),
  );
  r.patch(
    "/api/v1/classes/:classId",
    handler(async (req, c) => ({
      status: 200,
      result: await service.update({
        classId: id(req.params.classId),
        actor: await actor(req, verify.update, c.correlationId),
        request: body(() => parseClassPatch(req.body)),
        key: idempotency(req),
        requestId: c.requestId,
      }),
    })),
  );
  r.get(
    "/api/v1/classes/:classId/members",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.roster(
          id(req.params.classId),
          await actor(req, verify.roster, c.correlationId),
          c.requestId,
        ),
      },
    })),
  );
  r.post(
    "/api/v1/classes/:classId/join-code/reset",
    handler(async (req, c) => ({
      status: 200,
      result: await service.resetCode({
        classId: id(req.params.classId),
        actor: await actor(req, verify.reset, c.correlationId),
        key: idempotency(req),
        requestId: c.requestId,
      }),
    })),
  );
  r.post(
    "/api/v1/classes/:classId/announcements",
    handler(async (req, c) => ({
      status: 201,
      result: await service.announce({
        classId: id(req.params.classId),
        actor: await actor(req, verify.announce, c.correlationId),
        request: body(() => parseAnnouncement(req.body)),
        key: idempotency(req),
        requestId: c.requestId,
      }),
    })),
  );
  r.get(
    "/api/v1/classes/:classId/announcements",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.announcements(
          id(req.params.classId),
          await actor(req, verify.announcements, c.correlationId),
          c.requestId,
          month(req.query.month),
        ),
      },
    })),
  );
  r.post(
    "/api/v1/classes/:classId/sessions",
    handler(async (req, c) => ({
      status: 201,
      result: await service.createSessions({
        classId: id(req.params.classId),
        actor: await actor(req, verify.sessionCreate, c.correlationId),
        request: body(() => parseSessionWrite(req.body)),
        key: idempotency(req),
        requestId: c.requestId,
      }),
    })),
  );
  r.patch(
    "/api/v1/classes/:classId/sessions/:sessionId",
    handler(async (req, c) => ({
      status: 200,
      result: await service.updateSession({
        classId: id(req.params.classId),
        sessionId: sid(req.params.sessionId),
        actor: await actor(req, verify.sessionUpdate, c.correlationId),
        request: body(() => parseSessionPatch(req.body)),
        key: idempotency(req),
        requestId: c.requestId,
      }),
    })),
  );
  r.get(
    "/api/v1/classes/:classId/sessions",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.listSessions(
          id(req.params.classId),
          await actor(req, verify.sessionList, c.correlationId),
          c.requestId,
          dateParam(req.query.from, "from"),
          dateParam(req.query.to, "to"),
        ),
      },
    })),
  );
  r.get(
    "/api/v1/class-sessions/:sessionId",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.sessionDetail(
          sid(req.params.sessionId),
          await actor(req, verify.sessionDetail, c.correlationId),
          c.requestId,
        ),
      },
    })),
  );
  r.get(
    "/api/v1/class-sessions/:sessionId/attendance",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.attendanceRoster(
          sid(req.params.sessionId),
          await actor(req, verify.attendance, c.correlationId),
          c.requestId,
        ),
      },
    })),
  );
  r.get(
    "/api/v1/me/attendance",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.attendanceHistory(
          await actor(req, verify.attendanceHistory, c.correlationId),
          attendanceMonth(req.query.month),
        ),
      },
    })),
  );
  r.post(
    "/api/v1/class-sessions/:sessionId/presence-tickets",
    handler(async (req, c) => ({
      status: 200,
      result: {
        data: await service.issuePresenceTicket({
          sessionId: sid(req.params.sessionId),
          actor: await actor(req, verify.presenceTicket, c.correlationId),
          requestId: c.requestId,
        }),
      },
    })),
  );
  r.post(
    "/api/v1/classes/:classId/schedule/publish",
    handler(async (req, c) => ({
      status: 200,
      result: await service.publishSchedule({
        classId: id(req.params.classId),
        actor: await actor(req, verify.schedulePublish, c.correlationId),
        key: idempotency(req),
        requestId: c.requestId,
      }),
    })),
  );
  return r;
}
function handler(
  fn: (
    req: Request,
    c: ReturnType<typeof context>,
  ) => Promise<{ status: number; result: { data: unknown; replayed?: boolean; noOp?: boolean } }>,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const c = context(),
        out = await fn(req, c);
      res.status(out.status).json({
        data: out.result.data,
        meta: {
          requestId: c.requestId,
          timestamp: new Date().toISOString(),
          ...(out.result.replayed !== undefined ? { replayed: out.result.replayed } : {}),
          ...(out.result.noOp !== undefined ? { noOp: out.result.noOp } : {}),
        },
      });
    } catch (e) {
      next(e);
    }
  };
}
function context() {
  const c = currentRequestContext();
  if (!c) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return c;
}
function id(v: unknown) {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError("INVALID_CLASS_ID", 400, "Class ID must be a UUID");
  return p.data;
}
async function actor(req: Request, verify: (token: string) => Promise<ActorContext>, correlationId: string) {
  try {
    const values: string[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (req.rawHeaders[i]?.toLowerCase() === "x-actor-context") values.push(req.rawHeaders[i + 1] ?? "");
    if (values.length !== 1 || !values[0]) throw new Error();
    const value = await verify(values[0]);
    if (value.correlationId !== correlationId) throw new Error();
    return value;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
function idempotency(req: Request) {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === "idempotency-key") values.push(req.rawHeaders[i + 1] ?? "");
  const v = values[0];
  if (values.length !== 1 || !v || v.length > 200 || !/^[\x21-\x7e]+$/u.test(v))
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key is required");
  return v;
}
function body<T>(fn: () => T) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ZodError)
      throw new AppError(
        "CLASSROOM_VALIDATION_FAILED",
        422,
        "Classroom request validation failed",
        false,
        e.issues.map((i) => ({ field: i.path.join(".") || "body", reason: i.message })),
      );
    throw e;
  }
}
function month(v: unknown) {
  if (v === undefined) return new Date().toISOString().slice(0, 7) + "-01";
  const p = z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])-01$/u)
    .safeParse(v);
  if (!p.success) throw new AppError("INVALID_MONTH", 400, "month must be YYYY-MM-01");
  return p.data;
}
function attendanceMonth(v: unknown) {
  const p = z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u)
    .safeParse(v);
  if (!p.success) throw new AppError("INVALID_MONTH", 400, "month must be YYYY-MM");
  return p.data;
}
function sid(v: unknown) {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError("INVALID_SESSION_ID", 400, "Session ID must be a UUID");
  return p.data;
}
function student(v: unknown) {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError("INVALID_STUDENT_ID", 400, "Student ID must be a UUID");
  return p.data;
}
function dateParam(v: unknown, name: string) {
  const p = z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u)
    .safeParse(v);
  if (!p.success) throw new AppError("INVALID_DATE_PARAM", 400, `${name} must be a YYYY-MM-DD date`);
  return p.data;
}
