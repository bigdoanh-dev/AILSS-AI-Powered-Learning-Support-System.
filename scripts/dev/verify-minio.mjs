import { randomUUID, createHash } from "node:crypto";
import { Client } from "minio";
import { readEnv, required } from "./env.mjs";

const env = await readEnv();
const client = new Client({
  endPoint: env.OBJECT_STORAGE_ENDPOINT ?? "127.0.0.1",
  port: Number(env.OBJECT_STORAGE_PORT ?? 9000),
  useSSL: env.OBJECT_STORAGE_USE_SSL === "true",
  accessKey: required(env, "OBJECT_STORAGE_ACCESS_KEY"),
  secretKey: required(env, "OBJECT_STORAGE_SECRET_KEY"),
});
const bucket = env.OBJECT_STORAGE_BUCKET ?? "ailss-documents";
const objectName = `phase6-smoke/${randomUUID()}.txt`;
const body = Buffer.from("AILSS Phase 6 object-storage roundtrip\n");
const expected = createHash("sha256").update(body).digest("hex");
try {
  await client.putObject(bucket, objectName, body, body.length, {
    "Content-Type": "text/plain",
    "x-amz-meta-sha256": expected,
  });
  const stream = await client.getObject(bucket, objectName);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const actual = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
  if (actual !== expected) throw new Error("Object storage checksum mismatch");
  console.log(
    JSON.stringify({
      stage: "minio-roundtrip",
      status: "PASS",
      bucket,
      bytes: body.length,
      sha256: expected,
    }),
  );
} finally {
  await client.removeObject(bucket, objectName).catch(() => undefined);
}
