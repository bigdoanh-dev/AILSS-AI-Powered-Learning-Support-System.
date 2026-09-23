import { SepayRecoveryRepository } from "./commerce/recovery-repository.js";
import { SepayRecoveryRunner } from "./commerce/recovery-runner.js";
import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
import { LearningCatalogRepository } from "./catalog/repository.js";
import { learningCatalogRouter } from "./catalog/router.js";
import { LearningCatalogService } from "./catalog/service.js";
import {
  loadPublicKey,
  loadPrivateKey,
  verifyActorContext,
  verifyServiceToken,
} from "../../../packages/security/src/index.js";
import { createClassroomOfferingContextClient } from "./classroom-client.js";
import { createIdentityPublicProfileClient } from "./identity-client.js";
import { LearningAuthoringRepository } from "./authoring/repository.js";
import { LearningAuthoringService } from "./authoring/service.js";
import { learningAuthoringRouter } from "./authoring/router.js";
import { LearningOutboxRelay } from "./authoring/relay.js";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { LearningLifecycleRepository } from "./lifecycle/repository.js";
import { LearningLifecycleService } from "./lifecycle/service.js";
import { learningLifecycleRouter } from "./lifecycle/router.js";
import { createLearningAdminProofVerifier } from "./admin-proof.js";
import { LearningReconciliationRepository } from "./reconciliation/repository.js";
import { ArchivedCourseProjectionCleanup } from "./reconciliation/archive-cleanup.js";
import { LearningReconciliationRunner } from "./reconciliation/runner.js";
import { MinioStorage } from "../../../packages/storage/src/index.js";
import { LearningLessonRepository } from "./lessons/repository.js";
import { LearningLessonService } from "./lessons/service.js";
import { learningLessonRouter } from "./lessons/router.js";
import { LearningOfferingRepository } from "./offerings/repository.js";
import { LearningOfferingService } from "./offerings/service.js";
import { learningOfferingRouter } from "./offerings/router.js";
import { learningClassLinkRouter } from "./class-link-router.js";
import { learningQuizEligibilityRouter } from "./quiz-eligibility-router.js";
import { LearningCommerceRepository } from "./commerce/repository.js";
import { LearningCommerceService } from "./commerce/service.js";
import { learningCommerceRouter } from "./commerce/router.js";
import { createCommerceClassroomClient } from "./commerce/classroom-client.js";
import { EntitlementFulfillmentConsumer } from "./commerce/worker.js";
import { learningInteractionEligibilityRouter } from "./interaction-eligibility-router.js";
import { LearningProgressRepository } from "./progress/repository.js";
import { LearningProgressService } from "./progress/service.js";
import { learningProgressRouter } from "./progress/router.js";
import { learningAiContextRouter } from "./ai-context-router.js";
import { CassandraFinanceRepository, LearningFinanceService, learningFinanceRouter, resolvePaymentProvider } from "./finance/index.js";
import { AdaptiveRuntimeRepository } from "./adaptive/runtime-repository.js";
import { adaptiveRuntimeRouter } from "./adaptive/runtime-router.js";
import { MasteryIngestionRepository } from "./adaptive/mastery-ingestion-repository.js";
import { MasteryRecalculationConsumer } from "./adaptive/mastery-consumer.js";
import { adaptiveInternalRouter } from "./adaptive/internal-router.js";
import { learningMaterialsInternalRouter } from "./materials/internal-router.js";
import { AuthoritativePlanContextProvider } from "./adaptive/plan-context.js";

const manifest: ServiceManifest = {
  serviceId: "learning-service",
  ownerDomain: "Learning",
  defaultPort: 8102,
  keyspace: "learning_keyspace",
  cassandraRole: "svc_learning",
  publicApiIds: [...Array.from({ length: 28 }, (_, i) => `LRN-${String(i + 1).padStart(2, "0")}`), "LRN-31"],
  internalApiIds: ["INT-LRN-01", "INT-LRN-02", "INT-LRN-03", "INT-LRN-04"],
  producedEvents: [
    "learning.course.created.v1",
    "learning.course.published.v1",
    "learning.course.enrolled.v1",
    "learning.progress.updated.v1",
    "learning.order.paid.v1",
    "system.projection.reconcile.v1",
    "system.audit.requested.v1",
  ],
  consumedQueues: ["learning.entitlement.fulfill.q", "assessment.quiz.submitted.mastery.q", "assessment.quiz.graded.mastery.q", "learning.lesson.completed.mastery.q"],
};
await startService(manifest, {
  configure: async (app, config, context) => {
    const cassandra = context.cassandra;
    if (!cassandra) throw new Error("Learning catalog requires Cassandra");
    if (!config.LEARNING_CURSOR_HMAC_KEY) {
      throw new Error("Learning catalog requires a cursor HMAC key");
    }
    const repository = new LearningCatalogRepository(context.cassandra);
    const service = new LearningCatalogService(
      {
        getCanonicalCourse: (courseId) => repository.getCanonicalCourse(courseId),
        getSlugLookup: (slug) => repository.getSlugLookup(slug),
        listCategoryPartition: (input) => repository.listCategoryPartition(input),
        listSearchPartition: (input) => repository.listSearchPartition(input),
      },
      config.LEARNING_CURSOR_HMAC_KEY,
      context.metrics,
    );
    app.use(learningCatalogRouter(service, context.metrics));
    if (!config.CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH)
      throw new Error("Learning INT-LRN-02 requires Classroom public key");
    const classroomServiceKey = await loadPublicKey(config.CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH);
    app.use(
      learningClassLinkRouter(repository, (token) =>
        verifyServiceToken(token, classroomServiceKey, {
          issuer: config.SERVICE_TOKEN_ISSUER,
          audience: "learning-service",
          purpose: "learning.course.class-link.read",
          kid: config.CLASSROOM_SERVICE_TOKEN_KID,
        }),
      ),
    );
    if (!config.ASSESSMENT_SERVICE_TOKEN_PUBLIC_KEY_PATH)
      throw new Error("Learning INT-LRN-01 requires Assessment public key");
    const assessmentServiceKey = await loadPublicKey(config.ASSESSMENT_SERVICE_TOKEN_PUBLIC_KEY_PATH);
    if (!config.AI_SERVICE_TOKEN_PUBLIC_KEY_PATH)
      throw new Error("Learning INT-LRN-04 requires AI public key");
    const aiServiceKey = await loadPublicKey(config.AI_SERVICE_TOKEN_PUBLIC_KEY_PATH);
    app.use(
      learningAiContextRouter(repository, (token) =>
        verifyServiceToken(token, aiServiceKey, {
          issuer: config.SERVICE_TOKEN_ISSUER,
          audience: "learning-service",
          purpose: "learning.course.ai-context.read",
          kid: config.AI_SERVICE_TOKEN_KID,
        }),
      ),
    );
    if (!config.ACTOR_CONTEXT_PUBLIC_KEY_PATH)
      throw new Error("Learning requires Gateway actor-context public key");
    const actorKey = await loadPublicKey(config.ACTOR_CONTEXT_PUBLIC_KEY_PATH);
    const commerceRepository = new LearningCommerceRepository(context.cassandra);
    app.use(
      learningQuizEligibilityRouter(
        Object.assign(repository, {
          entitlement: (studentId: string, courseId: string) =>
            commerceRepository.entitlement(studentId, courseId),
        }),
        (token) =>
          verifyServiceToken(token, assessmentServiceKey, {
            issuer: config.SERVICE_TOKEN_ISSUER,
            audience: "learning-service",
            purpose: "learning.course.quiz-eligibility.read",
            kid: config.ASSESSMENT_SERVICE_TOKEN_KID,
          }),
        (token) =>
          verifyActorContext(token, actorKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: "assessment-service",
            purpose: "assessment.attempt.start",
            kid: config.ACTOR_CONTEXT_KID,
            clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          }),
      ),
    );
    if (!config.INTERACTION_SERVICE_TOKEN_PUBLIC_KEY_PATH)
      throw new Error("Learning INT-LRN-03 requires Interaction public key");
    const interactionKey = await loadPublicKey(config.INTERACTION_SERVICE_TOKEN_PUBLIC_KEY_PATH);
    app.use(
      learningInteractionEligibilityRouter(
        Object.assign(repository, {
          entitlement: (studentId: string, courseId: string) =>
            commerceRepository.entitlement(studentId, courseId),
          progress: (studentId: string, courseId: string) =>
            new LearningProgressRepository(cassandra).progress(studentId, courseId),
        }),
        (token) =>
          verifyServiceToken(token, interactionKey, {
            issuer: config.SERVICE_TOKEN_ISSUER,
            audience: "learning-service",
            purpose: "learning.course.interaction-eligibility.read",
            kid: config.INTERACTION_SERVICE_TOKEN_KID,
          }),
        (token) =>
          verifyActorContext(token, actorKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: "interaction-service",
            purpose: "interaction.comment.eligibility",
            kid: config.ACTOR_CONTEXT_KID,
            clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          }),
      ),
    );
    const identity = await createIdentityPublicProfileClient(config);
    const classroomContext = await createClassroomOfferingContextClient(config);
    const authoringRepository = new LearningAuthoringRepository(context.cassandra);
    const authoring = new LearningAuthoringService(
      authoringRepository,
      identity,
      config.LEARNING_CURSOR_HMAC_KEY,
    );
    const verifier = (purpose: string) => (token: string) =>
      verifyActorContext(token, actorKey, {
        issuer: config.ACTOR_CONTEXT_ISSUER,
        audience: "learning-service",
        purpose,
        kid: config.ACTOR_CONTEXT_KID,
        clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
      });
    app.use(
      learningAuthoringRouter(
        authoring,
        verifier("learning.course.create"),
        verifier("learning.course.update"),
        context.metrics,
      ),
    );
    if (!config.JWT_PUBLIC_KEY_PATH) throw new Error("Learning lifecycle requires Identity public key");
    const adminProof = await createLearningAdminProofVerifier(config.JWT_PUBLIC_KEY_PATH, config.JWT_KID);
    const lifecycleRepository = new LearningLifecycleRepository(context.cassandra);
    const reconciliationRepository = new LearningReconciliationRepository(context.cassandra);
    const lifecycle = new LearningLifecycleService(
      authoringRepository,
      lifecycleRepository,
      reconciliationRepository,
      identity,
      (input) => adminProof.verify(input),
      config.LEARNING_CURSOR_HMAC_KEY,
    );
    app.use(
      learningLifecycleRouter(
        lifecycle,
        {
          submit: verifier("learning.course.submit"),
          publish: verifier("learning.course.publish"),
          archive: verifier("learning.course.archive"),
        },
        context.metrics,
      ),
    );
    const objectStorage =
      config.OBJECT_STORAGE_ACCESS_KEY && config.OBJECT_STORAGE_SECRET_KEY
        ? new MinioStorage(
            config.OBJECT_STORAGE_BUCKET,
            {
              endPoint: config.OBJECT_STORAGE_ENDPOINT,
              port: config.OBJECT_STORAGE_PORT,
              useSSL: config.OBJECT_STORAGE_USE_SSL,
              accessKey: config.OBJECT_STORAGE_ACCESS_KEY,
              secretKey: config.OBJECT_STORAGE_SECRET_KEY,
            },
            config.OBJECT_STORAGE_PUBLIC_URL,
          )
        : undefined;
    const lessons = new LearningLessonService(
      new LearningLessonRepository(context.cassandra),
      identity,
      objectStorage,
      config.LEARNING_CURSOR_HMAC_KEY,
    );
    app.use(
      learningLessonRouter(
        lessons,
        {
          list: verifier("learning.lesson.list"),
          read: verifier("learning.lesson.read"),
          create: verifier("learning.lesson.create"),
          update: verifier("learning.lesson.update"),
        },
        context.metrics,
      ),
    );
    const offerings = new LearningOfferingService(
      new LearningOfferingRepository(context.cassandra),
      identity,
      config.LEARNING_CURSOR_HMAC_KEY,
      classroomContext,
    );
    app.use(
      learningOfferingRouter(offerings, {
        catalog: verifier("learning.offering.catalog"),
        detail: verifier("learning.offering.detail"),
        create: verifier("learning.offering.create"),
        update: verifier("learning.offering.update"),
        publish: verifier("learning.offering.publish"),
        course: verifier("learning.offering.course-list"),
        owned: verifier("learning.offering.owned"),
      }),
    );
    const paymentRecovery = new SepayRecoveryRepository(context.cassandra);
    const commerce = new LearningCommerceService(
      commerceRepository,
      await createCommerceClassroomClient(config),
      classroomContext,
      config.LEARNING_CURSOR_HMAC_KEY,
      paymentRecovery,
    );
    app.use(
      learningCommerceRouter(commerce, {
        enroll: verifier("learning.enrollment.create"),
        myCourses: verifier("learning.enrollment.my-courses"),
        roster: verifier("learning.enrollment.roster"),
        orderCreate: verifier("learning.order.create"),
        orderRead: verifier("learning.order.read"),
        payment: verifier("learning.order.payment"),
        dashboardRevenue: verifier("learning.admin.dashboard.revenue"),
      }),
    );
    const finance = new LearningFinanceService({
      repository: commerceRepository,
      paymentProvider: resolvePaymentProvider(process.env),
      persistence: new CassandraFinanceRepository(context.cassandra),
    });
    app.use(learningFinanceRouter(finance, verifier("learning.refund.create")));
    const progress = new LearningProgressService(
      new LearningProgressRepository(context.cassandra),
      config.LEARNING_CURSOR_HMAC_KEY,
      config.PLATFORM_TENANT_ID,
    );
    app.use(
      learningProgressRouter(progress, {
        read: verifier("learning.progress.read"),
        complete: verifier("learning.progress.complete"),
      }),
    );
    const adaptiveRepository = new AdaptiveRuntimeRepository(context.cassandra);
    if (!config.SERVICE_TOKEN_PRIVATE_KEY_PATH)
      throw new Error("Learning adaptive plan requires its service private key");
    const planContext = new AuthoritativePlanContextProvider(
      new LearningLessonRepository(context.cassandra),
      config.ASSESSMENT_SERVICE_URL,
      await loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH),
      config.SERVICE_TOKEN_ISSUER,
      config.SERVICE_TOKEN_KID,
      config.INTERNAL_HTTP_TIMEOUT_MS,
    );
    app.use(
      adaptiveRuntimeRouter(
        adaptiveRepository,
        verifier("learning.adaptive.student"),
        planContext,
      ),
    );
    app.use(
      adaptiveInternalRouter(adaptiveRepository, (token) =>
        verifyServiceToken(token, aiServiceKey, {
          issuer: config.SERVICE_TOKEN_ISSUER,
          audience: "learning-service",
          purpose: "learning.adaptive.ai.read",
          kid: config.AI_SERVICE_TOKEN_KID,
        }), async (studentId, courseId) => (await commerceRepository.entitlement(studentId, courseId))?.state === "ACTIVE",
      ),
    );
    app.use(
      learningMaterialsInternalRouter(
        new LearningLessonRepository(context.cassandra),
        objectStorage,
        (token) => verifyServiceToken(token, aiServiceKey, {
          issuer: config.SERVICE_TOKEN_ISSUER,
          audience: "learning-service",
          purpose: "learning.materials.read",
          kid: config.AI_SERVICE_TOKEN_KID,
        }),
        async (studentId, courseId) =>
          (await commerceRepository.entitlement(studentId, courseId))?.state === "ACTIVE",
      ),
    );
    const cleanup = new ArchivedCourseProjectionCleanup(context.cassandra);
    const runner = new LearningReconciliationRunner(reconciliationRepository, async (item) => {
      if (item.projectionName === "ENTITLEMENT_FULFILLMENT_V1") {
        const metadata = JSON.parse(item.checksum) as { eventId?: unknown };
        if (typeof metadata.eventId !== "string") throw new Error("FULFILLMENT_EVENT_ID_REQUIRED");
        return commerce.fulfill(item.canonicalId, metadata.eventId);
      }
      return cleanup.execute(item);
    });
    const reconcileTimer = setInterval(() => void runner.runOnce(), 1_000);
    reconcileTimer.unref();
    const relay = config.ENABLE_RABBITMQ
      ? new LearningOutboxRelay(authoringRepository, authenticatedRabbitUrl(config), context.logger)
      : undefined;
    relay?.start();
    const paymentRunner = relay
      ? new SepayRecoveryRunner(paymentRecovery, commerce, authoringRepository, relay, context.logger)
      : undefined;
    const paymentTimer = paymentRunner ? setInterval(() => void paymentRunner.tick(), 1000) : undefined;
    paymentTimer?.unref();
    const fulfillment = config.ENABLE_RABBITMQ
      ? new EntitlementFulfillmentConsumer(authenticatedRabbitUrl(config), reconciliationRepository)
      : undefined;
    await fulfillment?.start();
    const masteryConsumer = config.ENABLE_RABBITMQ
      ? new MasteryRecalculationConsumer(authenticatedRabbitUrl(config), new MasteryIngestionRepository(context.cassandra), new AdaptiveRuntimeRepository(context.cassandra), context.logger, context.metrics, planContext)
      : undefined;
    await masteryConsumer?.start();
    return async () => {
      clearInterval(reconcileTimer);
      if (paymentTimer) clearInterval(paymentTimer);
      await fulfillment?.close();
      await masteryConsumer?.close();
      await relay?.close();
    };
  },
});

function authenticatedRabbitUrl(config: AppConfig): string {
  if (!config.RABBITMQ_USERNAME || !config.RABBITMQ_PASSWORD)
    throw new Error("RabbitMQ credentials were not validated");
  const url = new URL(config.RABBITMQ_URL);
  url.username = config.RABBITMQ_USERNAME;
  url.password = config.RABBITMQ_PASSWORD;
  return url.toString();
}
