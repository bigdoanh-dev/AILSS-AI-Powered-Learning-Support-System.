import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readEnv, required } from "../dev/env.mjs";

const fixture = await readEnv(new URL("../../.env.media-acceptance", import.meta.url));
const base = "http://127.0.0.1:8080/api/v1";
const directory = await mkdtemp(
  path.join(process.env.PHASE42_SOURCE_FIXTURE_DIR ?? tmpdir(), "ailss-phase42-invalid-source-"),
);
const results = [];
let step = "policies";
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
async function api(token, route, method = "GET", body, expected = 200) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Connection: "close",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method === "POST" ? { "Idempotency-Key": randomUUID() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${route}: HTTP ${response.status} ${value.error?.code ?? ""}`);
  return expected >= 400 ? value.error : value.data;
}
function generate(filename, args) {
  docker(
    "run",
    "--rm",
    "--cpus",
    "1",
    "--memory",
    "256m",
    "-v",
    `${directory}:/fixture`,
    "--entrypoint",
    "ffmpeg",
    "ailss-media-worker:phase42-b",
    "-nostdin",
    "-v",
    "error",
    ...args,
    `/fixture/${filename}`,
  );
  return readFile(path.join(directory, filename));
}
try {
  const policy = JSON.parse(
    docker(
      "exec",
      "ailss-learning-service",
      "node",
      "-e",
      `console.log(JSON.stringify({maxBytes:Number(process.env.MEDIA_MAX_SOURCE_BYTES),maxDuration:Number(process.env.MEDIA_MAX_DURATION_SECONDS)}))`,
    ),
  );
  assert.ok(Number.isSafeInteger(policy.maxBytes) && policy.maxBytes > 0);
  assert.ok(Number.isSafeInteger(policy.maxDuration) && policy.maxDuration > 0);
  const lecturer = (
    await api(undefined, "/auth/login", "POST", {
      email: required(fixture, "PHASE42_LECTURER_EMAIL"),
      password: required(fixture, "PHASE42_LECTURER_PASSWORD"),
    })
  ).accessToken;
  const route = `/courses/${required(fixture, "PHASE42_COURSE_ID")}/media-assets`;
  const body = {
    lessonId: required(fixture, "PHASE42_LESSON_ID"),
    originalFilename: "invalid.mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
  };
  step = "wrong-mime-declaration";
  assert.equal(
    (await api(lecturer, route, "POST", { ...body, mimeType: "video/avi" }, 422)).code,
    "MEDIA_VALIDATION_FAILED",
  );
  results.push("unsupported MIME declaration rejected before upload");
  step = "oversize-declaration";
  assert.equal(
    (await api(lecturer, route, "POST", { ...body, sizeBytes: policy.maxBytes + 1 }, 413)).code,
    "MEDIA_SOURCE_SIZE_REJECTED",
  );
  results.push("oversized source rejected before reservation/MPU");
  step = "cross-course";
  const course = await api(
    lecturer,
    "/courses",
    "POST",
    {
      title: "Phase42 scope validation",
      slug: `media-scope-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
    201,
  );
  assert.equal(
    (await api(lecturer, `/courses/${course.courseId}/media-assets`, "POST", body, 422)).code,
    "MEDIA_LESSON_REJECTED",
  );
  results.push("cross-course lesson binding rejected before upload");
  step = "malformed-completion";
  const incomplete = await api(lecturer, route, "POST", body, 201);
  const id = incomplete.asset.mediaAssetId;
  assert.equal(
    (await api(lecturer, `/media-assets/${id}/complete`, "POST", {}, 409)).code,
    "MEDIA_PARTS_INCOMPLETE",
  );
  const part = await api(lecturer, `/media-assets/${id}/parts`, "POST", { partNumber: 1 });
  assert.equal(
    (
      await fetch(part.uploadUrl, {
        method: "PUT",
        body: Buffer.alloc(50),
        signal: AbortSignal.timeout(30_000),
      })
    ).status,
    200,
  );
  assert.equal(
    (await api(lecturer, `/media-assets/${id}/complete`, "POST", {}, 409)).code,
    "MEDIA_PARTS_INCOMPLETE",
  );
  assert.equal((await api(lecturer, `/media-assets/${id}`)).status, "UPLOADING");
  await api(lecturer, `/media-assets/${id}/cancel`, "POST", {});
  results.push("missing/short multipart data never completes; cancellation releases reservation");
  step = "generate-small-real-media";
  const valid = await generate("valid.mp4", [
    "-f",
    "lavfi",
    "-i",
    "color=size=64x64:rate=1",
    "-frames:v",
    "2",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-movflags",
    "+faststart",
  ]);
  const codec = await generate("codec.mp4", [
    "-f",
    "lavfi",
    "-i",
    "color=size=64x64:rate=1",
    "-frames:v",
    "2",
    "-c:v",
    "mpeg4",
    "-threads",
    "1",
    "-movflags",
    "+faststart",
  ]);
  const container = await generate("container.mkv", [
    "-f",
    "lavfi",
    "-i",
    "color=size=64x64:rate=1",
    "-frames:v",
    "2",
    "-c:v",
    "libx264",
    "-threads",
    "1",
  ]);
  // Two real frames with distant timestamps, not 4 hours of expensive encoding.
  const duration = await generate("duration.mp4", [
    "-f",
    "lavfi",
    "-i",
    "color=size=64x64:rate=1",
    "-frames:v",
    "2",
    "-vf",
    `setpts=${policy.maxDuration + 2}*PTS`,
    "-fps_mode",
    "passthrough",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-movflags",
    "+faststart",
  ]);
  const webm = await generate("valid.webm", [
    "-f",
    "lavfi",
    "-i",
    "color=size=64x64:rate=1",
    "-frames:v",
    "2",
    "-c:v",
    "libvpx-vp9",
    "-threads",
    "1",
  ]);
  const relabeled = Buffer.from(container);
  const docTypeOffset = relabeled.indexOf(Buffer.from("matroska"));
  assert.ok(docTypeOffset > 0);
  relabeled.write("webm\0\0\0\0", docTypeOffset, "ascii");
  const multiple = await generate("multiple.mkv", [
    "-f",
    "lavfi",
    "-i",
    "color=size=64x64:rate=1",
    "-t",
    "2",
    "-frames:v",
    "2",
    "-map",
    "0:v",
    "-map",
    "0:v",
    "-c:v:0",
    "libvpx-vp9",
    "-c:v:1",
    "libx264",
    "-threads",
    "1",
  ]);
  const multipleTypeOffset = multiple.indexOf(Buffer.from("matroska"));
  assert.ok(multipleTypeOffset > 0);
  multiple.write("webm\0\0\0\0", multipleTypeOffset, "ascii");
  const cases = [
    {
      label: "invalid magic",
      bytes: Buffer.alloc(100),
      mime: "video/mp4",
      code: "MEDIA_CONTAINER_SIGNATURE_REJECTED",
    },
    {
      label: "truncated container",
      bytes: valid.subarray(0, 24),
      mime: "video/mp4",
      code: "MEDIA_PROBE_REJECTED",
    },
    { label: "unsupported codec", bytes: codec, mime: "video/mp4", code: "MEDIA_POLICY_REJECTED" },
    { label: "unsupported container", bytes: container, mime: "video/webm", code: "MEDIA_POLICY_REJECTED" },
    { label: "over-duration source", bytes: duration, mime: "video/mp4", code: "MEDIA_POLICY_REJECTED" },
    {
      label: "Matroska codec relabeled through WebM DocType",
      bytes: relabeled,
      mime: "video/webm",
      code: "MEDIA_POLICY_REJECTED",
    },
    {
      label: "forbidden second WebM video stream",
      bytes: multiple,
      mime: "video/webm",
      code: "MEDIA_POLICY_REJECTED",
    },
    { label: "MIME/signature mismatch", bytes: valid, mime: "video/webm", code: "MEDIA_MIME_REJECTED" },
    { label: "reverse MIME/signature mismatch", bytes: webm, mime: "video/mp4", code: "MEDIA_MIME_REJECTED" },
    { label: "valid MP4 control", bytes: valid, mime: "video/mp4", ready: true },
    { label: "valid WebM control", bytes: webm, mime: "video/webm", ready: true },
  ];
  for (const entry of cases) {
    step = entry.label;
    assert.ok(entry.bytes.length > 0 && entry.bytes.length < 8 * 1024 * 1024);
    const upload = await api(
      lecturer,
      route,
      "POST",
      {
        ...body,
        originalFilename: "source-validation.bin",
        mimeType: entry.mime,
        sizeBytes: entry.bytes.length,
      },
      201,
    );
    const assetId = upload.asset.mediaAssetId;
    const signed = await api(lecturer, `/media-assets/${assetId}/parts`, "POST", { partNumber: 1 });
    assert.equal(
      (
        await fetch(signed.uploadUrl, {
          method: "PUT",
          body: entry.bytes,
          signal: AbortSignal.timeout(30_000),
        })
      ).status,
      200,
    );
    await api(lecturer, `/media-assets/${assetId}/complete`, "POST", {}, 202);
    const deadline = Date.now() + 90_000;
    let asset;
    while (Date.now() < deadline) {
      asset = await api(lecturer, `/media-assets/${assetId}`);
      if (["READY", "QUARANTINED", "FAILED"].includes(asset.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(asset.status, entry.ready ? "READY" : "QUARANTINED", `${entry.label}: ${asset.status}`);
    if (!entry.ready) assert.equal(asset.failureCode, entry.code, `${entry.label} exact reason`);
    results.push(`${entry.label}: ${asset.status}/${entry.code ?? "VALID"} asset=${assetId}`);
    console.log(`PASS ${results.at(-1)}`);
  }
  console.log(
    `PHASE42_SOURCE_VALIDATION_PASS cases=${results.length} noStatusMutation=true noNetworkMocks=true`,
  );
} catch (error) {
  console.error(
    `PHASE42_SOURCE_VALIDATION_FAIL step=${step} name=${error.name} message=${String(error.message).replace(/https?:\/\/[^\s]+/g, "[URL REDACTED]")}`,
  );
  process.exitCode = 1;
}
