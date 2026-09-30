import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { MinioStorage } from "../../../../packages/storage/src/index.js";
import {
  isPubliclyEligible,
  type CanonicalPublicSubject,
  type InternalPublicProfile,
  type PublicLecturerProfile,
  type PublicLecturerProjection,
} from "./model.js";

export interface PublicProfileStore {
  getCanonicalSubject(userId: string): Promise<CanonicalPublicSubject | undefined>;
  getProjection(lecturerId: string): Promise<PublicLecturerProjection | undefined>;
  getAvatar?(lecturerId: string): Promise<{ contentType: string; objectKey: string } | undefined>;
}

export class PublicProfileService {
  public constructor(
    private readonly store: PublicProfileStore,
    private readonly metrics: ReturnType<typeof createMetrics>,
    private readonly logger: {
      info(input: object, message: string): void;
      warn(input: object, message: string): void;
      error(input: object, message: string): void;
    },
    private readonly storage?: Pick<MinioStorage, "read">,
  ) {}

  public async readPublic(lecturerId: string, requestId: string): Promise<PublicLecturerProfile> {
    const profile = await this.#readEligibleProjection(lecturerId, requestId, "public");
    return {
      lecturerId: profile.lecturerId,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarRef: await this.#publicAvatar(profile),
      ...(profile.experience ? { experience: profile.experience } : {}),
      ...(profile.education ? { education: profile.education } : {}),
      ...(profile.achievements ? { achievements: profile.achievements } : {}),
      verified: true,
      profileVersion: profile.profileVersion,
    };
  }

  async #publicAvatar(profile: PublicLecturerProjection): Promise<string | null> {
    if (!profile.avatarPublic || !this.storage || !this.store.getAvatar) return null;
    try {
      const avatar = await this.store.getAvatar(profile.lecturerId);
      if (!avatar || !["image/png", "image/jpeg", "image/webp"].includes(avatar.contentType)) return null;
      const bytes = await this.storage.read(avatar.objectKey, 256 * 1024);
      return `data:${avatar.contentType};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  }

  public async readInternal(userId: string, requestId: string): Promise<InternalPublicProfile> {
    const profile = await this.#readEligibleProjection(userId, requestId, "internal");
    return {
      userId: profile.lecturerId,
      displayName: profile.displayName,
      avatarRef: null,
      resourceVersion: profile.profileVersion,
    };
  }

  async #readEligibleProjection(
    subjectId: string,
    requestId: string,
    channel: "public" | "internal",
  ): Promise<PublicLecturerProjection> {
    const stopTimer = this.metrics.identityPublicProfileDuration.startTimer({ channel });
    try {
      let subject: CanonicalPublicSubject | undefined;
      try {
        subject = await this.store.getCanonicalSubject(subjectId);
      } catch (error) {
        this.metrics.identityPublicProfiles.inc({ channel, outcome: "canonical_unavailable" });
        this.logger.error(
          {
            operation: "identity.public-profile.read",
            requestId,
            channel,
            errorCode: "PUBLIC_PROFILE_CANONICAL_UNAVAILABLE",
            err: safeError(error),
          },
          "public profile canonical guard failed",
        );
        throw temporarilyUnavailable();
      }
      if (!subject || !isPubliclyEligible(subject)) {
        this.metrics.identityPublicProfiles.inc({ channel, outcome: "not_available" });
        throw notAvailable();
      }

      let projection: PublicLecturerProjection | undefined;
      try {
        projection = await this.store.getProjection(subjectId);
      } catch (error) {
        this.metrics.identityPublicProfiles.inc({ channel, outcome: "projection_unavailable" });
        this.logger.error(
          {
            operation: "identity.public-profile.read",
            requestId,
            channel,
            errorCode: "PUBLIC_PROFILE_PROJECTION_UNAVAILABLE",
            err: safeError(error),
          },
          "public profile projection read failed",
        );
        throw temporarilyUnavailable();
      }
      if (!projection || !projection.verified) {
        this.metrics.identityPublicProfiles.inc({ channel, outcome: "projection_missing" });
        throw temporarilyUnavailable();
      }
      if (projection.profileVersion < subject.profileVersion) {
        this.metrics.identityPublicProfiles.inc({ channel, outcome: "projection_stale" });
        this.metrics.identityProjectionDrift.inc({ kind: "stale" });
        throw temporarilyUnavailable();
      }
      if (projection.profileVersion > subject.profileVersion) {
        this.metrics.identityPublicProfiles.inc({ channel, outcome: "projection_ahead" });
        this.metrics.identityProjectionDrift.inc({ kind: "ahead" });
        this.logger.warn(
          {
            operation: "identity.public-profile.read",
            requestId,
            channel,
            canonicalProfileVersion: subject.profileVersion,
            projectionProfileVersion: projection.profileVersion,
            outcome: "projection_ahead",
          },
          "public profile projection is ahead of canonical state",
        );
        throw temporarilyUnavailable();
      }
      if (projection.displayName !== subject.displayName) {
        this.metrics.identityPublicProfiles.inc({ channel, outcome: "projection_inconsistent" });
        this.metrics.identityProjectionDrift.inc({ kind: "inconsistent" });
        throw temporarilyUnavailable();
      }
      this.metrics.identityPublicProfiles.inc({ channel, outcome: "success" });
      this.logger.info(
        {
          operation: "identity.public-profile.read",
          requestId,
          channel,
          profileVersion: projection.profileVersion,
          outcome: "success",
        },
        "public lecturer profile returned",
      );
      return projection;
    } finally {
      stopTimer();
    }
  }
}

function notAvailable(): AppError {
  return new AppError("PUBLIC_PROFILE_NOT_AVAILABLE", 404, "Public profile is not available");
}

function temporarilyUnavailable(): AppError {
  return new AppError(
    "PUBLIC_PROFILE_TEMPORARILY_UNAVAILABLE",
    503,
    "Public profile is temporarily unavailable",
    true,
  );
}
