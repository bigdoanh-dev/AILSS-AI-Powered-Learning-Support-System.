import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { signMediaPlayback } from "../../../../packages/security/src/media-playback.js";
import type { MediaObjectStorage } from "../../../../packages/storage/src/media.js";
import type { LearningLessonRepository } from "../lessons/repository.js";
import type { MediaStore } from "./repository.js";
import type { MediaEvent } from "../../../../packages/observability/src/media.js";
import {
  fingerprint,
  mediaId,
  mediaDto,
  transition,
  MULTIPART_PART_BYTES,
  type MediaAsset,
  type MediaCreate,
  type MediaPolicy,
} from "./model.js";
export class MediaService {
  constructor(
    private readonly store: MediaStore,
    private readonly lessons: Pick<LearningLessonRepository, "course" | "pointer" | "detail" | "list">,
    private readonly storage: MediaObjectStorage,
    private readonly entitled: (studentId: string, courseId: string) => Promise<boolean>,
    private readonly tenantId: string,
    private readonly secret: string,
    private readonly policy: MediaPolicy,
    private readonly eligible: (userId: string, requestId: string) => Promise<unknown>,
    private readonly event: (name: MediaEvent) => void = () => undefined,
  ) {}
  async create(
    courseId: string,
    actor: ActorContext,
    request: MediaCreate,
    idempotencyKey: string,
    requestId: string,
  ) {
    return this.withCourseWrite(
      courseId,
      actor,
      mediaId(this.secret, `write:${this.tenantId}:${actor.userId}:${courseId}:${idempotencyKey}`),
      () => this.createLocked(courseId, actor, request, idempotencyKey, requestId),
    );
  }
  private async createLocked(
    courseId: string,
    actor: ActorContext,
    request: MediaCreate,
    idempotencyKey: string,
    requestId: string,
  ) {
    await this.editable(courseId, actor);
    await this.eligible(actor.userId, requestId);
    const pointer = await this.lessons.pointer(request.lessonId);
    const detail = pointer ? await this.lessons.detail(request.lessonId, pointer.lessonVersion) : undefined;
    if (!detail || pointer?.courseId !== courseId || detail.preview)
      throw new AppError("MEDIA_LESSON_REJECTED", 422, "A protected lesson in the owned course is required");
    if (
      request.sizeBytes > this.policy.maxSourceBytes ||
      Math.ceil(request.sizeBytes / MULTIPART_PART_BYTES) > 10_000
    )
      throw new AppError("MEDIA_SOURCE_SIZE_REJECTED", 413, "Source size exceeds configured media policy");
    const id = mediaId(this.secret, `${this.tenantId}:${actor.userId}:${courseId}:${idempotencyKey}`);
    const now = new Date().toISOString(),
      bodyHash = fingerprint(request);
    const { sourceSha256, ...fields } = request;
    const proposed: MediaAsset = {
      ...fields,
      ...(sourceSha256 ? { sourceSha256 } : {}),
      mediaAssetId: id,
      tenantId: this.tenantId,
      ownerUserId: actor.userId,
      courseId,
      mediaType: "VIDEO",
      originalObjectKey: `media-original/${this.tenantId}/${id}/1/source`,
      status: "CREATED",
      revision: 1,
      processingVersion: 1,
      fingerprint: bodyHash,
      createdAt: now,
      updatedAt: now,
      uploadExpiresAt: new Date(Date.now() + this.policy.uploadTtlSeconds * 1000).toISOString(),
      captionTracks: [],
      audit: [],
    };
    await this.store.insert(proposed);
    let asset = await this.owned(id, actor);
    if (asset.fingerprint !== bodyHash)
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "Idempotency key was used with a different media request",
      );
    await this.store.bind(asset, false);
    if (asset.status === "CREATED") {
      const uploadId = await this.storage.begin(asset.originalObjectKey, asset.mimeType);
      const next = { ...transition(asset, "UPLOADING", actor.userId), uploadId };
      if (await this.store.replace(asset, next)) {
        asset = next;
        this.event("upload_session_created");
      } else {
        await this.storage.abort(asset.originalObjectKey, uploadId);
        asset = await this.owned(id, actor);
      }
    }
    return {
      asset: mediaDto(asset),
      partSize: MULTIPART_PART_BYTES,
      partCount: Math.ceil(asset.sizeBytes / MULTIPART_PART_BYTES),
      expiresAt: asset.uploadExpiresAt,
    };
  }
  async get(id: string, actor: ActorContext) {
    return mediaDto(await this.owned(id, actor));
  }
  async resume(id: string, actor: ActorContext) {
    const a = await this.owned(id, actor);
    await this.editable(a.courseId, actor);
    this.uploadOpen(a);
    return {
      asset: mediaDto(a),
      partSize: MULTIPART_PART_BYTES,
      parts: await this.storage.parts(a.originalObjectKey, a.uploadId),
    };
  }
  async part(id: string, actor: ActorContext, part: number) {
    const a = await this.owned(id, actor);
    await this.editable(a.courseId, actor);
    this.uploadOpen(a);
    if (!Number.isInteger(part) || part < 1 || part > Math.ceil(a.sizeBytes / MULTIPART_PART_BYTES))
      throw new AppError("MEDIA_PART_REJECTED", 422, "Part number is outside upload scope");
    const ttl = Math.min(300, Math.max(1, Math.floor((Date.parse(a.uploadExpiresAt) - Date.now()) / 1000)));
    return {
      uploadUrl: await this.storage.partUrl(a.originalObjectKey, a.uploadId, part, ttl),
      expiresInSeconds: ttl,
    };
  }
  async complete(id: string, actor: ActorContext) {
    try {
      return await this.completeUpload(id, actor);
    } catch (error) {
      this.event("upload_failed");
      throw error;
    }
  }
  private async completeUpload(id: string, actor: ActorContext) {
    let a = await this.owned(id, actor);
    await this.editable(a.courseId, actor);
    if (a.status === "UPLOADING") {
      this.uploadOpen(a);
      // Recover an ambiguous CompleteMultipartUpload response by checking the
      // authoritative object first, not by assuming the old upload ID still exists.
      let stat: { size: number; etag: string } | undefined;
      try {
        stat = await this.storage.stat(a.originalObjectKey);
      } catch {
        /* absent object: verify actual uploaded parts below */
      }
      if (!stat) {
        const parts = (await this.storage.parts(a.originalObjectKey, a.uploadId)).sort(
          (x, y) => x.part - y.part,
        );
        if (
          parts.length !== Math.ceil(a.sizeBytes / MULTIPART_PART_BYTES) ||
          parts.some(
            (p, i) =>
              p.part !== i + 1 ||
              p.size !== Math.min(MULTIPART_PART_BYTES, a.sizeBytes - i * MULTIPART_PART_BYTES),
          )
        )
          throw new AppError(
            "MEDIA_PARTS_INCOMPLETE",
            409,
            "Uploaded parts do not match the expected source size",
          );
        await this.storage.complete(a.originalObjectKey, a.uploadId, parts);
        stat = await this.storage.stat(a.originalObjectKey);
      }
      if (stat.size !== a.sizeBytes)
        throw new AppError(
          "MEDIA_OBJECT_SIZE_REJECTED",
          422,
          "Uploaded object size differs from the media declaration",
        );
      const next = transition(a, "UPLOADED", actor.userId);
      await this.cas(a, next);
      this.event("upload_completed");
      a = next;
    }
    if (a.status === "UPLOADED") {
      const next = {
        ...transition(a, "VERIFYING", actor.userId),
        jobDay: new Date().toISOString().slice(0, 10),
      };
      // Durable job is inserted BEFORE activation. A worker can recover the
      // UPLOADED -> VERIFYING transition after a crash between these writes.
      await this.store.enqueue(next);
      await this.cas(a, next);
      a = next;
    } else if (a.status === "VERIFYING") await this.store.enqueue(a);
    if (!["VERIFYING", "QUEUED", "PROCESSING", "READY"].includes(a.status))
      throw new AppError("MEDIA_COMPLETION_REJECTED", 409, "Media upload cannot be completed in this state");
    return mediaDto(a);
  }
  async cancel(id: string, actor: ActorContext) {
    const a = await this.owned(id, actor);
    await this.editable(a.courseId, actor);
    if (a.status === "DELETED") return mediaDto(a);
    this.uploadOpen(a);
    await this.storage.abort(a.originalObjectKey, a.uploadId);
    const next = transition(a, "DELETED", actor.userId);
    await this.cas(a, next);
    return mediaDto(next);
  }
  async attach(id: string, actor: ActorContext) {
    const a = await this.owned(id, actor);
    await this.editable(a.courseId, actor);
    if (a.status !== "READY" || !a.masterPlaylistObjectKey)
      throw new AppError("MEDIA_NOT_READY", 409, "Processed HLS must be READY before it can be attached");
    return this.withCourseWrite(
      a.courseId,
      actor,
      mediaId(this.secret, `attach:${this.tenantId}:${actor.userId}:${id}`),
      async () => {
        await this.store.bind(a, true);
        return mediaDto(a);
      },
    );
  }
  async lessonMedia(lessonId: string) {
    const id = await this.store.binding(this.tenantId, lessonId);
    if (!id) return undefined;
    const a = await this.store.get(this.tenantId, id);
    if (!a)
      throw new AppError("MEDIA_REFERENCE_UNAVAILABLE", 503, "Required media metadata is unavailable", true);
    return { mediaAssetId: a.mediaAssetId, mediaStatus: a.status };
  }
  async requireReady(courseId: string, contentVersion: number) {
    for (const lesson of await this.lessons.list(courseId, contentVersion)) {
      const media = await this.lessonMedia(lesson.lessonId);
      if (media && media.mediaStatus !== "READY")
        throw new AppError(
          "COURSE_MEDIA_NOT_READY",
          409,
          "Required lesson video must be READY before publication",
        );
    }
  }
  async playback(lessonId: string, actor: ActorContext) {
    try {
      const result = await this.authorizePlayback(lessonId, actor);
      this.event("playback_authorized");
      return result;
    } catch (error) {
      this.event("playback_denied");
      throw error;
    }
  }
  private async authorizePlayback(lessonId: string, actor: ActorContext) {
    const id = await this.store.binding(this.tenantId, lessonId),
      a = id ? await this.store.get(this.tenantId, id) : undefined;
    const pointer = await this.lessons.pointer(lessonId);
    const course = a ? await this.lessons.course(a.courseId) : undefined;
    const lesson = pointer ? await this.lessons.detail(lessonId, pointer.lessonVersion) : undefined;
    const publishedLesson = course
      ? (await this.lessons.list(course.courseId, course.contentVersion)).find(
          (l) => l.lessonId === lessonId && l.lessonVersion === pointer?.lessonVersion,
        )
      : undefined;
    if (
      !a ||
      !course ||
      course.state !== "PUBLISHED" ||
      !publishedLesson ||
      !lesson ||
      lesson.state !== "READY" ||
      pointer?.courseId !== a.courseId ||
      lesson.courseId !== a.courseId ||
      a.lessonId !== lessonId ||
      a.tenantId !== this.tenantId ||
      a.status !== "READY" ||
      !a.masterPlaylistObjectKey
    )
      throw new AppError("MEDIA_NOT_AVAILABLE", 404, "Published lesson media is not available");
    // Canonical commercial truth only: never resurrect a revoked entitlement
    // through legacy enrollment compatibility fallback.
    if (!(await this.entitled(actor.userId, a.courseId)))
      throw new AppError(
        "MEDIA_ENTITLEMENT_REQUIRED",
        403,
        "Active course entitlement is required for playback",
      );
    const outputPrefix = a.masterPlaylistObjectKey.replace(/^media-hls\//, "").replace(/\/master\.m3u8$/, "");
    const token = await signMediaPlayback(
      {
        sub: actor.userId,
        tenantId: a.tenantId,
        courseId: a.courseId,
        lessonId,
        mediaAssetId: a.mediaAssetId,
        processingVersion: a.processingVersion,
        outputPrefix,
        operation: "PLAYBACK",
      },
      this.secret,
      this.policy.playbackTtlSeconds,
    );
    return {
      mediaAssetId: a.mediaAssetId,
      playlistUrl: `${this.policy.deliveryOrigin}/playback/${a.mediaAssetId}/master.m3u8?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + this.policy.playbackTtlSeconds * 1000).toISOString(),
      completionPolicy: "EXPLICIT_AUTHORITATIVE_LESSON_ACK",
      captionTracks: a.captionTracks,
    };
  }
  private async owned(id: string, actor: ActorContext) {
    const a = await this.store.get(this.tenantId, id);
    if (!a) throw new AppError("MEDIA_ASSET_NOT_FOUND", 404, "Media asset not found");
    if (!actor.roles.includes("LECTURER") || a.ownerUserId !== actor.userId)
      throw new AppError("MEDIA_OWNER_REQUIRED", 403, "Media owner authorization is required");
    const course = await this.lessons.course(a.courseId);
    if (!course || course.ownerLecturerId !== actor.userId)
      throw new AppError("COURSE_OWNER_REQUIRED", 403, "Course owner authorization is required");
    return a;
  }
  private async editable(courseId: string, actor: ActorContext) {
    const c = await this.lessons.course(courseId);
    if (!c || !actor.roles.includes("LECTURER") || c.ownerLecturerId !== actor.userId)
      throw new AppError("COURSE_OWNER_REQUIRED", 403, "Course owner authorization is required");
    if (c.state !== "DRAFT")
      throw new AppError("COURSE_NOT_EDITABLE", 409, "Media authoring requires a draft course");
    return c;
  }
  private uploadOpen(a: MediaAsset): asserts a is MediaAsset & { uploadId: string } {
    if (a.status !== "UPLOADING" || !a.uploadId || Date.parse(a.uploadExpiresAt) <= Date.now())
      throw new AppError("MEDIA_UPLOAD_EXPIRED_OR_CLOSED", 409, "Upload session is expired or closed");
  }
  private async withCourseWrite<T>(
    courseId: string,
    actor: ActorContext,
    lease: string,
    work: () => Promise<T>,
  ): Promise<T> {
    await this.editable(courseId, actor);
    if (!(await this.store.acquireCourseWrite(courseId, lease)))
      throw new AppError(
        "MEDIA_COURSE_WRITE_CONFLICT",
        409,
        "Course publication or another media write is in progress",
        true,
      );
    try {
      return await work();
    } finally {
      await this.store.releaseCourseWrite(courseId, lease);
    }
  }
  private async cas(old: MediaAsset, next: MediaAsset) {
    if (!(await this.store.replace(old, next)))
      throw new AppError(
        "MEDIA_VERSION_CONFLICT",
        409,
        "Media was changed concurrently; reload its authoritative state",
        true,
      );
  }
}
