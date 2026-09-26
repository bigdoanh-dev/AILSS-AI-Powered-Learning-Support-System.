import { execFileSync } from "node:child_process";
import { readEnv, required } from "./env.mjs";
const env = await readEnv(),
  media = await readEnv(new URL("../../.env.media", import.meta.url));
const arn = `arn:aws:s3:::${required(media, "MEDIA_STORAGE_BUCKET")}`;
const policy = {
  Version: "2012-10-17",
  Statement: [
    { Effect: "Allow", Action: ["s3:GetBucketLocation"], Resource: [arn] },
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:AbortMultipartUpload"],
      Resource: [`${arn}/media-original/*`],
    },
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      Resource: [`${arn}/media-hls/*`],
    },
  ],
};
try {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      "MC_HOST_local",
      "ailss-minio",
      "mc",
      "admin",
      "policy",
      "create",
      "local",
      "ailss-media-worker",
      "/dev/stdin",
    ],
    {
      env: {
        ...process.env,
        MC_HOST_local: `http://${encodeURIComponent(required(env, "OBJECT_STORAGE_ACCESS_KEY"))}:${encodeURIComponent(required(env, "OBJECT_STORAGE_SECRET_KEY"))}@127.0.0.1:9000`,
      },
      input: JSON.stringify(policy),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  console.log(
    "MEDIA_WORKER_POLICY_PASS (existing identity preserved; abort permission limited to original prefix)",
  );
} catch {
  console.error("MEDIA_WORKER_POLICY_FAIL (credential-bearing diagnostics suppressed)");
  process.exitCode = 1;
}
