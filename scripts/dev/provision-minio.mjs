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
if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket, "ailss-lab");
await client.setBucketPolicy(bucket, JSON.stringify({ Version: "2012-10-17", Statement: [] }));
console.log(JSON.stringify({ stage: "minio-provision", status: "PASS", bucket, publicAccess: false }));
