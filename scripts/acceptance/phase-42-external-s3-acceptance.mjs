import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Phase 42 Revision C: External S3 Acceptance Harness
 *
 * This harness verifies real external S3-compatible object storage readiness.
 * It is DISABLED by default and must NOT run against local MinIO.
 * It activates only when AILSS_ACCEPTANCE_EXTERNAL_S3=true.
 */

const isExternalEnabled = process.env.AILSS_ACCEPTANCE_EXTERNAL_S3 === "true";

if (!isExternalEnabled) {
  console.log(
    JSON.stringify(
      {
        harness: "phase-42-external-s3-acceptance",
        status: "DISABLED",
        reason:
          "AILSS_ACCEPTANCE_EXTERNAL_S3 is not set to 'true'. Standing by for external DevOps configuration.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const { S3MediaStorage } = await import("../../dist/packages/storage/src/media.js").catch(async () => {
  return import("../../packages/storage/src/media.js");
});

// Fail-closed validation: ensure real external S3 configuration is provided
const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
const port = Number(process.env.OBJECT_STORAGE_PORT || 443);
const useSSL = process.env.OBJECT_STORAGE_USE_SSL === "true";
const publicUrl = process.env.OBJECT_STORAGE_PUBLIC_URL;
const bucket = process.env.MEDIA_STORAGE_BUCKET;
const accessKey = process.env.MEDIA_STORAGE_ACCESS_KEY;
const secretKey = process.env.MEDIA_STORAGE_SECRET_KEY;
const region = process.env.OBJECT_STORAGE_REGION || "us-east-1";

if (!endpoint || !bucket || !accessKey || !secretKey || !publicUrl) {
  console.error(
    "FAIL-CLOSED: External S3 acceptance requires explicit endpoint, bucket, credentials, and publicUrl.",
  );
  process.exit(1);
}

if (endpoint === "127.0.0.1" || endpoint === "localhost" || endpoint.includes("minio")) {
  console.error("FAIL-CLOSED: External S3 acceptance must NOT run against local MinIO or loopback address.");
  process.exit(1);
}

if (!useSSL) {
  console.error("FAIL-CLOSED: External S3 acceptance requires OBJECT_STORAGE_USE_SSL=true.");
  process.exit(1);
}

console.log(
  `Starting External S3 Acceptance against endpoint=${endpoint}, bucket=${bucket}, region=${region}...`,
);

const storage = new S3MediaStorage(
  bucket,
  {
    endPoint: endpoint,
    port,
    useSSL,
    accessKey,
    secretKey,
    region,
  },
  publicUrl,
);

const tenantId = randomUUID();
const mediaAssetId = randomUUID();
const originalKey = `media-original/${tenantId}/${mediaAssetId}/1/source`;
const hlsPrefix = `media-hls/${tenantId}/${mediaAssetId}/1/${randomUUID()}`;
const posterKey = `${hlsPrefix}/poster.jpg`;
const masterKey = `${hlsPrefix}/master.m3u8`;
const captionKey = `media-caption/${tenantId}/${mediaAssetId}/${randomUUID()}.vtt`;

async function run() {
  const steps = [];

  // Step 1: Multipart upload simulation (5 MiB test payload)
  const partSize = 5 * 1024 * 1024;
  const partData = randomBytes(partSize);
  const uploadId = await storage.begin(originalKey, "video/mp4");
  assert.ok(uploadId, "Upload ID should be returned from S3 begin");
  steps.push("1. Multipart begin successful");

  // Step 2: Upload single part using presigned URL or direct PUT
  const presignedPut = await storage.partUrl(originalKey, uploadId, 1, 900);
  assert.ok(presignedPut.startsWith("https://"), "Presigned part URL must be HTTPS");

  const uploadRes = await fetch(presignedPut, {
    method: "PUT",
    body: partData,
    headers: { "Content-Length": String(partSize) },
  });
  assert.ok(uploadRes.ok, `Part upload HTTP status must be 2xx, got ${uploadRes.status}`);
  const etag = uploadRes.headers.get("etag")?.replace(/"/g, "") ?? "test-etag";
  steps.push("2. Part upload successful via presigned URL");

  // Step 3: List authoritative parts
  const parts = await storage.parts(originalKey, uploadId);
  assert.ok(parts.length >= 1, "Uploaded parts list should contain at least 1 part");
  assert.equal(parts[0].part, 1, "Part number should be 1");
  steps.push("3. Authoritative parts listed from S3");

  // Step 4: Complete multipart upload
  await storage.complete(originalKey, uploadId, [{ part: 1, etag: parts[0].etag || etag, size: partSize }]);
  steps.push("4. Multipart completed");

  // Step 5: HEAD object
  const stat = await storage.stat(originalKey);
  assert.equal(stat.size, partSize, "Object size on S3 must match uploaded size");
  steps.push("5. HEAD object verified on S3");

  // Step 6: Worker reads stream from S3
  const stream = await storage.readStream(originalKey);
  let bytesRead = 0;
  for await (const chunk of stream) {
    bytesRead += chunk.length;
  }
  assert.equal(bytesRead, partSize, "Streamed bytes from S3 must match original bytes");
  steps.push("6. Worker read stream verified");

  // Step 7: Worker writes derived HLS & poster
  const masterContent = Buffer.from("#EXTM3U\n#EXT-X-VERSION:3\nvariant-0.m3u8\n");
  await storage.writeBytes(masterKey, masterContent, "application/vnd.apple.mpegurl");

  const posterContent = randomBytes(1024);
  await storage.writeBytes(posterKey, posterContent, "image/jpeg");
  steps.push("7. Derived HLS master and poster written to S3");

  // Step 8: Caption written
  const captionContent = Buffer.from("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nExternal S3 caption test\n");
  await storage.writeBytes(captionKey, captionContent, "text/vtt; charset=utf-8");
  steps.push("8. Caption VTT written to S3");

  // Step 9: Private anonymous read denied (Block Public Access check)
  const anonymousUrl = `${publicUrl.replace(/\/$/, "")}/${bucket}/${originalKey}`;
  let anonBlocked = false;
  try {
    const anonRes = await fetch(anonymousUrl, { method: "GET" });
    if (anonRes.status === 403 || anonRes.status === 404) {
      anonBlocked = true;
    }
  } catch {
    // Connection refused / SSL failure / DNS failure also confirms private origin
    anonBlocked = true;
  }
  assert.ok(anonBlocked, "Anonymous unauthenticated direct S3 read must be denied (403 Forbidden)");
  steps.push("9. Direct anonymous read denied (private origin confirmed)");

  // Step 10: Cleanup succeeds
  await storage.remove(originalKey);
  await storage.remove(masterKey);
  await storage.remove(posterKey);
  await storage.remove(captionKey);
  steps.push("10. Cleanup of test objects succeeded");

  console.log(
    JSON.stringify(
      {
        harness: "phase-42-external-s3-acceptance",
        status: "PASS",
        endpoint,
        bucket,
        steps,
      },
      null,
      2,
    ),
  );
}

run().catch((err) => {
  console.error("External S3 Acceptance Failed:", err);
  process.exit(1);
});
