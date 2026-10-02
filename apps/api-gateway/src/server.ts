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
import { httpMetricsMiddleware } from "../../../packages/observability/src/http.js";
import { installFatalHandlers } from "../../../packages/runtime/src/index.js";
import { protectedIdentityProxyFactory } from "./protected-identity-proxy.js";
import { publicLecturerProxyFactory } from "./public-lecturer-proxy.js";
import { learningCoursesProxyFactory } from "./learning-courses-proxy.js";
import { learningAuthoringProxyFactory } from "./learning-authoring-proxy.js";
import { createAdminStepUpClient } from "./admin-step-up-client.js";
import { learningLifecycleProxyFactory } from "./learning-lifecycle-proxy.js";
import { learningLessonsProxyFactory } from "./learning-lessons-proxy.js";
import { mediaProxy } from "./media-proxy.js";
import { mediaDeliveryProxy } from "./media-delivery-proxy.js";
import { learningOfferingsProxyFactory } from "./learning-offerings-proxy.js";
import { learningCommerceProxyFactory } from "./learning-commerce-proxy.js";
import { classroomProxyFactory } from "./classroom-proxy.js";
import {
  loginProxy,
  passwordResetProxy,
  refreshProxy,
  registrationProxy,
  socialLoginProxy,
} from "./registration-proxy.js";
import { assessmentProxyFactory } from "./assessment-proxy.js";
import { interactionProxyFactory } from "./interaction-proxy.js";
import { learningProgressProxyFactory } from "./learning-progress-proxy.js";
import { aiDocumentProxyFactory } from "./ai-document-proxy.js";
import { assistantProxyFactory } from "./assistant-proxy.js";
import { notificationProxyFactory } from "./notification-proxy.js";
import { socialConfigHandler } from "./social-config.js";
import { federationProxy } from "./federation-proxy.js";
import { adaptiveLearningProxyFactory } from "./adaptive-learning-proxy.js";
import { createUpstreamReadinessHandler, gatewayReadinessDependencies } from "./readiness.js";
import { monitoringHandler } from "./monitoring.js";
import {
  createGatewayCircuitBreakers,
  gatewayCircuitBreakerMiddleware,
  installGatewayFetchInterceptor,
} from "./circuit-breaker.js";

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
const globalLimiter = new InProcessRateLimiter();
const readLimiter = new InProcessRateLimiter();
const authLimiter = new InProcessRateLimiter();
const adminStepUp = await createAdminStepUpClient(config);
const protectedProxy = await protectedIdentityProxyFactory(config, adminStepUp);
const publicLecturerHandler = await publicLecturerProxyFactory(config);
const learningCourses = await learningCoursesProxyFactory(config);
const learningAuthoring = await learningAuthoringProxyFactory(config);
const adminMonitoring = await monitoringHandler(config);

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
const adaptiveLearning = await adaptiveLearningProxyFactory(config);
const aiDocuments = await aiDocumentProxyFactory(config);
const assistant = await assistantProxyFactory(config);
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
const adminStatsHandler = protectedProxy.handler({
  method: "GET",
  path: "/api/v1/admin/dashboard/stats",
  purpose: "identity.admin.dashboard.stats",
  onInvalidBearer: () => metrics.identityAdminAuthorization.inc({ outcome: "invalid_bearer" }),
});
const identitiesListHandler = protectedProxy.handler({
  method: "GET",
  path: "/api/v1/auth/identities",
  purpose: "identity.identities",
  onInvalidBearer: () => {},
});
const identitiesLinkHandler = protectedProxy.handler({
  method: "POST",
  path: "/api/v1/auth/identities/link",
  purpose: "identity.identities",
  forwardBody: true,
  onInvalidBearer: () => {},
});
const identitiesUnlinkHandler = protectedProxy.handler({
  method: "POST",
  path: "/api/v1/auth/identities/:provider/unlink",
  upstreamPath: (request) =>
    `/api/v1/auth/identities/${encodeURIComponent(String(request.params.provider))}/unlink`,
  purpose: "identity.identities",
  onInvalidBearer: () => {},
});
const app = express();
app.disable("x-powered-by");
app.use(httpMetricsMiddleware(metrics));
if (config.TRUST_PROXY_HOPS > 0) app.set("trust proxy", config.TRUST_PROXY_HOPS);
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(sanitizeIdentityHeaders());
app.use(requestContextMiddleware());
app.use(pinoHttp({ logger, serializers: { req: httpRequestSerializer } }));
app.use("/api/v1/payments/sepay/webhook", express.json({ limit: "16kb", strict: true }));
app.use("/api/v1/auth/saml", express.urlencoded({ extended: false, limit: "2mb" }));
app.use("/api/v1/auth/lti/launch", express.urlencoded({ extended: false, limit: "64kb" }));
app.use(express.json({ limit: config.HTTP_BODY_LIMIT }));
// Keep volumetric protection separate from route budgets. Reusing readLimiter here
// charged every read twice and cut the advertised per-route allowance in half.
app.use(globalLimiter.middleware(Number(process.env.RATE_LIMIT_GLOBAL_PER_MINUTE ?? 1_200)));
const circuitBreakers = createGatewayCircuitBreakers(config, logger);
const uninstallFetchInterceptor = installGatewayFetchInterceptor(circuitBreakers, config);
app.use(gatewayCircuitBreakerMiddleware(circuitBreakers, config.AI_PROVIDER_TIMEOUT_MS + 10_000));
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
for (const operation of ["request", "verify", "complete"] as const) {
  app.post(
    `/api/v1/auth/password-reset/${operation}`,
    authLimiter.middleware(operation === "request" ? 10 : 20),
    passwordResetProxy(config, operation),
  );
}
app.post(
  "/api/v1/auth/logout",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  logoutHandler,
);
app.get(
  "/api/v1/course-categories",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  learningCourses.categories,
);
app.get("/api/v1/auth/social/config", socialConfigHandler(config.GOOGLE_WEB_CLIENT_ID));
app.post(
  "/api/v1/auth/social/:provider",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  socialLoginProxy(config),
);
app.get(
  "/api/v1/auth/saml/:organizationId/metadata",
  federationProxy(
    config,
    (request) => `/api/v1/auth/saml/${encodeURIComponent(String(request.params.organizationId))}/metadata`,
    "GET",
  ),
);
app.get(
  "/api/v1/auth/saml/:organizationId/login",
  federationProxy(
    config,
    (request) => `/api/v1/auth/saml/${encodeURIComponent(String(request.params.organizationId))}/login`,
    "GET",
  ),
);
app.post(
  "/api/v1/auth/saml/:organizationId/acs",
  authLimiter.middleware(30),
  federationProxy(
    config,
    (request) => `/api/v1/auth/saml/${encodeURIComponent(String(request.params.organizationId))}/acs`,
    "POST",
  ),
);
app.get(
  "/api/v1/auth/lti/login",
  authLimiter.middleware(60),
  federationProxy(config, () => "/api/v1/auth/lti/login", "GET"),
);
app.post(
  "/api/v1/auth/lti/launch",
  authLimiter.middleware(60),
  federationProxy(config, () => "/api/v1/auth/lti/launch", "POST"),
);
app.get("/api/v1/auth/identities", identitiesListHandler);
app.post(
  "/api/v1/auth/identities/link",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  identitiesLinkHandler,
);
app.post(
  "/api/v1/auth/identities/:provider/unlink",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  identitiesUnlinkHandler,
);
app.get("/api/v1/me", profileReadHandler);
for (const method of ["GET", "PATCH"] as const) {
  const handler = protectedProxy.handler({
    method,
    path: "/api/v1/me/lecturer-profile",
    purpose: "identity.profile.lecturer-details",
    forwardBody: method === "PATCH",
    onInvalidBearer: () => {},
  });
  if (method === "GET") app.get("/api/v1/me/lecturer-profile", handler);
  else app.patch("/api/v1/me/lecturer-profile", authLimiter.middleware(30), handler);
}
for (const method of ["GET", "POST"] as const) {
  const handler = protectedProxy.handler({
    method,
    path: "/api/v1/me/avatar",
    purpose: "identity.profile.avatar",
    forwardBody: method === "POST",
    onInvalidBearer: () => {},
  });
  if (method === "GET") app.get("/api/v1/me/avatar", handler);
  else app.post("/api/v1/me/avatar", authLimiter.middleware(30), handler);
}
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
app.get("/api/v1/mastery/me", adaptiveLearning.mastery);
app.get("/api/v1/mastery/courses/:courseId", adaptiveLearning.courseMastery);
app.get("/api/v1/courses/:courseId/students/:studentId/mastery", adaptiveLearning.lecturerMastery);
app.get("/api/v1/courses/:courseId/mastery-summary", adaptiveLearning.lecturerMasterySummary);
app.get("/api/v1/mastery/outcomes/:outcomeId", adaptiveLearning.outcome);
app.post(
  "/api/v1/study-plan/generate",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  adaptiveLearning.generate,
);
app.get("/api/v1/study-plan/current", adaptiveLearning.current);
app.patch(
  "/api/v1/study-plan/items/:itemId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  adaptiveLearning.updateItem,
);
app.post(
  "/api/v1/study-plan/items/:itemId/:action",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  adaptiveLearning.itemAction,
);
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
app.post("/api/v1/payments/sepay/webhook", authLimiter.middleware(60), async (req, res, next) => {
  try {
    const upstream = await fetch(new URL("/api/v1/payments/sepay/webhook", config.LEARNING_SERVICE_URL), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: req.header("authorization") ?? "" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
    });
    res
      .status(upstream.status)
      .type("application/json")
      .send(await upstream.text());
  } catch (error) {
    next(error);
  }
});
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
app.delete(
  "/api/v1/classes/:classId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.deleteClass,
);
app.get("/api/v1/classes/:classId/members", classroom.roster);
app.post(
  "/api/v1/classes/:classId/members/:studentId/warnings",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.warnStudent,
);
app.delete(
  "/api/v1/classes/:classId/members/:studentId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  classroom.removeStudent,
);
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
app.post(
  "/api/v1/quizzes/:quizId/grades/:attemptId",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  assessment.gradeAttempt,
);
app.get("/api/v1/quizzes/:quizId/grades", assessment.listGrades);
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
app.post(
  "/api/v1/assistant/chat",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  assistant.chat,
);
app.get(
  "/api/v1/assistant/admin-status",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  assistant.adminStatus,
);
app.get(
  "/api/v1/assistant/conversations",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  assistant.conversationsList,
);
app.get(
  "/api/v1/assistant/conversations/:id",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  assistant.conversationDetail,
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
app.get(
  "/api/v1/me/courses/:courseId",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  learningAuthoring.manage,
);
app.get(
  "/api/v1/me/owned-courses",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  learningAuthoring.owned,
);
app.post(
  "/api/v1/courses/:courseId/retire",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningLifecycle.retire,
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
const mediaHandler = await mediaProxy(config);
app.get(
  "/playback/:assetId/:filename",
  mediaDeliveryProxy(
    process.env.MEDIA_DELIVERY_INTERNAL_URL ?? "http://media-delivery:8211",
    (process.env.MEDIA_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
  ),
);
app.post(
  "/api/v1/courses/:courseId/media-assets",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  mediaHandler,
);
app.get(
  "/api/v1/media-assets/:assetId",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  mediaHandler,
);
app.get(
  "/api/v1/media-assets/:assetId/upload",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  mediaHandler,
);
app.post(
  "/api/v1/media-assets/:assetId/captions",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  mediaHandler,
);
for (const action of ["parts", "complete", "cancel", "attach"])
  app.post(
    `/api/v1/media-assets/:assetId/${action}`,
    authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
    mediaHandler,
  );
app.post(
  "/api/v1/lessons/:lessonId/media-session",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  mediaHandler,
);
app.get(
  "/api/v1/courses/:courseId/trailer",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_READ_PER_MINUTE ?? 300)),
  mediaHandler,
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
app.get(
  "/api/v1/admin/dashboard/stats",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  adminStatsHandler,
);
app.get(
  "/api/v1/admin/monitoring",
  readLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  adminMonitoring,
);
app.get(
  "/api/v1/admin/dashboard/revenue",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  learningCommerce.dashboardRevenue,
);
app.get("/api/v1/me/dashboard/revenue", learningCommerce.lecturerRevenue);
app.get("/api/v1/me/payout-account", learningCommerce.payoutAccountRead);
app.post("/api/v1/me/payout-account", authLimiter.middleware(30), learningCommerce.payoutAccountSave);
app.get("/api/v1/admin/payouts", learningCommerce.adminPayouts);
app.post("/api/v1/admin/payouts/prepare", authLimiter.middleware(30), learningCommerce.preparePayouts);
app.post(
  "/api/v1/admin/payouts/:month/:lecturerId/approve",
  authLimiter.middleware(30),
  learningCommerce.approvePayout,
);
app.get("/api/v1/me/commission", learningCommerce.lecturerCommission);
app.get("/api/v1/admin/commission", authLimiter.middleware(30), learningCommerce.adminCommissionRead);
app.post("/api/v1/admin/commission", authLimiter.middleware(30), learningCommerce.adminCommissionSave);
app.post(
  "/api/v1/learning/refunds",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE ?? 60)),
  learningCommerce.refund,
);
app.get(
  "/api/v1/admin/audit-logs",
  authLimiter.middleware(Number(process.env.RATE_LIMIT_ADMIN_PER_MINUTE ?? 30)),
  interaction.auditLogs,
);
app.get("/health/live", (_request, response) => response.json({ status: "UP", service: "api-gateway" }));
app.get(
  "/health/ready",
  createUpstreamReadinessHandler(
    gatewayReadinessDependencies(process.env.AILSS_PROFILE, config),
    Math.min(config.INTERNAL_HTTP_TIMEOUT_MS, 2_000),
  ),
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
  uninstallFetchInterceptor();
  circuitBreakers.disposeAll();
});
