import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { SignJWT } from "jose";
import {
  mediaCreateSchema,
  captionMetadata,
  mediaDto,
  mediaStates,
  transition,
  MULTIPART_PART_BYTES,
  type MediaAsset,
  type MediaPolicy,
} from "../../apps/learning-service/src/media/model.js";
import { MediaService } from "../../apps/learning-service/src/media/service.js";
import { captionUploadSchema, validateWebVtt } from "../../apps/learning-service/src/media/captions.js";
import { MediaReferences } from "../../apps/learning-service/src/media/references.js";
import type { MediaStore } from "../../apps/learning-service/src/media/repository.js";
import { mediaDeliveryRouter } from "../../apps/media-delivery/src/router.js";
import { probeMetadata, renditionSize } from "../../apps/media-worker/src/processor.js";
import { signMediaPlayback, verifyMediaPlayback } from "../../packages/security/src/media-playback.js";
import { redactSensitiveUrl } from "../../packages/logger/src/index.js";
import type { MediaObjectStorage, MultipartPart } from "../../packages/storage/src/media.js";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { LearningLessonRepository } from "../../apps/learning-service/src/lessons/repository.js";

const secret = "phase42-unit-test-secret-not-a-runtime-credential";
function required<T>(value: T | null | undefined): T {
  if (value == null) throw Error("TEST_FIXTURE_MISSING");
  return value;
}
const tenant = randomUUID(),
  owner = randomUUID(),
  courseId = randomUUID(),
  lessonId = randomUUID();
const policy: MediaPolicy = {
  maxSourceBytes: 1024 ** 3,
  maxDurationSeconds: 600,
  allowedContainers: ["mp4", "webm"],
  allowedVideoCodecs: ["h264", "vp9"],
  allowedAudioCodecs: ["aac", "opus"],
  uploadTtlSeconds: 3600,
  processingTimeoutMs: 60000,
  renditionHeight: 360,
  videoBitrate: 800000,
  playbackTtlSeconds: 120,
  deliveryOrigin: "http://127.0.0.1:8211",
};
const actor = (id = owner): ActorContext => ({
  userId: id,
  roles: ["LECTURER"],
  sessionId: randomUUID(),
  tokenVersion: 1,
  correlationId: randomUUID(),
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 30,
});
const request = {
  lessonId,
  originalFilename: "lecture.mp4",
  mimeType: "video/mp4",
  sizeBytes: MULTIPART_PART_BYTES + 100,
} as const;
function fixture() {
  const assets = new Map<string, MediaAsset>(),
    writtenBytes = new Map<string, Buffer>(),
    bindings = new Map<string, string>(),
    replacements: { previousMediaAssetId: string; replacementMediaAssetId: string; changedBy: string }[] = [];
  let state = "DRAFT",
    active = true,
    queued = 0,
    completed = 0,
    statSize: number | undefined,
    lock = true;
  let parts: MultipartPart[] = [
    { part: 1, size: MULTIPART_PART_BYTES, etag: "one" },
    { part: 2, size: 100, etag: "two" },
  ];
  const store: MediaStore = {
    acquireCourseWrite: async () => lock,
    releaseCourseWrite: async () => undefined,
    get: async (t, id) => assets.get(`${t}:${id}`),
    insert: async (a) => {
      const key = `${a.tenantId}:${a.mediaAssetId}`;
      if (assets.has(key)) return false;
      assets.set(key, a);
      return true;
    },
    replace: async (old, next) => {
      const key = `${old.tenantId}:${old.mediaAssetId}`;
      if (assets.get(key)?.revision !== old.revision) return false;
      assets.set(key, next);
      return true;
    },
    binding: async (t, id) => bindings.get(`${t}:${id}`),
    bind: async (a, replace, changedBy) => {
      const key = `${a.tenantId}:${a.lessonId}`;
      const previous = bindings.get(key);
      if (replace && previous && previous !== a.mediaAssetId) {
        if (!changedBy) throw Error("MEDIA_REPLACEMENT_ACTOR_REQUIRED");
        replacements.push({
          previousMediaAssetId: previous,
          replacementMediaAssetId: a.mediaAssetId,
          changedBy,
        });
      }
      if (replace || !previous) bindings.set(key, a.mediaAssetId);
    },
    enqueue: async () => {
      queued++;
    },
  };
  const lessons = {
    course: async () => ({ courseId, ownerLecturerId: owner, state, contentVersion: 2 }),
    pointer: async () => ({ courseId, lessonVersion: 1 }),
    detail: async () => ({ courseId, lessonId, lessonVersion: 1, preview: false, state: "READY" }),
    list: async () => [{ lessonId, lessonVersion: 1 }],
  } as unknown as Pick<LearningLessonRepository, "course" | "pointer" | "detail" | "list">;
  const storage: MediaObjectStorage = {
    begin: async () => "upload-1",
    partUrl: async (_key, _upload, part) => `http://example.test/part-${String(part)}`,
    parts: async () => parts,
    complete: async () => {
      completed++;
      statSize = request.sizeBytes;
    },
    abort: async () => undefined,
    stat: async () => {
      if (statSize === undefined) throw Error("NoSuchKey");
      return { size: statSize, etag: "uploaded" };
    },
    readStream: async () => Readable.from([]),
    writeFile: async () => undefined,
    writeBytes: async (key, bytes) => {
      writtenBytes.set(key, bytes);
    },
    remove: async (key) => {
      writtenBytes.delete(key);
    },
  };
  const service = new MediaService(
    store,
    lessons,
    storage,
    async () => active,
    tenant,
    secret,
    policy,
    async () => ({}),
  );
  const create = () => service.create(courseId, actor(), request, "create-1", randomUUID());
  const ready = async () => {
    const { asset } = await create();
    const value = required(assets.get(`${tenant}:${asset.mediaAssetId}`));
    assets.set(`${tenant}:${value.mediaAssetId}`, {
      ...value,
      status: "READY",
      masterPlaylistObjectKey: `media-hls/${tenant}/${value.mediaAssetId}/1/${randomUUID()}/master.m3u8`,
    });
    state = "PUBLISHED";
    return asset.mediaAssetId;
  };
  return {
    service,
    store,
    lessons,
    storage,
    assets,
    writtenBytes,
    binding: () => bindings.get(`${tenant}:${lessonId}`),
    replacements,
    create,
    ready,
    setState: (v: string) => {
      state = v;
    },
    setActive: (v: boolean) => {
      active = v;
    },
    setParts: (v: MultipartPart[]) => {
      parts = v;
    },
    setStat: (v: number) => {
      statSize = v;
    },
    setLock: (v: boolean) => {
      lock = v;
    },
    counts: () => ({ queued, completed }),
  };
}
describe("Phase 42 authoritative media boundary", () => {
  it("accepts a bounded plain-text WebVTT cue and rejects malformed cue structures", () => {
    const valid = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nXin chào\n";
    expect(validateWebVtt(valid)).toBe(valid);
    for (const content of [
      "not VTT",
      "WEBVTT\n",
      "WEBVTT\n\n00:00:03.000 --> 00:00:01.000\nBad",
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<script>",
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n\n00:00:05.000 --> bad\nB",
    ])
      expect(() => validateWebVtt(content)).toThrow("WEBVTT_INVALID");
    expect(
      captionUploadSchema.safeParse({
        language: "vi",
        label: "Tiếng Việt",
        kind: "SUBTITLES",
        contentType: "text/vtt",
        content: valid,
        objectKey: "fake",
      }).success,
    ).toBe(false);
  });
  it("uploads private caption bytes idempotently without leaking object keys", async () => {
    const f = fixture();
    const id = await f.ready();
    const input = {
      language: "vi",
      label: "Tiếng Việt",
      kind: "SUBTITLES" as const,
      contentType: "text/vtt" as const,
      content: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nXin chào\n",
    };
    const first = await f.service.uploadCaption(id, actor(), input, "caption-one");
    const repeated = await f.service.uploadCaption(id, actor(), input, "caption-one");
    expect(repeated).toEqual(first);
    expect(f.writtenBytes.size).toBe(1);
    expect([...f.writtenBytes.values()][0]?.toString("utf8")).toBe(input.content);
    expect(JSON.stringify(first)).not.toContain("media-caption/");
    const session = await f.service.playback(lessonId, actor());
    expect(session.captionTracks).toHaveLength(1);
    expect(session.captionTracks[0]?.url).toContain(`/caption-${required(first).captionTrackId}.vtt?token=`);
    expect(JSON.stringify(session)).not.toContain("media-caption/");
    await expect(
      f.service.uploadCaption(
        id,
        actor(),
        { ...input, content: input.content.replace("Xin chào", "Khác") },
        "caption-one",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      f.service.uploadCaption(id, actor(randomUUID()), input, "caption-other"),
    ).rejects.toMatchObject({ code: "MEDIA_OWNER_REQUIRED" });
  });
  it("accepts configurable lecture sizes over 25 MiB and rejects client object paths", () => {
    expect(mediaCreateSchema.parse({ ...request, sizeBytes: 100 * 1024 ** 2 }).sizeBytes).toBe(
      100 * 1024 ** 2,
    );
    for (const extra of [
      { objectKey: "other-tenant/source" },
      { tenantId: randomUUID() },
      { status: "READY" },
    ])
      expect(mediaCreateSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  });
  it("rejects executable MIME and unsafe filename control bytes", () => {
    expect(mediaCreateSchema.safeParse({ ...request, mimeType: "application/x-executable" }).success).toBe(
      false,
    );
    expect(mediaCreateSchema.safeParse({ ...request, originalFilename: "a\0.mp4" }).success).toBe(false);
  });
  it("replays create without a second asset and omits private upload paths", async () => {
    const f = fixture(),
      a = await f.create(),
      b = await f.create();
    expect(a.asset.mediaAssetId).toBe(b.asset.mediaAssetId);
    expect(f.assets.size).toBe(1);
    expect(JSON.stringify(a)).not.toContain("media-original");
    expect(a.asset).not.toHaveProperty("uploadId");
  });
  it("rejects a reused idempotency key with different content", async () => {
    const f = fixture();
    await f.create();
    await expect(
      f.service.create(courseId, actor(), { ...request, sizeBytes: 1 }, "create-1", randomUUID()),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("requires an owner lecturer before creating upload permission", async () => {
    const f = fixture();
    await expect(
      f.service.create(courseId, actor(randomUUID()), request, "x", randomUUID()),
    ).rejects.toMatchObject({ code: "COURSE_OWNER_REQUIRED" });
    expect(f.assets.size).toBe(0);
  });
  it("refuses concurrent publication/media authoring", async () => {
    const f = fixture();
    f.setLock(false);
    await expect(f.create()).rejects.toMatchObject({ code: "MEDIA_COURSE_WRITE_CONFLICT" });
    expect(f.assets.size).toBe(0);
  });
  it("refuses a first upload to an already published lesson", async () => {
    const f = fixture();
    f.setState("PUBLISHED");
    await expect(f.create()).rejects.toMatchObject({ code: "MEDIA_REPLACEMENT_REQUIRED" });
  });
  it("keeps published V1 playable until READY V2 switches with an audit event", async () => {
    const f = fixture();
    const first = await f.ready();
    const created = await f.service.create(courseId, actor(), request, "replacement-2", randomUUID());
    const second = created.asset.mediaAssetId;
    expect(second).not.toBe(first);
    expect(f.binding()).toBe(first);
    expect((await f.service.playback(lessonId, actor())).mediaAssetId).toBe(first);
    const key = `${tenant}:${second}`;
    const processing = required(f.assets.get(key));
    f.assets.set(key, {
      ...processing,
      status: "READY",
      masterPlaylistObjectKey: `media-hls/${tenant}/${second}/1/${randomUUID()}/master.m3u8`,
    });
    await f.service.attach(second, actor());
    expect(f.binding()).toBe(second);
    expect((await f.service.playback(lessonId, actor())).mediaAssetId).toBe(second);
    expect(f.replacements).toEqual([
      { previousMediaAssetId: first, replacementMediaAssetId: second, changedBy: owner },
    ]);
  });
  it("keeps published V1 bound and playable when V2 processing fails", async () => {
    const f = fixture();
    const first = await f.ready();
    const created = await f.service.create(courseId, actor(), request, "replacement-failed", randomUUID());
    const second = created.asset.mediaAssetId;
    const key = `${tenant}:${second}`;
    f.assets.set(key, {
      ...required(f.assets.get(key)),
      status: "FAILED",
      failureCode: "MEDIA_PROCESSING_FAILED",
    });
    await expect(f.service.attach(second, actor())).rejects.toMatchObject({ code: "MEDIA_NOT_READY" });
    expect(f.binding()).toBe(first);
    expect((await f.service.playback(lessonId, actor())).mediaAssetId).toBe(first);
    expect(f.replacements).toHaveLength(0);
  });
  it("enforces the configured source size before S3 issuance", async () => {
    const f = fixture();
    await expect(
      f.service.create(courseId, actor(), { ...request, sizeBytes: 1024 ** 3 + 1 }, "x", randomUUID()),
    ).rejects.toMatchObject({ code: "MEDIA_SOURCE_SIZE_REJECTED" });
    expect(f.assets.size).toBe(0);
  });
  it("scopes part numbers and exposes durable uploaded-part resume", async () => {
    const f = fixture(),
      a = await f.create();
    expect((await f.service.resume(a.asset.mediaAssetId, actor())).parts).toHaveLength(2);
    await expect(f.service.part(a.asset.mediaAssetId, actor(), 3)).rejects.toMatchObject({
      code: "MEDIA_PART_REJECTED",
    });
    expect((await f.service.part(a.asset.mediaAssetId, actor(), 2)).expiresInSeconds).toBeLessThanOrEqual(
      300,
    );
  });
  it("rejects expired uploads", async () => {
    const f = fixture(),
      a = await f.create();
    const key = `${tenant}:${a.asset.mediaAssetId}`,
      old = required(f.assets.get(key));
    f.assets.set(key, { ...old, uploadExpiresAt: new Date(0).toISOString() });
    await expect(f.service.part(a.asset.mediaAssetId, actor(), 1)).rejects.toMatchObject({
      code: "MEDIA_UPLOAD_EXPIRED_OR_CLOSED",
    });
  });
  it("requires actual part numbers and sizes before completion", async () => {
    const f = fixture(),
      a = await f.create();
    f.setParts([{ part: 2, size: 100, etag: "two" }]);
    await expect(f.service.complete(a.asset.mediaAssetId, actor())).rejects.toMatchObject({
      code: "MEDIA_PARTS_INCOMPLETE",
    });
    expect(f.counts().completed).toBe(0);
  });
  it("HEAD-verifies source and safely replays completion", async () => {
    const f = fixture(),
      a = await f.create();
    expect((await f.service.complete(a.asset.mediaAssetId, actor())).status).toBe("VERIFYING");
    await f.service.complete(a.asset.mediaAssetId, actor());
    expect(f.counts().completed).toBe(1);
    expect(f.counts().queued).toBe(2);
  });
  it("recovers an ambiguous S3 completion using HEAD", async () => {
    const f = fixture(),
      a = await f.create();
    f.setStat(request.sizeBytes);
    await f.service.complete(a.asset.mediaAssetId, actor());
    expect(f.counts().completed).toBe(0);
  });
  it("rejects an authoritative object-size mismatch", async () => {
    const f = fixture(),
      a = await f.create();
    f.setStat(99);
    await expect(f.service.complete(a.asset.mediaAssetId, actor())).rejects.toMatchObject({
      code: "MEDIA_OBJECT_SIZE_REJECTED",
    });
  });
  it("publication guard survives disabled media upload configuration", async () => {
    const f = fixture();
    await f.create();
    const references = new MediaReferences(f.store, f.lessons, tenant);
    await expect(references.requireReady(courseId, 2)).rejects.toMatchObject({
      code: "COURSE_MEDIA_NOT_READY",
    });
  });
  it("does not switch a replacement before READY", async () => {
    const f = fixture(),
      a = await f.create();
    await expect(f.service.attach(a.asset.mediaAssetId, actor())).rejects.toMatchObject({
      code: "MEDIA_NOT_READY",
    });
  });
  it("denies non-entitled/revoked students and unpublished courses", async () => {
    const f = fixture();
    await f.ready();
    f.setActive(false);
    await expect(f.service.playback(lessonId, actor(randomUUID()))).rejects.toMatchObject({
      code: "MEDIA_ENTITLEMENT_REQUIRED",
    });
    f.setActive(true);
    f.setState("IN_REVIEW");
    await expect(f.service.playback(lessonId, actor())).rejects.toMatchObject({
      code: "MEDIA_NOT_AVAILABLE",
    });
  });
  it("issues only scoped delivery authorization, not a raw object URL or completion", async () => {
    const f = fixture(),
      id = await f.ready();
    const p = await f.service.playback(lessonId, actor());
    expect(p.playlistUrl).toContain("/playback/");
    expect(p.playlistUrl).not.toContain("media-original");
    expect(p.completionPolicy).toBe("EXPLICIT_AUTHORITATIVE_LESSON_ACK");
    const s = await verifyMediaPlayback(
      required(new URL(p.playlistUrl).searchParams.get("token")),
      secret,
      tenant,
      id,
    );
    expect(s.sub).toBe(owner);
  });
  it("exposes only ready caption metadata, never private object keys", async () => {
    const f = fixture();
    const id = await f.ready();
    const a = required([...f.assets.values()].find((value) => value.mediaAssetId === id));
    a.captionTracks = [
      {
        captionTrackId: randomUUID(),
        mediaAssetId: a.mediaAssetId,
        language: "vi",
        label: "Tiếng Việt",
        kind: "SUBTITLES",
        format: "WEBVTT",
        objectKey: "private/captions/vi.vtt",
        status: "READY",
      },
      {
        captionTrackId: randomUUID(),
        mediaAssetId: a.mediaAssetId,
        language: "en",
        label: "English",
        kind: "SUBTITLES",
        format: "WEBVTT",
        objectKey: "private/captions/en.vtt",
        status: "UPLOADING",
      },
    ];
    const metadata = captionMetadata(a);
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({ language: "vi", format: "WEBVTT" });
    expect(JSON.stringify(metadata)).not.toContain("private/captions/");
    const playback = await f.service.playback(lessonId, actor());
    expect(playback.captionTracks).toMatchObject(metadata);
    expect(playback.captionTracks[0]?.url).toContain(
      `/caption-${required(metadata[0]).captionTrackId}.vtt?token=`,
    );
  });
  it("does not find a foreign-tenant binding", async () => {
    const f = fixture();
    await f.ready();
    const refs = new MediaReferences(f.store, f.lessons, randomUUID());
    expect(await refs.lessonMedia(lessonId)).toBeUndefined();
  });
  it("writes state transitions and rejects terminal transitions", async () => {
    const f = fixture();
    await f.create();
    const a = required([...f.assets.values()][0]);
    expect(a.audit[0]).toMatchObject({ from: "CREATED", to: "UPLOADING", actor: owner });
    for (const status of mediaStates)
      if (status !== "PROCESSING") expect(() => transition({ ...a, status }, "READY", "worker")).toThrow();
    expect(mediaDto(a)).not.toHaveProperty("processingLease");
  });
  it("enforces explicit visibility rules and permits anonymous playback for public preview", async () => {
    const f = fixture();
    await expect(
      f.service.create(
        courseId,
        actor(),
        { ...request, visibility: "PUBLIC_PREVIEW" },
        "preview-err",
        randomUUID(),
      ),
    ).rejects.toThrow("Public preview media requires a preview lesson");

    const previewLessonId = randomUUID();
    const mockLessons = f.lessons as unknown as {
      pointer: () => Promise<unknown>;
      detail: (lId: string) => Promise<unknown>;
      list: () => Promise<unknown[]>;
    };
    mockLessons.pointer = async () => ({ courseId, lessonVersion: 1 });
    mockLessons.detail = async (lId: string) => ({
      courseId,
      lessonId: lId,
      lessonVersion: 1,
      preview: lId === previewLessonId,
      state: "READY",
    });
    mockLessons.list = async () => [
      { lessonId, lessonVersion: 1, preview: false },
      { lessonId: previewLessonId, lessonVersion: 1, preview: true },
    ];

    await expect(
      f.service.create(
        courseId,
        actor(),
        { ...request, lessonId: previewLessonId, visibility: "PROTECTED_LESSON" },
        "prot-err",
        randomUUID(),
      ),
    ).rejects.toThrow("Protected media cannot be attached to a preview lesson");

    const { asset: created } = await f.service.create(
      courseId,
      actor(),
      { ...request, lessonId: previewLessonId, visibility: "PUBLIC_PREVIEW" },
      "prev-ok",
      randomUUID(),
    );
    expect(created.visibility).toBe("PUBLIC_PREVIEW");

    const asset = required(f.assets.get(`${tenant}:${created.mediaAssetId}`));
    const readyAsset: MediaAsset = {
      ...asset,
      status: "READY",
      visibility: "PUBLIC_PREVIEW",
      masterPlaylistObjectKey: `media-hls/${tenant}/${created.mediaAssetId}/1/${randomUUID()}/master.m3u8`,
    };
    f.assets.set(`${tenant}:${created.mediaAssetId}`, readyAsset);
    await f.store.bind(readyAsset, true, owner);

    f.setState("PUBLISHED");

    const anonActor: ActorContext = {
      userId: "00000000-0000-0000-0000-000000000000",
      roles: [],
      sessionId: "00000000-0000-0000-0000-000000000000",
      tokenVersion: 0,
      correlationId: randomUUID(),
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
    const session = await f.service.playback(previewLessonId, anonActor);
    expect(session.playlistUrl).toContain("/playback/");

    await expect(f.service.playback(lessonId, anonActor)).rejects.toThrow();

    const trailer = await f.service.courseTrailer(courseId);
    expect(trailer.mediaAssetId).toBe(created.mediaAssetId);
  });
});
describe("Phase 42 actual-media policy", () => {
  const probe = {
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.5" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
      { codec_type: "audio", codec_name: "aac" },
    ],
  };
  it("extracts actual duration/codecs rather than MIME declarations", () =>
    expect(probeMetadata(probe, policy, "mp4")).toMatchObject({
      durationMs: 12500,
      width: 1920,
      videoCodec: "h264",
      audioCodec: "aac",
    }));
  it.each(["NaN", "0", "601"])("rejects invalid/excessive actual duration %s", (duration) =>
    expect(() => probeMetadata({ ...probe, format: { ...probe.format, duration } }, policy, "mp4")).toThrow(),
  );
  it("rejects unsupported codecs and container metadata", () => {
    expect(() =>
      probeMetadata(
        { ...probe, streams: [{ codec_type: "video", codec_name: "mpeg2video", width: 1920, height: 1080 }] },
        policy,
        "mp4",
      ),
    ).toThrow();
    expect(() =>
      probeMetadata({ ...probe, format: { ...probe.format, format_name: "exe" } }, policy, "mp4"),
    ).toThrow();
  });
  it("never upscales and uses even dimensions", () => {
    expect(renditionSize(320, 240, 1080)).toEqual({ width: 320, height: 240 });
    expect(renditionSize(1920, 1080, 360)).toEqual({ width: 640, height: 360 });
  });
});
describe("Phase 42 private delivery", () => {
  const id = randomUUID(),
    scope = {
      sub: owner,
      tenantId: tenant,
      courseId,
      lessonId,
      mediaAssetId: id,
      processingVersion: 1,
      outputPrefix: `${tenant}/${id}/1/${randomUUID()}`,
      operation: "PLAYBACK",
    } as const;
  it("rejects wrong asset, wrong tenant and tampered JWT", async () => {
    const token = await signMediaPlayback(scope, secret, 120);
    await expect(verifyMediaPlayback(token, secret, randomUUID(), id)).rejects.toThrow();
    await expect(verifyMediaPlayback(token, secret, tenant, randomUUID())).rejects.toThrow();
    await expect(verifyMediaPlayback(token + "x", secret, tenant, id)).rejects.toThrow();
  });
  it("rejects expired JWT and a wrong operation", async () => {
    for (const override of [{ exp: 1 }, { operation: "UPLOAD" }]) {
      const token = await new SignJWT({ ...scope, ...override })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("ailss-media")
        .setAudience("media-delivery")
        .setIssuedAt()
        .setExpirationTime(override.exp ?? "120s")
        .sign(new TextEncoder().encode(secret));
      await expect(verifyMediaPlayback(token, secret, tenant, id)).rejects.toThrow();
    }
  });
  it("rejects long tokens, missing secret and permanent TTL", async () => {
    await expect(verifyMediaPlayback("x".repeat(5000), secret, tenant, id)).rejects.toThrow();
    await expect(signMediaPlayback(scope, "short", 120)).rejects.toThrow();
    await expect(signMediaPlayback(scope, secret, 301)).rejects.toThrow();
  });
  it("redacts HLS/upload credentials in request logs", () => {
    const safe = redactSensitiveUrl(
      "/playback/x?token=private&uploadId=opaque&X-Amz-Signature=signature&X-Amz-Credential=key&part=2",
    );
    expect(safe).not.toContain("private");
    expect(safe).not.toContain("opaque");
    expect(safe).toContain("part=2");
  });
  it("authorizes every playlist/segment request and refuses arbitrary origin keys", async () => {
    const f = fixture();
    let reads = 0;
    const storage = {
      ...f.storage,
      readStream: async (key: string) => {
        reads++;
        return Readable.from([
          key.endsWith("master.m3u8")
            ? "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nvariant.m3u8\n"
            : "segment-bytes",
        ]);
      },
    };
    const app = express();
    app.use(mediaDeliveryRouter(storage, secret, tenant, ["http://localhost:5173"]));
    let server: Server | undefined;
    try {
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      const address = server.address();
      if (!address || typeof address === "string") throw Error("address");
      const base = `http://127.0.0.1:${String(address.port)}/playback/${id}`;
      expect((await fetch(`${base}/master.m3u8`)).status).toBe(403);
      expect(reads).toBe(0);
      const token = await signMediaPlayback(scope, secret, 120),
        response = await fetch(`${base}/master.m3u8?token=${token}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`variant.m3u8?token=${token}`);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect((await fetch(`${base}/source.mp4?token=${token}`)).status).toBe(404);
      expect((await fetch(`${base}/segment-00000.ts?token=bad`)).status).toBe(403);
      expect((await fetch(`${base}/segment-00000.ts?token=${token}`)).status).toBe(200);
      expect(
        (await fetch(`${base}/master.m3u8?token=${token}`, { headers: { origin: "http://evil.test" } }))
          .status,
      ).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server ? server.close((error) => (error ? reject(error) : resolve())) : resolve(),
      );
    }
  });
});
