import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
import type { AppConfig } from "../../../packages/config/src/index.js";
import {
  loadPrivateKey,
  loadPublicKey,
  verifyActorContext,
  verifyServiceToken,
} from "../../../packages/security/src/index.js";
import { createClassroomClients } from "./clients.js";
import { classroomInternalRouter } from "./internal-router.js";
import { ClassroomOutboxRelay } from "./relay.js";
import { ClassroomRepository } from "./repository.js";
import { classroomRouter } from "./router.js";
import { ClassroomService } from "./service.js";
import { ClassroomPresence } from "./presence.js";
import { installClassroomPresenceWebSocket } from "./presence-ws.js";
const manifest: ServiceManifest = {
  serviceId: "classroom-service",
  ownerDomain: "Classroom",
  defaultPort: 8103,
  keyspace: "classroom_keyspace",
  cassandraRole: "svc_classroom",
  publicApiIds: Array.from({ length: 20 }, (_, i) => `CLS-${String(i + 1).padStart(2, "0")}`),
  internalApiIds: [
    "INT-CLS-01",
    "INT-CLS-02",
    "INT-CLS-03",
    "INT-CLS-04",
    "INT-CLS-05",
    "INT-CLS-06",
    "INT-CLS-07",
    "INT-CLS-08",
  ],
  producedEvents: [
    "classroom.class.created.v1",
    "classroom.student.joined.v1",
    "classroom.student.removed.v1",
    "system.notification.requested.v1",
    "system.audit.requested.v1",
  ],
  consumedQueues: [],
};
let presence: ClassroomPresence | undefined;
let presenceActorKey: Awaited<ReturnType<typeof loadPublicKey>> | undefined;
await startService(manifest, {
  onServer: async (server, config) => {
    if (!presence || !presenceActorKey) throw new Error("Classroom presence was not configured");
    return installClassroomPresenceWebSocket(server, config, presence, presenceActorKey);
  },
  configure: async (app, config, context) => {
    if (!context.cassandra) throw new Error("Classroom requires Cassandra");
    if (!config.PASSWORD_IDEMPOTENCY_HMAC_KEY) throw new Error("Classroom requires an idempotency HMAC key");
    if (!config.ACTOR_CONTEXT_PUBLIC_KEY_PATH)
      throw new Error("Classroom requires Gateway actor-context public key");
    const repository = new ClassroomRepository(context.cassandra);
    const actorKey = await loadPublicKey(config.ACTOR_CONTEXT_PUBLIC_KEY_PATH);
    presenceActorKey = actorKey;
    if (!config.SERVICE_TOKEN_PRIVATE_KEY_PATH)
      throw new Error("Classroom presence requires private service key");
    const presenceSigningKey = await loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH);
    const service = new ClassroomService(
      repository,
      await createClassroomClients(config),
      config.PASSWORD_IDEMPOTENCY_HMAC_KEY,
      presenceSigningKey,
      config.CLASSROOM_SERVICE_TOKEN_KID,
    );
    presence = new ClassroomPresence(repository, service, context.logger);
    const actor = (purpose: string) => (token: string) =>
      verifyActorContext(token, actorKey, {
        issuer: config.ACTOR_CONTEXT_ISSUER,
        audience: "classroom-service",
        purpose,
        kid: config.ACTOR_CONTEXT_KID,
        clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
      });
    app.use(
      classroomRouter(service, {
        create: actor("classroom.class.create"),
        detail: actor("classroom.class.detail"),
        update: actor("classroom.class.update"),
        deleteClass: actor("classroom.class.delete"),
        join: actor("classroom.class.join"),
        studentList: actor("classroom.class.student-list"),
        ownedList: actor("classroom.class.owned-list"),
        roster: actor("classroom.class.roster"),
        warnStudent: actor("classroom.class.member.warn"),
        removeStudent: actor("classroom.class.member.remove"),
        reset: actor("classroom.class.join-code.reset"),
        announce: actor("classroom.announcement.create"),
        announcements: actor("classroom.announcement.list"),
        sessionCreate: actor("classroom.session.create"),
        sessionUpdate: actor("classroom.session.update"),
        sessionList: actor("classroom.session.list"),
        sessionDetail: actor("classroom.session.detail"),
        attendance: actor("classroom.attendance.read"),
        attendanceHistory: actor("classroom.attendance.history"),
        presenceTicket: actor("classroom.presence.ticket"),
        manualAttendance: actor("classroom.attendance.manual"),
        schedulePublish: actor("classroom.schedule.publish"),
        schedule: actor("classroom.schedule.read"),
      }),
    );
    const internal = async (path: string | undefined, kid: string, purpose: string, caller: string) => {
      if (!path) throw new Error(`Classroom ${caller} provider key is required`);
      const key = await loadPublicKey(path);
      return {
        caller,
        verify: (token: string) =>
          verifyServiceToken(token, key, {
            issuer: config.SERVICE_TOKEN_ISSUER,
            audience: "classroom-service",
            purpose,
            kid,
          }),
      };
    };
    app.use(
      classroomInternalRouter(
        repository,
        service,
        {
          quiz: await internal(
            config.ASSESSMENT_SERVICE_TOKEN_PUBLIC_KEY_PATH,
            config.ASSESSMENT_SERVICE_TOKEN_KID,
            "classroom.quiz-eligibility.read",
            "assessment-service",
          ),
          interaction: await internal(
            config.INTERACTION_SERVICE_TOKEN_PUBLIC_KEY_PATH,
            config.INTERACTION_SERVICE_TOKEN_KID,
            "classroom.interaction-eligibility.read",
            "interaction-service",
          ),
          ai: await internal(
            config.AI_SERVICE_TOKEN_PUBLIC_KEY_PATH,
            config.AI_SERVICE_TOKEN_KID,
            "classroom.ai-context.read",
            "ai-service",
          ),
          learning: await internal(
            config.LEARNING_SERVICE_TOKEN_PUBLIC_KEY_PATH,
            config.LEARNING_SERVICE_TOKEN_KID,
            "classroom.offering-context.read",
            "learning-service",
          ),
          scheduleReserve: await internal(
            config.LEARNING_SERVICE_TOKEN_PUBLIC_KEY_PATH,
            config.LEARNING_SERVICE_TOKEN_KID,
            "classroom.schedule.reserve",
            "learning-service",
          ),
          scheduleReserveFulfillment: await internal(
            config.LEARNING_SERVICE_TOKEN_PUBLIC_KEY_PATH,
            config.LEARNING_SERVICE_TOKEN_KID,
            "classroom.schedule.reserve.fulfillment",
            "learning-service",
          ),
          scheduleConfirm: await internal(
            config.LEARNING_SERVICE_TOKEN_PUBLIC_KEY_PATH,
            config.LEARNING_SERVICE_TOKEN_KID,
            "classroom.schedule.confirm",
            "learning-service",
          ),
          scheduleRelease: await internal(
            config.LEARNING_SERVICE_TOKEN_PUBLIC_KEY_PATH,
            config.LEARNING_SERVICE_TOKEN_KID,
            "classroom.schedule.release",
            "learning-service",
          ),
          membershipActivate: await internal(
            config.LEARNING_SERVICE_TOKEN_PUBLIC_KEY_PATH,
            config.LEARNING_SERVICE_TOKEN_KID,
            "classroom.membership.activate",
            "learning-service",
          ),
        },
        actor("classroom.schedule.reserve"),
        (token) =>
          verifyActorContext(token, actorKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: "assessment-service",
            purpose: "assessment.attempt.start",
            kid: config.ACTOR_CONTEXT_KID,
            clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          }),
        actor("interaction.comment.eligibility"),
      ),
    );
    const relay = config.ENABLE_RABBITMQ
      ? new ClassroomOutboxRelay(repository, authenticatedRabbitUrl(config), context.logger)
      : undefined;
    relay?.start();
    const expiry = setInterval(() => void service.expireDueReservations().catch(() => undefined), 30_000);
    expiry.unref();
    return async () => {
      clearInterval(expiry);
      await relay?.close();
    };
  },
});

function authenticatedRabbitUrl(config: AppConfig) {
  if (!config.RABBITMQ_USERNAME || !config.RABBITMQ_PASSWORD)
    throw new Error("RabbitMQ credentials were not validated");
  const url = new URL(config.RABBITMQ_URL);
  url.username = config.RABBITMQ_USERNAME;
  url.password = config.RABBITMQ_PASSWORD;
  return url.toString();
}
