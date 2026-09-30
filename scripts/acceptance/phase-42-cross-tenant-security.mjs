import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readEnv, required } from "../dev/env.mjs";
import { signMediaPlayback } from "../../dist/packages/security/src/media-playback.js";

const fixture = await readEnv(new URL("../../.env.media-acceptance", import.meta.url));
const mediaEnv = await readEnv(new URL("../../.env.media", import.meta.url));
const base = "http://127.0.0.1:8080";
let checks = 0;

async function request(url, expectedStatus, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Connection: "close", ...options.headers },
    signal: AbortSignal.timeout(30_000),
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

function cassandraExec(input) {
  const script = `
import { readFileSync } from "node:fs";
import { Client, types } from "cassandra-driver";
const i = JSON.parse(readFileSync(0, "utf8"));
const client = new Client({
  contactPoints: process.env.CASSANDRA_CONTACT_POINTS.split(","),
  localDataCenter: process.env.CASSANDRA_LOCAL_DC,
  keyspace: "learning_keyspace",
  credentials: { username: process.env.CASSANDRA_USERNAME, password: process.env.CASSANDRA_PASSWORD },
});
const q = { prepare: true, consistency: types.consistencies.localQuorum };
const u = types.Uuid.fromString;
try {
  if (i.action === "insertTenantB") {
    // Insert Tenant B course, lesson, and media asset
    await client.execute(
      "INSERT INTO course_by_id (course_id, owner_lecturer_id, title, slug, category_id, state, content_version, record_version, price_type, price, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PUBLISHED', 1, 1, 'PAID', 100000, 'VND', toTimestamp(now()), toTimestamp(now()))",
      [u(i.courseId), u(i.ownerId), "Tenant B Course", "tenant-b-course-" + i.courseId, u(i.categoryId)],
      q
    );
    await client.execute(
      "INSERT INTO lesson_by_id_version (lesson_id, lesson_version, course_id, content_version, state, preview, title, updated_at) VALUES (?, 1, ?, 1, 'READY', false, 'Tenant B Lesson', toTimestamp(now()))",
      [u(i.lessonId), u(i.courseId)],
      q
    );
    await client.execute(
      "INSERT INTO lesson_current_by_id (lesson_id, lesson_version, course_id, updated_at) VALUES (?, 1, ?, toTimestamp(now()))",
      [u(i.lessonId), u(i.courseId)],
      q
    );
    await client.execute(
      "INSERT INTO lessons_by_course_version (course_id, content_version, section_order, lesson_order, lesson_id, lesson_version, section_title, lesson_title, state, preview) VALUES (?, 1, 1, 1, ?, 1, 'Section 1', 'Tenant B Lesson', 'READY', false)",
      [u(i.courseId), u(i.lessonId)],
      q
    );
    await client.execute(
      "INSERT INTO media_asset_by_lesson (tenant_id, lesson_id, media_asset_id) VALUES (?, ?, ?)",
      [u(i.tenantId), u(i.lessonId), u(i.mediaAssetId)],
      q
    );
    const payload = JSON.stringify({
      mediaAssetId: i.mediaAssetId,
      tenantId: i.tenantId,
      ownerUserId: i.ownerId,
      courseId: i.courseId,
      lessonId: i.lessonId,
      mediaType: "VIDEO",
      originalFilename: "tenant-b.mp4",
      mimeType: "video/mp4",
      originalObjectKey: "media-original/" + i.tenantId + "/" + i.mediaAssetId + "/1/source",
      status: "READY",
      visibility: "PROTECTED_LESSON",
      masterPlaylistObjectKey: "media-hls/" + i.tenantId + "/" + i.mediaAssetId + "/1/v1/master.m3u8",
      posterObjectKey: "media-hls/" + i.tenantId + "/" + i.mediaAssetId + "/1/v1/poster.jpg",
      captionTracks: [],
      revision: 1,
      processingVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      uploadExpiresAt: new Date().toISOString(),
      audit: [],
    });
    await client.execute(
      "INSERT INTO media_asset_by_tenant_id (tenant_id, media_asset_id, revision, payload) VALUES (?, ?, 1, ?)",
      [u(i.tenantId), u(i.mediaAssetId), payload],
      q
    );
    console.log(JSON.stringify({ ok: true }));
  } else if (i.action === "cleanupTenantB") {
    await client.execute("DELETE FROM course_by_id WHERE course_id = ?", [u(i.courseId)], q);
    await client.execute("DELETE FROM lesson_by_id_version WHERE lesson_id = ? AND lesson_version = 1", [u(i.lessonId)], q);
    await client.execute("DELETE FROM lesson_current_by_id WHERE lesson_id = ?", [u(i.lessonId)], q);
    await client.execute("DELETE FROM lessons_by_course_version WHERE course_id = ? AND content_version = 1", [u(i.courseId)], q);
    await client.execute("DELETE FROM media_asset_by_lesson WHERE tenant_id = ? AND lesson_id = ?", [u(i.tenantId), u(i.lessonId)], q);
    await client.execute("DELETE FROM media_asset_by_tenant_id WHERE tenant_id = ? AND media_asset_id = ?", [u(i.tenantId), u(i.mediaAssetId)], q);
    console.log(JSON.stringify({ ok: true }));
  }
} finally {
  await client.shutdown();
}
`;
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", script],
      {
        input: JSON.stringify(input),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ),
  );
}

try {
  console.log("--- STARTING PHASE 42 CROSS-TENANT & DELIVERY SECURITY ACCEPTANCE ---");
  const lecturerToken = await login("PHASE42_LECTURER");
  const studentToken = await login("PHASE42_STUDENT");
  const otherToken = await login("PHASE42_OTHER");

  const tenantBId = "00000000-0000-4000-8000-000000000002";
  const tenantBCourseId = randomUUID();
  const tenantBLessonId = randomUUID();
  const tenantBMediaAssetId = randomUUID();
  const tenantBOwnerId = randomUUID();

  // Setup actual Tenant B rows in Cassandra
  cassandraExec({
    action: "insertTenantB",
    tenantId: tenantBId,
    courseId: tenantBCourseId,
    lessonId: tenantBLessonId,
    mediaAssetId: tenantBMediaAssetId,
    ownerId: tenantBOwnerId,
    categoryId: randomUUID(),
  });

  try {
    // -------------------------------------------------------------
    // BF7 — CROSS-TENANT HTTP PROOF
    // -------------------------------------------------------------
    console.log("[BF7] Verifying Cross-Tenant HTTP Isolation...");

    // 1. Tenant A lecturer cannot create/upload media for Tenant B course
    await request(`${base}/api/v1/courses/${tenantBCourseId}/media-assets`, 403, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lecturerToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        lessonId: tenantBLessonId,
        originalFilename: "hack.mp4",
        mimeType: "video/mp4",
        sizeBytes: 1024 * 1024,
      }),
    });

    // 2. Tenant A student cannot request playback session for Tenant B protected lesson
    // Note: Learning service tenant-scopes queries, so foreign tenant lesson returns 404/403
    const foreignSessionRes = await fetch(`${base}/api/v1/lessons/${tenantBLessonId}/media-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${studentToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.ok(
      [403, 404].includes(foreignSessionRes.status),
      `Tenant A student request for Tenant B lesson should be denied (403 or 404), got ${foreignSessionRes.status}`,
    );
    checks++;

    // 3. Tenant A token cannot retrieve Tenant B delivery assets
    const activeLessonId = required(fixture, "PHASE42_LESSON_ID");
    const activeSessionRes = await request(`${base}/api/v1/lessons/${activeLessonId}/media-session`, 200, {
      method: "POST",
      headers: { Authorization: `Bearer ${studentToken}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const activeSession = (await activeSessionRes.json()).data;
    const activeMasterUrl = new URL(activeSession.playlistUrl);
    const activeToken = activeMasterUrl.searchParams.get("token");

    // Attempt to access Tenant B asset with Tenant A token
    await request(
      `${base}/playback/${tenantBMediaAssetId}/master.m3u8?token=${encodeURIComponent(activeToken)}`,
      403,
    );
    await request(
      `${base}/playback/${tenantBMediaAssetId}/poster.jpg?token=${encodeURIComponent(activeToken)}`,
      403,
    );
    await request(
      `${base}/playback/${tenantBMediaAssetId}/caption-${randomUUID()}.vtt?token=${encodeURIComponent(activeToken)}`,
      403,
    );

    // -------------------------------------------------------------
    // BF8 — CROSS-COURSE PROOF (within same tenant)
    // -------------------------------------------------------------
    console.log("[BF8] Verifying Cross-Course Entitlement Denial...");

    // otherToken is for PHASE42_OTHER student who does NOT have entitlement to PHASE42_COURSE_ID
    await request(`${base}/api/v1/lessons/${activeLessonId}/media-session`, 403, {
      method: "POST",
      headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" },
      body: "{}",
    });

    // -------------------------------------------------------------
    // BF9 — COMPLETE DELIVERY MATRIX
    // -------------------------------------------------------------
    console.log("[BF9] Verifying Complete Delivery Security Matrix...");

    const assetId = activeSession.mediaAssetId;
    const masterPlaylist = await (
      await request(`${base}/playback/${assetId}/master.m3u8?token=${encodeURIComponent(activeToken)}`, 200)
    ).text();
    const variantLine = masterPlaylist
      .split("\n")
      .find((line) => line && !line.startsWith("#"))
      .trim();
    const [variantFilename] = variantLine.split("?");
    const variantPlaylist = await (await request(`${base}/playback/${assetId}/${variantLine}`, 200)).text();
    const segmentLine = variantPlaylist
      .split("\n")
      .find((line) => line && !line.startsWith("#"))
      .trim();
    const [segmentFilename] = segmentLine.split("?");

    // 1. Unsigned master playlist -> 403
    await request(`${base}/playback/${assetId}/master.m3u8`, 403);

    // 2. Unsigned variant playlist -> 403
    await request(`${base}/playback/${assetId}/${variantFilename}`, 403);

    // 3. Unsigned segment -> 403
    await request(`${base}/playback/${assetId}/${segmentFilename}`, 403);

    // 4. Unsigned poster -> 403
    await request(`${base}/playback/${assetId}/poster.jpg`, 403);

    // 5. Unsigned caption -> 403
    if (activeSession.captionTracks?.length) {
      const captionTrack = activeSession.captionTracks[0];
      const captionName = `caption-${captionTrack.captionTrackId}.vtt`;
      await request(`${base}/playback/${assetId}/${captionName}`, 403);
    }

    // 6. Expired token -> 403
    const secret = mediaEnv.MEDIA_PLAYBACK_SECRET;
    const expiredToken = await signMediaPlayback(
      {
        sub: randomUUID(),
        tenantId: "00000000-0000-4000-8000-000000000001",
        courseId: fixture.PHASE42_COURSE_ID,
        lessonId: activeLessonId,
        mediaAssetId: assetId,
        processingVersion: 1,
        outputPrefix: `00000000-0000-4000-8000-000000000001/${assetId}/1/${randomUUID()}`,
        operation: "PLAYBACK",
      },
      secret,
      1, // 1s ttl
    );
    await new Promise((r) => setTimeout(r, 1500));
    await request(`${base}/playback/${assetId}/master.m3u8?token=${encodeURIComponent(expiredToken)}`, 403);

    // 7. Forged token (tampered claims / bad signature) -> 403
    const tokenParts = activeToken.split(".");
    const forgedToken = `${tokenParts[0]}.${tokenParts[1]}.forgedSignatureFake1234567890`;
    await request(`${base}/playback/${assetId}/master.m3u8?token=${encodeURIComponent(forgedToken)}`, 403);

    // 8. Wrong-media token -> 403
    const otherAssetId = required(fixture, "PHASE42_ASSET_ID");
    assert.notEqual(assetId, otherAssetId);
    await request(
      `${base}/playback/${otherAssetId}/master.m3u8?token=${encodeURIComponent(activeToken)}`,
      403,
    );

    // 9. Wrong-tenant token -> 403
    const wrongTenantToken = await signMediaPlayback(
      {
        sub: randomUUID(),
        tenantId: tenantBId,
        courseId: fixture.PHASE42_COURSE_ID,
        lessonId: activeLessonId,
        mediaAssetId: assetId,
        processingVersion: 1,
        outputPrefix: `${tenantBId}/${assetId}/1/${randomUUID()}`,
        operation: "PLAYBACK",
      },
      secret,
      120,
    );
    await request(
      `${base}/playback/${assetId}/master.m3u8?token=${encodeURIComponent(wrongTenantToken)}`,
      403,
    );

    // 10. Wrong-course entitlement -> 403 (checked in BF8)

    // 11. Playback token used on upload endpoint -> 401
    await request(`${base}/api/v1/media-assets/${assetId}/parts`, 401, {
      method: "POST",
      headers: { Authorization: `Bearer ${activeToken}`, "Content-Type": "application/json" },
      body: '{"partNumber":1}',
    });
    await request(`${base}/api/v1/media-assets/${assetId}/upload`, 401, {
      headers: { Authorization: `Bearer ${activeToken}` },
    });

    // 12. Upload credential (JWT) used on playback delivery endpoint -> 403
    await request(`${base}/playback/${assetId}/master.m3u8?token=${encodeURIComponent(lecturerToken)}`, 403);
    await request(`${base}/playback/${assetId}/master.m3u8`, 403, {
      headers: { Authorization: `Bearer ${lecturerToken}` },
    });
  } finally {
    // Cleanup Tenant B fixture rows
    cassandraExec({
      action: "cleanupTenantB",
      tenantId: tenantBId,
      courseId: tenantBCourseId,
      lessonId: tenantBLessonId,
      mediaAssetId: tenantBMediaAssetId,
    });
  }

  console.log(`\n======================================================`);
  console.log(`PHASE42_CROSS_TENANT_SECURITY_PASS assertions=${checks}`);
  console.log(`MEDIA_SECURITY_MATRIX_STATUS = PASS_LOCAL`);
  console.log(`CROSS_TENANT_HTTP_STATUS = PASS_LOCAL`);
  console.log(`======================================================\n`);
} catch (error) {
  console.error(`PHASE42_CROSS_TENANT_SECURITY_FAIL: ${error.name}: ${error.message}`);
  process.exitCode = 1;
}
