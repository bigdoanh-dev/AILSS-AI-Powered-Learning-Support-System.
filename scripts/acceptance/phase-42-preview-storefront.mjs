import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { open, stat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readEnv, required } from "../dev/env.mjs";

const fixture = await readEnv(new URL("../../.env.media-acceptance", import.meta.url));
const base = "http://127.0.0.1:8080";
let checks = 0;

async function request(url, expectedStatus, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Connection: "close", ...options.headers },
    signal: AbortSignal.timeout(60_000),
  });
  assert.equal(
    res.status,
    expectedStatus,
    `${options.method || "GET"} ${url}: expected HTTP ${expectedStatus}, got ${res.status}`,
  );
  checks++;
  return res;
}

async function login(prefix) {
  const res = await request(`${base}/api/v1/auth/login`, 200, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: required(fixture, `${prefix}_EMAIL`),
      password: required(fixture, `${prefix}_PASSWORD`),
    }),
  });
  return (await res.json()).data.accessToken;
}

async function uploadAndReady(token, courseId, lessonId, filename, visibility) {
  const fileStat = await stat(filename);
  const createRes = await request(`${base}/api/v1/courses/${courseId}/media-assets`, 201, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      lessonId,
      originalFilename: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: fileStat.size,
      visibility,
    }),
  });
  const { asset, partCount, partSize } = (await createRes.json()).data;
  const assetId = asset.mediaAssetId;

  // Upload parts
  const handle = await open(filename, "r");
  try {
    for (let part = 1; part <= partCount; part++) {
      const start = (part - 1) * partSize;
      const bytes = Buffer.alloc(Math.min(partSize, fileStat.size - start));
      await handle.read(bytes, 0, bytes.length, start);
      const partRes = await request(`${base}/api/v1/media-assets/${assetId}/parts`, 200, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ partNumber: part }),
      });
      const { uploadUrl } = (await partRes.json()).data;
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: bytes,
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(putRes.status, 200, `Part ${part} upload failed`);
      checks++;
    }
  } finally {
    await handle.close();
  }

  // Complete upload
  await request(`${base}/api/v1/media-assets/${assetId}/complete`, 202, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  // Poll until READY
  const deadline = Date.now() + 60_000;
  let readyAsset;
  while (Date.now() < deadline) {
    const statusRes = await request(`${base}/api/v1/media-assets/${assetId}`, 200, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await statusRes.json()).data;
    if (data.status === "READY") {
      readyAsset = data;
      break;
    }
    if (["FAILED", "QUARANTINED"].includes(data.status)) {
      throw new Error(`Media processing ended in ${data.status}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(readyAsset, "Media asset did not become READY in time");

  // Attach
  await request(`${base}/api/v1/media-assets/${assetId}/attach`, 200, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  return readyAsset;
}

try {
  console.log("--- STARTING PHASE 42 PUBLIC PREVIEW & STOREFRONT ACCEPTANCE ---");
  const lecturerToken = await login("PHASE42_LECTURER");
  const studentToken = await login("PHASE42_STUDENT");

  // Generate a small 1-second video clip using ffmpeg via worker container
  const tempDir = await mkdtemp(path.join(tmpdir(), "ailss-preview-test-"));
  const clipPath = path.join(tempDir, "clip.mp4");
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${tempDir}:/fixture`,
      "--entrypoint",
      "ffmpeg",
      "ailss-media-worker:phase42-a",
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "/fixture/clip.mp4",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.ok((await stat(clipPath)).size > 0, "Generated clip file missing");

  // 1. Create a course in DRAFT
  const courseRes = await request(`${base}/api/v1/courses`, 201, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lecturerToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      title: "Storefront Preview Acceptance Course",
      slug: `storefront-preview-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "PAID",
      price: "199000",
      currency: "VND",
    }),
  });
  const course = (await courseRes.json()).data;
  const courseId = course.courseId;

  // 2. Create two lessons: one protected, one preview
  const protectedLessonRes = await request(`${base}/api/v1/courses/${courseId}/lessons`, 201, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lecturerToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      title: "Full Core Lesson 1",
      sectionTitle: "Main Content",
      position: { sectionOrder: 1, lessonOrder: 1 },
      preview: false,
    }),
  });
  const protectedLessonData = (await protectedLessonRes.json()).data;
  const protectedLesson = protectedLessonData.lesson || protectedLessonData;

  const previewLessonRes = await request(`${base}/api/v1/courses/${courseId}/lessons`, 201, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lecturerToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      title: "Course Official Trailer",
      sectionTitle: "Overview",
      position: { sectionOrder: 1, lessonOrder: 2 },
      preview: true,
    }),
  });
  const previewLessonData = (await previewLessonRes.json()).data;
  const previewLesson = previewLessonData.lesson || previewLessonData;

  // -------------------------------------------------------------
  // BF17 — EXPLICIT VISIBILITY ENUM VALIDATION
  // -------------------------------------------------------------
  console.log("[BF17] Verifying Explicit Visibility Invariants...");

  // Attempting PUBLIC_PREVIEW on a protected lesson MUST be rejected (422)
  await request(`${base}/api/v1/courses/${courseId}/media-assets`, 422, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lecturerToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      lessonId: protectedLesson.lessonId,
      originalFilename: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1024 * 1024,
      visibility: "PUBLIC_PREVIEW",
    }),
  });

  // Attempting PROTECTED_LESSON on a preview lesson MUST be rejected (422)
  await request(`${base}/api/v1/courses/${courseId}/media-assets`, 422, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lecturerToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      lessonId: previewLesson.lessonId,
      originalFilename: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1024 * 1024,
      visibility: "PROTECTED_LESSON",
    }),
  });

  // Upload valid preview media and attach
  console.log("Uploading public preview media...");
  const previewAsset = await uploadAndReady(
    lecturerToken,
    courseId,
    previewLesson.lessonId,
    clipPath,
    "PUBLIC_PREVIEW",
  );
  assert.equal(previewAsset.visibility, "PUBLIC_PREVIEW");

  // Upload valid protected media and attach
  console.log("Uploading protected media...");
  const protectedAsset = await uploadAndReady(
    lecturerToken,
    courseId,
    protectedLesson.lessonId,
    clipPath,
    "PROTECTED_LESSON",
  );
  assert.equal(protectedAsset.visibility, "PROTECTED_LESSON");

  // Publish the course via authoring lifecycle
  await request(`${base}/api/v1/courses/${courseId}/submit-review`, 202, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lecturerToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: "{}",
  });

  // Admin publish
  const adminRes = await request(`${base}/api/v1/auth/login`, 200, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: required(fixture, "PHASE42_STUDENT_EMAIL"), // or use cassandra to set published directly
      password: required(fixture, "PHASE42_STUDENT_PASSWORD"),
    }),
  });

  // Direct Cassandra publish for course test fixture
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "ailss-cassandra-dev",
      "cqlsh",
      "-u",
      "cassandra",
      "-p",
      "cassandra",
      "-e",
      `UPDATE learning_keyspace.course_by_id SET state = 'PUBLISHED' WHERE course_id = ${courseId};`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  // -------------------------------------------------------------
  // BF20 — STOREFRONT INTEGRATION
  // -------------------------------------------------------------
  console.log("[BF20] Verifying Storefront Course Facts Consumer...");

  // Anonymous caller fetches course storefront detail
  const storefrontRes = await request(`${base}/api/v1/courses/${courseId}`, 200);
  const storefrontCourse = (await storefrontRes.json()).data;
  assert.equal(storefrontCourse.courseId, courseId);
  assert.equal(storefrontCourse.title, "Storefront Preview Acceptance Course");
  assert.equal(storefrontCourse.priceType, "PAID");
  assert.equal(storefrontCourse.currency, "VND");
  checks++;

  // -------------------------------------------------------------
  // BF18 & BF19 — PUBLIC PREVIEW AUTHORIZATION & PRIVATE ORIGIN
  // -------------------------------------------------------------
  console.log("[BF18, BF19] Verifying Public Trailer Authorization & Denial...");

  // 1. Anonymous user requests trailer
  const trailerRes = await request(`${base}/api/v1/courses/${courseId}/trailer`, 200);
  const trailerData = (await trailerRes.json()).data;
  assert.equal(trailerData.mediaAssetId, previewAsset.mediaAssetId);
  assert.ok(trailerData.playlistUrl.includes("/playback/"));

  // 2. Anonymous user fetches authorized trailer HLS playlist with signed token
  const trailerPlaylistRes = await request(trailerData.playlistUrl, 200);
  const playlistText = await trailerPlaylistRes.text();
  assert.ok(playlistText.startsWith("#EXTM3U"), "HLS playlist should start with #EXTM3U");

  // 3. Anonymous user requests media session for preview lesson directly
  const previewSessionRes = await request(
    `${base}/api/v1/lessons/${previewLesson.lessonId}/media-session`,
    200,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  const previewSession = (await previewSessionRes.json()).data;
  assert.equal(previewSession.mediaAssetId, previewAsset.mediaAssetId);

  // 4. Same anonymous user requests media session for protected lesson -> DENIED (401 or 403)
  const protectedAnonRes = await fetch(`${base}/api/v1/lessons/${protectedLesson.lessonId}/media-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.ok(
    [401, 403].includes(protectedAnonRes.status),
    `Anonymous request for protected lesson MUST be rejected (401 or 403), got ${protectedAnonRes.status}`,
  );
  checks++;

  // 5. Unsigned direct delivery access is DENIED (403) - MinIO origin remains private
  const unsignedUrl = new URL(trailerData.playlistUrl);
  unsignedUrl.search = "";
  await request(unsignedUrl.toString(), 403);

  // 6. Direct MinIO anonymous access is blocked
  const minioDirect = await fetch("http://127.0.0.1:9000/ailss-media/", { method: "GET" });
  assert.equal(minioDirect.status, 403, "MinIO bucket root must not be public");
  checks++;

  console.log(`\n======================================================`);
  console.log(`PHASE42_PREVIEW_STOREFRONT_PASS assertions=${checks}`);
  console.log(`PUBLIC_TRAILER_STATUS = PASS_LOCAL`);
  console.log(`STOREFRONT_MEDIA_STATUS = PASS_LOCAL`);
  console.log(`======================================================\n`);
} catch (error) {
  console.error(`PHASE42_PREVIEW_STOREFRONT_FAIL: ${error.name}: ${error.message}`);
  process.exitCode = 1;
}
