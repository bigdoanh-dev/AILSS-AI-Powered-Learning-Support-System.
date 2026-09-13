import { MinioStorage } from "../../../packages/storage/src/index.js";
import { ApplicationRepository } from "./lecturer-application/repository.js";
import { ApplicationService } from "./lecturer-application/service.js";
import { applicationRouter } from "./lecturer-application/router.js";
import { startApplicationRepair } from "./lecturer-application/worker.js";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../../../packages/config/src/index.js";
import {
  loadPrivateKey,
  loadPublicKey,
  publicJwk,
  signAccessToken,
  verifyActorContext,
  verifyStepUpProof,
  verifyServiceToken,
} from "../../../packages/security/src/index.js";
import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
import { IdentityLoginRepository } from "./login/repository.js";
import { loginRouter } from "./login/router.js";
import { LoginService } from "./login/service.js";
import { passwordRouter } from "./password/router.js";
import { IdentityPasswordRepository } from "./password/repository.js";
import { PasswordChangeService } from "./password/service.js";
import { PublicProfileRepository } from "./public-profile/repository.js";
import { publicProfileRouter } from "./public-profile/router.js";
import { PublicProfileService } from "./public-profile/service.js";
import { logoutRouter } from "./logout/router.js";
import { LogoutService } from "./logout/service.js";
import { IdentityProfileRepository } from "./profile/repository.js";
import { profileRouter } from "./profile/router.js";
import { ProfileService } from "./profile/service.js";
import { avatarRouter } from "./profile/avatar.js";
import { ProtectedIdentityRequestValidator } from "./profile/validator.js";
import { refreshRouter } from "./refresh/router.js";
import { RefreshService } from "./refresh/service.js";
import { hashPassword } from "./registration/password.js";
import { IdentityOutboxRelay } from "./registration/relay.js";
import { IdentityRegistrationRepository } from "./registration/repository.js";
import { registrationRouter } from "./registration/router.js";
import { RegistrationService } from "./registration/service.js";
import { IdentityAdminRepository } from "./admin/repository.js";
import { adminRouter } from "./admin/router.js";
import { IdentityAdminService } from "./admin/service.js";
import { LecturerVerifyRepository } from "./lecturer-verify/repository.js";
import { lecturerVerifyRouter } from "./lecturer-verify/router.js";
import { LecturerVerifyService } from "./lecturer-verify/service.js";
import { AdminStepUpService } from "./step-up/service.js";
import { adminStepUpRouter } from "./step-up/router.js";

const manifest: ServiceManifest = {
  serviceId: "identity-service",
  ownerDomain: "Identity",
  defaultPort: 8101,
  keyspace: "identity_keyspace",
  cassandraRole: "svc_identity",
  publicApiIds: Array.from({ length: 19 }, (_, i) => `IDN-${String(i + 1).padStart(2, "0")}`),
  internalApiIds: ["INT-IDN-01", "INT-IDN-02"],
  producedEvents: [
    "identity.user.registered.v1",
    "identity.user.status_changed.v1",
    "system.audit.requested.v1",
  ],
  consumedQueues: [],
};
await startService(manifest, {
  configure: async (app, config, context) => {
    if (!context.cassandra) throw new Error("Identity authentication requires Cassandra");
    if (
      !config.JWT_PRIVATE_KEY_PATH ||
      !config.JWT_PUBLIC_KEY_PATH ||
      !config.ACTOR_CONTEXT_PUBLIC_KEY_PATH ||
      !config.SERVICE_TOKEN_PUBLIC_KEY_PATH
    ) {
      throw new Error(
        "Identity authentication requires JWT, actor-context, and Learning service public key paths",
      );
    }
    const [privateKey, publicKey, actorContextPublicKey, learningPublicKey, dummyPasswordHash] =
      await Promise.all([
        loadPrivateKey(config.JWT_PRIVATE_KEY_PATH),
        loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
        loadPublicKey(config.ACTOR_CONTEXT_PUBLIC_KEY_PATH),
        loadPublicKey(config.SERVICE_TOKEN_PUBLIC_KEY_PATH),
        hashPassword(randomBytes(32).toString("base64url")),
      ]);
    const jwk = await publicJwk(publicKey, config.JWT_KID);
    const repository = new IdentityRegistrationRepository(context.cassandra);
    const registration = new RegistrationService({
      store: repository,
      logger: context.logger,
      metrics: context.metrics,
    });
    app.use(registrationRouter(registration, context.metrics));
    const loginRepository = new IdentityLoginRepository(context.cassandra);
    const accessTokenSigner = (input: {
      readonly subject: string;
      readonly roles: readonly string[];
      readonly sessionId: string;
      readonly tokenVersion: number;
      readonly issuedAtSeconds: number;
    }) =>
      signAccessToken(
        privateKey,
        {
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          kid: config.JWT_KID,
          clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
        },
        {
          subject: input.subject,
          roles: input.roles,
          sessionId: input.sessionId,
          tokenVersion: input.tokenVersion,
        },
        input.issuedAtSeconds,
      );
    const login = new LoginService({
      store: loginRepository,
      logger: context.logger,
      metrics: context.metrics,
      dummyPasswordHash,
      accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
      accessTokenSigner,
    });
    app.use(loginRouter(login, context.metrics));
    const refresh = new RefreshService({
      store: loginRepository,
      logger: context.logger,
      metrics: context.metrics,
      accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
      accessTokenSigner,
    });
    app.use(refreshRouter(refresh, context.metrics));
    const logout = new LogoutService({
      store: loginRepository,
      logger: context.logger,
      metrics: context.metrics,
    });
    app.use(
      logoutRouter(
        logout,
        (token) =>
          verifyActorContext(token, actorContextPublicKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: config.ACTOR_CONTEXT_AUDIENCE,
            purpose: config.ACTOR_CONTEXT_PURPOSE,
            kid: config.ACTOR_CONTEXT_KID,
          }),
        context.metrics,
      ),
    );
    const profileRepository = new IdentityProfileRepository(context.cassandra);
    const protectedValidator = new ProtectedIdentityRequestValidator(
      {
        getSession: (sessionId) => loginRepository.getSession(sessionId),
        getUser: (userId) => profileRepository.getUser(userId),
      },
      context.metrics,
      context.logger,
    );
    const profile = new ProfileService(
      profileRepository,
      protectedValidator,
      context.metrics,
      context.logger,
    );
    app.use(
      avatarRouter(
        context.cassandra,
        profile,
        (token) =>
          verifyActorContext(token, actorContextPublicKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: config.ACTOR_CONTEXT_AUDIENCE,
            purpose: "identity.profile.avatar",
            kid: config.ACTOR_CONTEXT_KID,
          }),
        config.OBJECT_STORAGE_ACCESS_KEY && config.OBJECT_STORAGE_SECRET_KEY
          ? new MinioStorage(config.OBJECT_STORAGE_BUCKET, {
              endPoint: config.OBJECT_STORAGE_ENDPOINT,
              port: config.OBJECT_STORAGE_PORT,
              useSSL: config.OBJECT_STORAGE_USE_SSL,
              accessKey: config.OBJECT_STORAGE_ACCESS_KEY,
              secretKey: config.OBJECT_STORAGE_SECRET_KEY,
            })
          : undefined,
      ),
    );
    app.use(
      profileRouter(
        profile,
        (token) =>
          verifyActorContext(token, actorContextPublicKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: config.ACTOR_CONTEXT_AUDIENCE,
            purpose: "identity.profile.read",
            kid: config.ACTOR_CONTEXT_KID,
          }),
        (token) =>
          verifyActorContext(token, actorContextPublicKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: config.ACTOR_CONTEXT_AUDIENCE,
            purpose: "identity.profile.update",
            kid: config.ACTOR_CONTEXT_KID,
          }),
        context.metrics,
      ),
    );
    if (!config.PASSWORD_IDEMPOTENCY_HMAC_KEY) {
      throw new Error("Identity password change requires a dedicated idempotency HMAC key");
    }
    const passwordRepository = new IdentityPasswordRepository(context.cassandra);
    const passwordChange = new PasswordChangeService(
      {
        getUser: (userId) => passwordRepository.getUser(userId),
        getCredential: (normalizedEmail) => passwordRepository.getCredential(normalizedEmail),
        getSession: (sessionId) => loginRepository.getSession(sessionId),
        revokeSession: (sessionId, expectedVersion, revokedAt) =>
          loginRepository.revokeSession(sessionId, expectedVersion, revokedAt),
        advanceUserSecurityEpoch: (input) => passwordRepository.advanceUserSecurityEpoch(input),
        updateCredential: (input) => passwordRepository.updateCredential(input),
        beginIdempotency: (input) => passwordRepository.beginIdempotency(input),
        getIdempotency: (scope, keyHash, idempotencyKey) =>
          passwordRepository.getIdempotency(scope, keyHash, idempotencyKey),
        transitionIdempotency: (input) => passwordRepository.transitionIdempotency(input),
      },
      protectedValidator,
      config.PASSWORD_IDEMPOTENCY_HMAC_KEY,
      context.metrics,
      context.logger,
    );
    app.use(
      passwordRouter(
        passwordChange,
        (token) =>
          verifyActorContext(token, actorContextPublicKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: config.ACTOR_CONTEXT_AUDIENCE,
            purpose: "identity.password.change",
            kid: config.ACTOR_CONTEXT_KID,
          }),
        context.metrics,
      ),
    );
    const publicProfiles = new PublicProfileService(
      new PublicProfileRepository(context.cassandra),
      context.metrics,
      context.logger,
    );
    const classroomPublicKey = config.CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH
      ? await loadPublicKey(config.CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH)
      : undefined;
    const assessmentPublicKey = config.ASSESSMENT_SERVICE_TOKEN_PUBLIC_KEY_PATH
      ? await loadPublicKey(config.ASSESSMENT_SERVICE_TOKEN_PUBLIC_KEY_PATH)
      : undefined;
    const aiPublicKey = config.AI_SERVICE_TOKEN_PUBLIC_KEY_PATH
      ? await loadPublicKey(config.AI_SERVICE_TOKEN_PUBLIC_KEY_PATH)
      : undefined;
    app.use(
      publicProfileRouter(
        publicProfiles,
        async (token) => {
          const candidates = [
            { key: learningPublicKey, kid: config.SERVICE_TOKEN_KID, subject: "learning-service" },
            ...(classroomPublicKey
              ? [
                  {
                    key: classroomPublicKey,
                    kid: config.CLASSROOM_SERVICE_TOKEN_KID,
                    subject: "classroom-service",
                  },
                ]
              : []),
            ...(assessmentPublicKey
              ? [
                  {
                    key: assessmentPublicKey,
                    kid: config.ASSESSMENT_SERVICE_TOKEN_KID,
                    subject: "assessment-service",
                  },
                ]
              : []),
            ...(aiPublicKey
              ? [{ key: aiPublicKey, kid: config.AI_SERVICE_TOKEN_KID, subject: "ai-service" }]
              : []),
          ];
          let lastError: unknown = new Error("SERVICE_TOKEN_REJECTED");
          for (const candidate of candidates) {
            try {
              const claims = await verifyServiceToken(token, candidate.key, {
                issuer: config.SERVICE_TOKEN_ISSUER,
                audience: config.SERVICE_TOKEN_AUDIENCE,
                purpose: config.SERVICE_TOKEN_PURPOSE,
                kid: candidate.kid,
              });
              if (claims.sub !== candidate.subject) throw new Error("SERVICE_KEY_SUBJECT_MISMATCH");
              return claims;
            } catch (error) {
              lastError = error;
            }
          }
          throw lastError;
        },
        context.metrics,
      ),
    );
    if (!config.ADMIN_CURSOR_HMAC_KEY || !config.PASSWORD_IDEMPOTENCY_HMAC_KEY) {
      throw new Error("Identity Admin APIs require cursor and step-up idempotency HMAC keys");
    }
    const adminRepository = new IdentityAdminRepository(context.cassandra);
    const adminStepUp = new AdminStepUpService(
      { getCredential: (email) => adminRepository.getCredential(email) },
      protectedValidator,
      privateKey,
      config.JWT_KID,
      context.metrics,
    );
    app.use(
      adminStepUpRouter(
        adminStepUp,
        (token) =>
          verifyServiceToken(token, actorContextPublicKey, {
            issuer: "api-gateway",
            audience: "identity-service",
            purpose: "identity.admin.step-up.authorize",
            kid: config.ACTOR_CONTEXT_KID,
          }),
        (token) =>
          verifyActorContext(token, actorContextPublicKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: "identity-service",
            purpose: "identity.admin.step-up.authorize",
            kid: config.ACTOR_CONTEXT_KID,
          }),
      ),
    );
    const admin = new IdentityAdminService(
      {
        getUser: (userId) => adminRepository.getUser(userId),
        listShard: (input) => adminRepository.listShard(input),
        getProjection: (input) => adminRepository.getProjection(input),
        insertProjection: (input) => adminRepository.insertProjection(input),
        removeProjection: (input) => adminRepository.removeProjection(input),
        changeStatus: (input) => adminRepository.changeStatus(input),
        getCredential: (email) => adminRepository.getCredential(email),
        synchronizeCredentialMarker: (input) => adminRepository.synchronizeCredentialMarker(input),
        beginIdempotency: (input) => adminRepository.beginIdempotency(input),
        getIdempotency: (scope, keyHash, key) => adminRepository.getIdempotency(scope, keyHash, key),
        transitionIdempotency: (input) => adminRepository.transitionIdempotency(input),
        prepareOutbox: (event) => repository.prepareOutbox(event),
        markOutboxReady: (location) => repository.markOutboxReady(location),
      },
      protectedValidator,
      config.ADMIN_CURSOR_HMAC_KEY,
      config.PASSWORD_IDEMPOTENCY_HMAC_KEY,
      context.metrics,
      context.logger,
    );
    const adminVerifier = (purpose: string) => (token: string) =>
      verifyActorContext(token, actorContextPublicKey, {
        issuer: config.ACTOR_CONTEXT_ISSUER,
        audience: config.ACTOR_CONTEXT_AUDIENCE,
        purpose,
        kid: config.ACTOR_CONTEXT_KID,
      });
    app.use(
      adminRouter(
        admin,
        {
          search: adminVerifier("identity.admin.users.search"),
          detail: adminVerifier("identity.admin.user.detail"),
          statusChange: adminVerifier("identity.admin.user.status.change"),
        },
        context.metrics,
      ),
    );
    const lecturerVerifyRepository = new LecturerVerifyRepository(context.cassandra);
    const lecturerVerify = new LecturerVerifyService(
      {
        getUser: (userId) => lecturerVerifyRepository.getUser(userId),
        getCredential: (email) => lecturerVerifyRepository.getCredential(email),
        verifyLecturer: (input) => lecturerVerifyRepository.verifyLecturer(input),
        synchronizeCredentialMarker: (input) => lecturerVerifyRepository.synchronizeCredentialMarker(input),
        getPublicProjection: (lecturerId) => lecturerVerifyRepository.getPublicProjection(lecturerId),
        insertPublicProjection: (input) => lecturerVerifyRepository.insertPublicProjection(input),
        reconcilePublicProjection: (input) => lecturerVerifyRepository.reconcilePublicProjection(input),
        getAdminProjection: (input) => lecturerVerifyRepository.getAdminProjection(input),
        insertAdminProjection: (row) => lecturerVerifyRepository.insertAdminProjection(row),
        removeAdminProjection: (row) => lecturerVerifyRepository.removeAdminProjection(row),
        beginIdempotency: (input) => lecturerVerifyRepository.beginIdempotency(input),
        getIdempotency: (scope, keyHash, key) => lecturerVerifyRepository.getIdempotency(scope, keyHash, key),
        transitionIdempotency: (input) => lecturerVerifyRepository.transitionIdempotency(input),
        prepareOutbox: (event) => repository.prepareOutbox(event),
        markOutboxReady: (location) => repository.markOutboxReady(location),
      },
      protectedValidator,
      config.PASSWORD_IDEMPOTENCY_HMAC_KEY,
      context.metrics,
      context.logger,
    );
    app.use(
      lecturerVerifyRouter(lecturerVerify, adminVerifier("identity.admin.lecturer.verify"), context.metrics),
    );
    const applications = new ApplicationService(
      new ApplicationRepository(context.cassandra),
      adminRepository,
      repository,
      protectedValidator,
      config.ADMIN_CURSOR_HMAC_KEY,
    );
    app.use(
      applicationRouter(
        applications,
        (token, purpose) => adminVerifier(purpose)(token),
        async (token, actor, id, decision) => {
          const proof = await verifyStepUpProof(token, publicKey, {
            issuer: "identity-service",
            audience: "identity-service",
            kid: config.JWT_KID,
            action: decision === "APPROVE" ? "LECTURER_APPLICATION_APPROVE" : "LECTURER_APPLICATION_REJECT",
            resourceType: "LECTURER_APPLICATION",
            resourceId: id,
            adminUserId: actor.userId,
          });
          if (
            proof.sessionId !== actor.sessionId ||
            proof.tokenVersion !== actor.tokenVersion ||
            proof.exp <= Math.floor(Date.now() / 1000)
          )
            throw new Error("APPLICATION_PROOF_REJECTED");
        },
      ),
    );
    const stopApplicationRepair = startApplicationRepair(applications);
    app.get("/.well-known/jwks.json", (_request, response) => response.json({ keys: [jwk] }));
    if (!config.ENABLE_RABBITMQ) return stopApplicationRepair;
    const relay = new IdentityOutboxRelay({
      repository,
      rabbitUrl: authenticatedRabbitUrl(config),
      pollMs: config.IDENTITY_OUTBOX_POLL_MS,
      logger: context.logger,
      metrics: context.metrics,
    });
    relay.start();
    return () => {
      stopApplicationRepair();
      return relay.close();
    };
  },
});

function authenticatedRabbitUrl(config: AppConfig): string {
  if (!config.RABBITMQ_USERNAME || !config.RABBITMQ_PASSWORD) {
    throw new Error("RabbitMQ credentials were not validated");
  }
  const url = new URL(config.RABBITMQ_URL);
  url.username = config.RABBITMQ_USERNAME;
  url.password = config.RABBITMQ_PASSWORD;
  return url.toString();
}
