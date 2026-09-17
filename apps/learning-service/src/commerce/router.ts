import { authenticateSepay, paymentMode, sepayConfig, sepaySchema } from "./sepay.js";
import { Router, type Request } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../authoring/model.js";
import { orderCreateSchema, paymentSchema } from "./model.js";
import type { LearningCommerceService } from "./service.js";

const uuid = z.string().uuid();
export function learningCommerceRouter(
  service: LearningCommerceService,
  verify: Record<
    "enroll" | "myCourses" | "roster" | "orderCreate" | "orderRead" | "payment",
    (token: string) => Promise<ActorContext>
  > & {
    dashboardRevenue?: (token: string) => Promise<ActorContext>;
  },
): Router {
  const r = Router();
  r.post("/api/v1/payments/sepay/webhook", async (req, res, next) => {
    try {
      authenticateSepay(req.header("authorization"));
      const transaction = body(() => sepaySchema.parse(req.body));
      res.status(200).json(await service.receiveSepay(transaction, context().correlationId));
    } catch (error) {
      next(error);
    }
  });
  r.post("/api/v1/courses/:courseId/enrollments", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.enroll, c.correlationId);
      strictEmpty(req.body);
      const result = await service.freeEnroll({
        courseId: id(req.params.courseId),
        actor,
        key: idempotency(req),
        correlationId: c.correlationId,
      });
      res
        .status(200)
        .json({ data: result.enrollment, meta: { ...meta(c.requestId), replayed: result.replayed } });
    } catch (e) {
      next(e);
    }
  });
  r.get("/api/v1/me/courses", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.myCourses, c.correlationId);
      res.status(200).json({ data: await service.myCourses(actor), meta: meta(c.requestId) });
    } catch (e) {
      next(e);
    }
  });
  r.get("/api/v1/courses/:courseId/roster", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.roster, c.correlationId);
      res
        .status(200)
        .json({ data: await service.roster(id(req.params.courseId), actor), meta: meta(c.requestId) });
    } catch (e) {
      next(e);
    }
  });
  r.post("/api/v1/orders", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.orderCreate, c.correlationId);
      if (paymentMode() === "sepay") sepayConfig();
      const result = await service.createOrder({
        actor,
        request: body(() => orderCreateSchema.parse(req.body)),
        key: idempotency(req),
        correlationId: c.correlationId,
        ...classroomActor(req),
      });
      res.status(201).json({ data: result.order, meta: { ...meta(c.requestId), replayed: result.replayed } });
    } catch (e) {
      next(e);
    }
  });
  r.get("/api/v1/orders/:orderId", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.orderRead, c.correlationId);
      res
        .status(200)
        .json({ data: await service.orderDetail(id(req.params.orderId), actor), meta: meta(c.requestId) });
    } catch (e) {
      next(e);
    }
  });
  r.post("/api/v1/orders/:orderId/simulate-payment", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.payment, c.correlationId);
      if (paymentMode() !== "simulation")
        throw new AppError("PAYMENT_SIMULATION_DISABLED", 403, "Payment simulation is disabled");
      const result = await service.simulatePayment({
        orderId: id(req.params.orderId),
        actor,
        request: body(() => paymentSchema.parse(req.body)),
        key: idempotency(req),
        correlationId: c.correlationId,
        ...classroomActor(req),
      });
      res.status(200).json({ data: result.order, meta: { ...meta(c.requestId), replayed: result.replayed } });
    } catch (e) {
      next(e);
    }
  });
  r.get("/api/v1/admin/dashboard/revenue", async (req, res, next) => {
    try {
      const c = context();
      const actor = await requiredActor(req, verify.dashboardRevenue ?? verify.orderRead, c.correlationId);
      if (!actor.roles.includes("ADMIN"))
        throw new AppError("ADMIN_REQUIRED", 403, "Admin authorization is required");
      const range = typeof req.query.range === "string" ? req.query.range : "30d";
      const data = await service.revenueDashboard(actor, range);
      res.status(200).json({ data, meta: meta(c.requestId) });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
function context() {
  const value = currentRequestContext();
  if (!value) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return value;
}
function id(v: unknown) {
  const parsed = uuid.safeParse(v);
  if (!parsed.success) throw new AppError("INVALID_RESOURCE_ID", 400, "Resource ID must be a UUID");
  return parsed.data;
}
async function requiredActor(
  req: Request,
  verify: (token: string) => Promise<ActorContext>,
  correlationId: string,
) {
  try {
    const values = headerValues(req, "x-actor-context");
    if (values.length !== 1 || !values[0] || values[0].length > 4096) throw new Error();
    const actor = await verify(values[0]);
    if (actor.correlationId !== correlationId) throw new Error();
    return actor;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
function classroomActor(req: Request) {
  const values = headerValues(req, "x-classroom-actor-context");
  return values.length === 1 && values[0] && values[0].length <= 4096
    ? { classroomActorContext: values[0] }
    : {};
}
function headerValues(req: Request, name: string) {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === name) values.push(req.rawHeaders[i + 1] ?? "");
  return values;
}
function idempotency(req: Request) {
  try {
    const values = headerValues(req, "idempotency-key");
    if (values.length !== 1) throw new Error();
    return validateIdempotencyKey(values[0]);
  } catch {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
  }
}
function body<T>(parse: () => T) {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError)
      throw new AppError(
        "COMMERCE_VALIDATION_FAILED",
        422,
        "Commerce request validation failed",
        false,
        error.issues.map((issue) => ({ field: issue.path.join(".") || "body", reason: issue.message })),
      );
    throw error;
  }
}
function strictEmpty(value: unknown) {
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length)
    throw new AppError("COMMERCE_VALIDATION_FAILED", 422, "Request body must be empty");
}
function meta(requestId: string) {
  return { requestId, timestamp: new Date().toISOString() };
}
