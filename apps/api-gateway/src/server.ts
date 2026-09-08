import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { readFile } from "node:fs/promises";
import express from "express";
import { pinoHttp } from "pino-http";
import { loadConfig } from "../../../packages/config/src/index.js";
import {
  errorEnvelope,
  errorMiddleware,
  requestContextMiddleware,
  sanitizeIdentityHeaders,
} from "../../../packages/http/src/index.js";
import { InProcessRateLimiter } from "../../../packages/http/src/rate-limiter.js";
import { createLogger, httpRequestSerializer } from "../../../packages/logger/src/index.js";
import { createMetrics } from "../../../packages/observability/src/index.js";
import { installFatalHandlers } from "../../../packages/runtime/src/index.js";
import { protectedIdentityProxyFactory } from "./protected-identity-proxy.js";
import { publicLecturerProxyFactory } from "./public-lecturer-proxy.js";
import { learningCoursesProxyFactory } from "./learning-courses-proxy.js";
import { learningAuthoringProxyFactory } from "./learning-authoring-proxy.js";
import { createAdminStepUpClient } from "./admin-step-up-client.js";
import { learningLifecycleProxyFactory } from "./learning-lifecycle-proxy.js";
import { learningLessonsProxyFactory } from "./learning-lessons-proxy.js";
import { learningOfferingsProxyFactory } from "./learning-offerings-proxy.js";
import { learningCommerceProxyFactory } from "./learning-commerce-proxy.js";
import { classroomProxyFactory } from "./classroom-proxy.js";
import { loginProxy, refreshProxy, registrationProxy } from "./registration-proxy.js";
import { assessmentProxyFactory } from "./assessment-proxy.js";
import { interactionProxyFactory } from "./interaction-proxy.js";
import { learningProgressProxyFactory } from "./learning-progress-proxy.js";
import { aiDocumentProxyFactory } from "./ai-document-proxy.js";
import { notificationProxyFactory } from "./notification-proxy.js";

const config = loadConfig({
  APP_NAME: "api-gateway",
  SERVICE_ID: "api-gateway",
  PORT: "8080",
  ...process.env,
});
const logger = createLogger({
  service: "api-gateway",
  environment: config.NODE_ENV,
  level: config.LOG_LEVEL,
});
const metrics = createMetrics("api-gateway");
const readLimiter = new InProcessRateLimiter();
const authLimiter = new InProcessRateLimiter();
const adminStepUp = await createAdminStepUpClient(config);
const protectedProxy = await protectedIdentityProxyFactory(config, adminStepUp);
const publicLecturerHandler = await publicLecturerProxyFactory(config);
const learningCourses = await learningCoursesProxyFactory(config);
const learningAuthoring = await learningAuthoringProxyFactory(config);

const learningLifecycle = await learningLifecycleProxyFactory(config, adminStepUp);
const learningLessons = await learningLessonsProxyFactory(config);
const learningOfferings = await learningOfferingsProxyFactory(config);
const learningCommerce = await learningCommerceProxyFactory(config);
const classroom = await classroomProxyFactory(config);
const assessment = await assessmentProxyFactory(config);
const interaction = await interactionProxyFactory(config, adminStepUp, (record) =>
  logger.info(record, "interaction moderation audit"),
);
const learningProgress = await learningProgressProxyFactory(config);
const aiDocuments = await aiDocumentProxyFactory(config);
const notifications = await notificationProxyFactory(config);
const logoutHandler = protectedProxy.handler({
  method: "POST",
  path: "/api/v1/auth/logout",
  purpose: config.ACTOR_CONTEXT_PURPOSE,
  onInvalidBearer: () => metrics.identityLogouts.inc({ outcome: "invalid_bearer" }),
});
const profileReadHandler = protectedProxy.handler({
  method: "GET",
  path: "/api/v1/me",
  purpose: "identity.profile.read",
  onInvalidBearer: () => metrics.identityProfileReads.inc({ outcome: "invalid_bearer" }),
});
const profileUpdateHandler = protectedProxy.handler({
  method: "PATCH",
  path: "/api/v1/me",
  purpose: "identity.profile.update",
  forwardBody: true,
  forwardIdempotencyKey: true,
  onInvalidBearer: () => metrics.identityProfileUpdates.inc({ outcome: "invalid_bearer" }),
});
const passwordChangeHandler = protectedProxy.handler({
  method: "POST",
  path: "/api/v1/me/password",
  purpose: "identity.password.change",
  forwardBody: true,
  forwardIdempotencyKey: true,
  timeoutMs: config.PASSWORD_CHANGE_HTTP_TIMEOUT_MS,
  onInvalidBearer: () => metrics.identityPasswordChanges.inc({ outcome: "invalid_bearer" }),
});
const adminSearchHandler = protectedProxy.handler({
  method: "GET",
  path: "/api/v1/admin/users",
  purpose: "identity.admin.users.search",
  forwardQuery: true,
  onInvalidBearer: () => metrics.identityAdminAuthorization.inc({ outcome: "invalid_bearer" }),
});
const adminDetailHandler = protectedProxy.handler({
  method: "GET",
  path: "/api/v1/admin/users/:userId",
  upstreamPath: (request) => `/api/v1/admin/users/${encodeURIComponent(String(request.params.userId))}`,
  purpose: "identity.admin.user.detail",
  onInvalidBearer: () => metrics.identityAdminAuthorization.inc({ outcome: "invalid_bearer" }),
});
const adminStatusHandler = protectedProxy.handler({
  method: "PATCH",
  path: "/api/v1/admin/users/:userId/status",
  upstreamPath: (request) =>
    `/api/v1/admin/users/${encodeURIComponent(String(request.params.userId))}/status`,
  purpose: "identity.admin.user.status.change",
  forwardBody: true,
  forwardIdempotencyKey: true,
  timeoutMs: config.PASSWORD_CHANGE_HTTP_TIMEOUT_MS,
  onInvalidBearer: () => metrics.identityAdminAuthorization.inc({ outcome: "invalid_bearer" }),
});
const adminLecturerVerifyHandler = protectedProxy.handler({
  method: "POST",
  path: "/api/v1/admin/lecturers/:userId/verify",
  upstreamPath: (request) =>
    `/api/v1/admin/lecturers/${encodeURIComponent(String(request.params.userId))}/verify`,
  purpose: "identity.admin.lecturer.verify",
  forwardBody: true,
  forwardIdempotencyKey: true,
  timeoutMs: config.PASSWORD_CHANGE_HTTP_TIMEOUT_MS,
  onInvalidBearer: () => metrics.identityAdminAuthorization.inc({ outcome: "invalid_bearer" }),
});
const app = express();
app.disable("x-powered-by");
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
});
app.use(sanitizeIdentityHeaders());
app.use(requestContextMiddleware());
app.use(pinoHttp({ logger, serializers: { req: httpRequestSerializer } }));
app.use(express.json({ limit: config.HTTP_BODY_LIMIT }));
app.use(readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)));
app.post(
  "/api/v1/auth/register",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  registrationProxy(config),
);
app.post(
  "/api/v1/auth/login",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  loginProxy(config),
);
app.post(
  "/api/v1/auth/refresh",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  refreshProxy(config),
);
app.post(
  "/api/v1/auth/logout",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  logoutHandler,
);
app.get("/api/v1/me", profileReadHandler);
for (const [method, path, action] of [
  ["POST", "/api/v1/lecturer-applications", "submit"],
  ["GET", "/api/v1/me/lecturer-application", "mine"],
  ["GET", "/api/v1/admin/lecturer-applications", "list"],
  ["GET", "/api/v1/admin/lecturer-applications/:applicationId", "detail"],
  ["POST", "/api/v1/admin/lecturer-applications/:applicationId/decision", "decision"],
] as const) {
  const handler = protectedProxy.handler({
    method,
    path,
    purpose: `identity.lecturer-application.${action}`,
    forwardBody: method === "POST",
    forwardQuery: true,
    forwardIdempotencyKey: method === "POST",
    upstreamPath: (request) =>
      path.replace(":applicationId", encodeURIComponent(String(request.params.applicationId))),
    onInvalidBearer: () => metrics.identityAdminAuthorization.inc({ outcome: "invalid_bearer" }),
  });
  app[method === "GET" ? "get" : "post"](
    path,
    authLimiter.middleware(
      Number(
        process.env[
          path.includes("/admin/")
            ? "RATE_LIMIT_ADMIN_PER_MINUTE"
            : method === "GET"
              ? "RATE_LIMIT_READ_PER_MINUTE"
              : "RATE_LIMIT_WRITE_PER_MINUTE"
        ] ?? 30,
      ),
    ),
    handler,
  );
}
app.get("/api/v1/lecturers/:lecturerId", publicLecturerHandler);
app.get(
  "/api/v1/courses",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  learningCourses.catalog,
);
app.post(
  "/api/v1/courses",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningAuthoring.create,
);
app.get("/api/v1/offerings", learningOfferings.catalog);
app.get("/api/v1/offerings/:offeringId", learningOfferings.detail);
app.post(
  "/api/v1/courses/:courseId/offerings",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningOfferings.create,
);
app.patch(
  "/api/v1/offerings/:offeringId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningOfferings.update,
);
app.post(
  "/api/v1/offerings/:offeringId/publish",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningOfferings.publish,
);
app.get("/api/v1/courses/:courseId/offerings", learningOfferings.course);
app.get("/api/v1/me/owned-offerings", learningOfferings.owned);
app.post(
  "/api/v1/courses/:courseId/enrollments",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningCommerce.enroll,
);
app.get("/api/v1/me/courses", learningCommerce.myCourses);
app.get("/api/v1/courses/:courseId/roster", learningCommerce.roster);
app.get("/api/v1/courses/:courseId/progress", learningProgress.read);
app.put(
  "/api/v1/lessons/:lessonId/completion",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningProgress.complete,
);
app.post(
  "/api/v1/orders",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningCommerce.orderCreate,
);
app.get("/api/v1/orders/:orderId", learningCommerce.orderRead);
app.post(
  "/api/v1/orders/:orderId/simulate-payment",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningCommerce.payment,
);
app.post(
  "/api/v1/classes",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.create,
);
app.post(
  "/api/v1/classes/join",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.join,
);
app.get("/api/v1/me/classes", classroom.studentList);
app.get("/api/v1/me/schedule", classroom.schedule);
app.get("/api/v1/me/owned-classes", classroom.ownedList);
app.get("/api/v1/classes/:classId", classroom.detail);
app.patch(
  "/api/v1/classes/:classId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.update,
);
app.get("/api/v1/classes/:classId/members", classroom.roster);
app.post(
  "/api/v1/classes/:classId/join-code/reset",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.reset,
);
app.post(
  "/api/v1/classes/:classId/announcements",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.announce,
);
app.get("/api/v1/classes/:classId/announcements", classroom.announcements);
app.post(
  "/api/v1/classes/:classId/sessions",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.sessionCreate,
);
app.patch(
  "/api/v1/classes/:classId/sessions/:sessionId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.sessionUpdate,
);
app.get("/api/v1/classes/:classId/sessions", classroom.sessionList);
app.get("/api/v1/class-sessions/:sessionId", classroom.sessionDetail);
app.get("/api/v1/class-sessions/:sessionId/attendance", classroom.attendance);
app.get("/api/v1/me/attendance", classroom.attendanceHistory);
app.post(
  "/api/v1/class-sessions/:sessionId/presence-tickets",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.presenceTicket,
);
app.put(
  "/api/v1/class-sessions/:sessionId/attendance/:studentId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.manualAttendance,
);
app.post(
  "/api/v1/classes/:classId/schedule/publish",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.schedulePublish,
);
app.post(
  "/api/v1/quizzes",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  assessment.create,
);
app.get("/api/v1/quizzes/:quizId", assessment.detail);
app.patch(
  "/api/v1/quizzes/:quizId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  assessment.update,
);
app.post(
  "/api/v1/quizzes/:quizId/publish",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  assessment.publish,
);
app.get("/api/v1/targets/:targetType/:targetId/quizzes", assessment.list);
app.post(
  "/api/v1/quizzes/:quizId/attempts",
  express.json({ limit: "1kb", strict: true }),
  assessment.attemptStart,
);
app.get("/api/v1/attempts/:attemptId", assessment.attemptDetail);
app.post(
  "/api/v1/attempts/:attemptId/submit",
  express.json({ limit: "64kb", strict: true }),
  assessment.submit,
);
app.get("/api/v1/attempts/:attemptId/result", assessment.result);
app.get("/api/v1/quizzes/:quizId/results", assessment.results);
app.get("/api/v1/resources/:resourceType/:resourceId/comments", interaction.list);
app.post(
  "/api/v1/resources/:resourceType/:resourceId/comments",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  interaction.create,
);
app.patch(
  "/api/v1/comments/:commentId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  interaction.patch,
);
app.delete(
  "/api/v1/comments/:commentId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  interaction.remove,
);
app.get("/api/v1/courses/:courseId/reviews", interaction.reviewList);
app.post(
  "/api/v1/courses/:courseId/reviews",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  interaction.reviewCreate,
);
app.patch(
  "/api/v1/reviews/:reviewId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  interaction.reviewPatch,
);
app.delete(
  "/api/v1/reviews/:reviewId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  interaction.reviewRemove,
);
app.post(
  "/api/v1/reports",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  interaction.reportCreate,
);
app.post(
  "/api/v1/ai/documents/upload-intents",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  aiDocuments.intent,
);
app.post(
  "/api/v1/ai/documents/:documentId/complete",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  aiDocuments.complete,
);
app.get("/api/v1/ai/documents/:documentId", aiDocuments.read);
app.post(
  "/api/v1/ai/quiz-jobs",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  aiDocuments.quizCreate,
);
app.get("/api/v1/ai/jobs", aiDocuments.jobList);
app.get("/api/v1/ai/jobs/:jobId", aiDocuments.jobRead);
app.get("/api/v1/ai/jobs/:jobId/drafts", aiDocuments.draftList);
app.post(
  "/api/v1/ai/jobs/:jobId/cancel",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  aiDocuments.cancel,
);
app.get("/api/v1/ai/usage", aiDocuments.usage);
app.post(
  "/api/v1/ai/drafts/:draftId/approve",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  aiDocuments.approve,
);
app.get("/api/v1/notifications", notifications.list);
app.patch("/api/v1/notifications/:notificationId/read", notifications.read);
app.get("/api/v1/admin/reports", interaction.reportList);
app.post(
  "/api/v1/admin/reports/:reportId/moderate",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  interaction.reportModerate,
);
app.patch(
  "/api/v1/courses/:courseId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningAuthoring.update,
);
app.post(
  "/api/v1/courses/:courseId/submit-review",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningLifecycle.submit,
);
app.post(
  "/api/v1/admin/courses/:courseId/publish",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  learningLifecycle.publish,
);
app.post(
  "/api/v1/admin/courses/:courseId/archive",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  learningLifecycle.archive,
);
app.get(
  "/api/v1/courses/:courseId/lessons",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  learningLessons.list,
);
app.post(
  "/api/v1/courses/:courseId/lessons",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningLessons.create,
);
app.get(
  "/api/v1/lessons/:lessonId",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  learningLessons.read,
);
app.patch(
  "/api/v1/lessons/:lessonId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningLessons.update,
);
app.get(
  "/api/v1/courses/search",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  learningCourses.search,
);
app.get(
  "/api/v1/courses/by-slug/:slug",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  learningCourses.bySlug,
);
app.get(
  "/api/v1/courses/:courseId",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  learningCourses.detail,
);
app.patch(
  "/api/v1/me",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  profileUpdateHandler,
);
app.post(
  "/api/v1/me/password",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  passwordChangeHandler,
);
app.get(
  "/api/v1/admin/users",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  adminSearchHandler,
);
app.get(
  "/api/v1/admin/users/:userId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  adminDetailHandler,
);
app.patch(
  "/api/v1/admin/users/:userId/status",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  adminStatusHandler,
);
app.post(
  "/api/v1/admin/lecturers/:userId/verify",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  adminLecturerVerifyHandler,
);
app.get("/health/live", (_request, response) => response.json({ status: "UP", service: "api-gateway" }));
app.get("/health/ready", (_request, response) =>
  response.json({
    service: "api-gateway",
    ready: true,
    dependencies: [],
    checkedAt: new Date().toISOString(),
  }),
);
app.get("/metrics", async (_request, response) =>
  response.type(metrics.registry.contentType).send(await metrics.registry.metrics()),
);
app.all("/api/*path", (_request, response) =>
  response
    .status(501)
    .json(
      errorEnvelope("NOT_IMPLEMENTED_PHASE_7", "Gateway routing target is reserved by the Phase 5 contract"),
    ),
);
app.use(errorMiddleware);
if ((config.HTTPS_CERT_PATH === undefined) !== (config.HTTPS_KEY_PATH === undefined))
  throw new Error("HTTPS certificate and key must be configured together");
const server =
  config.HTTPS_CERT_PATH && config.HTTPS_KEY_PATH
    ? createSecureServer(
        {
          cert: await readFile(config.HTTPS_CERT_PATH),
          key: await readFile(config.HTTPS_KEY_PATH),
          minVersion: "TLSv1.2",
        },
        app,
      )
    : createServer(app);
const gatewayWebSocketCleanup = await classroom.installWebSocket(server);
await new Promise<void>((resolve) => server.listen(config.PORT, resolve));
logger.info({ operation: "startup", port: config.PORT }, "gateway started");
installFatalHandlers(logger, async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  gatewayWebSocketCleanup();
});
