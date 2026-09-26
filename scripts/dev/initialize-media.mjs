import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readEnv, required } from "./env.mjs";

// Local provisioning only; production uses platform-managed workload credentials.
// No credentials are returned to clients, logged, or passed as command-line args.
const env = await readEnv();
const file = new URL("../../.env.media", import.meta.url);
let media;
try {
  media = await readEnv(file);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
media ??= {
  MEDIA_STORAGE_BUCKET: "ailss-media",
  MEDIA_MAX_SOURCE_BYTES: "1073741824",
  MEDIA_MAX_DURATION_SECONDS: "14400",
  MEDIA_DELIVERY_ORIGIN: "http://127.0.0.1:8080",
  MEDIA_ALLOWED_ORIGINS: "http://127.0.0.1:5173,http://localhost:5173",
  MEDIA_PLAYBACK_SECRET: randomBytes(48).toString("hex"),
  CASSANDRA_SVC_MEDIA_WORKER_PASSWORD: randomBytes(32).toString("hex"),
};
for (const principal of ["API", "WORKER", "DELIVERY"]) {
  media[`MEDIA_${principal}_ACCESS_KEY`] ??= `ailss-media-${principal.toLowerCase()}`;
  media[`MEDIA_${principal}_SECRET_KEY`] ??= randomBytes(32).toString("hex");
}
const alias = `http://${encodeURIComponent(required(env, "OBJECT_STORAGE_ACCESS_KEY"))}:${encodeURIComponent(required(env, "OBJECT_STORAGE_SECRET_KEY"))}@127.0.0.1:9000`;
const run = (args, input, extra = {}) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      "MC_HOST_local",
      ...Object.keys(extra).flatMap((k) => ["-e", k]),
      "ailss-minio",
      ...args,
    ],
    {
      env: { ...process.env, MC_HOST_local: alias, ...extra },
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
try {
  run(["mc", "mb", "--ignore-existing", `local/${media.MEDIA_STORAGE_BUCKET}`]);
  run(["mc", "anonymous", "set", "none", `local/${media.MEDIA_STORAGE_BUCKET}`]);
  const arn = `arn:aws:s3:::${media.MEDIA_STORAGE_BUCKET}`;
  const statement = (Action, Resource) => ({ Effect: "Allow", Action, Resource });
  const policies = {
    API: [
      statement(
        ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
        [`${arn}/media-original/*`],
      ),
    ],
    WORKER: [
      statement(["s3:GetObject"], [`${arn}/media-original/*`]),
      statement(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], [`${arn}/media-hls/*`]),
    ],
    DELIVERY: [statement(["s3:GetObject"], [`${arn}/media-hls/*`])],
  };
  for (const principal of Object.keys(policies)) {
    const name = `ailss-media-${principal.toLowerCase()}`;
    run(
      ["mc", "admin", "policy", "create", "local", name, "/dev/stdin"],
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [statement(["s3:GetBucketLocation"], [arn]), ...policies[principal]],
      }),
    );
    run(
      [
        "sh",
        "-ec",
        'mc admin user add local "$MEDIA_USER" "$MEDIA_SECRET" >/dev/null; mc admin policy attach local "$MEDIA_POLICY" --user "$MEDIA_USER" >/dev/null',
      ],
      undefined,
      {
        MEDIA_USER: media[`MEDIA_${principal}_ACCESS_KEY`],
        MEDIA_SECRET: media[`MEDIA_${principal}_SECRET_KEY`],
        MEDIA_POLICY: name,
      },
    );
  }
  // Run on the already-authorized internal Docker network. Cassandra need not
  // expose a host port. Send secrets through stdin, never argv or diagnostics.
  const migration = await readFile(
    new URL("../../database/migrations/dev/085_media_vertical_slice.cql", import.meta.url),
    "utf8",
  );
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "ailss-learning-service",
      "node",
      "--input-type=module",
      "-e",
      `
    import {readFileSync} from "node:fs";
    import {Client} from "cassandra-driver";
    const input=JSON.parse(readFileSync(0,"utf8"));
    const db=new Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,credentials:{username:"cassandra_admin",password:input.adminPassword}});
    try {
      await db.execute("CREATE ROLE IF NOT EXISTS svc_media_worker WITH LOGIN=false AND SUPERUSER=false");
      await db.execute("ALTER ROLE svc_media_worker WITH LOGIN=true AND PASSWORD='"+input.workerPassword.replaceAll("'","''")+"'");
      for(const sql of input.sql)await db.execute(sql);
    }catch(error){console.error(error.name);process.exitCode=1;}finally{await db.shutdown();}
  `,
    ],
    {
      input: JSON.stringify({
        adminPassword: required(env, "CASSANDRA_ADMIN_PASSWORD"),
        workerPassword: media.CASSANDRA_SVC_MEDIA_WORKER_PASSWORD,
        sql: migration
          .replace(/^--.*$/gm, "")
          .split(";")
          .map((x) => x.trim())
          .filter(Boolean),
      }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  await writeFile(
    file,
    Object.entries(media)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  console.log(
    "MEDIA_LOCAL_INITIALIZATION PASS: private bucket; 3 scoped S3 principals; dedicated Cassandra worker role; migration 085. Local policy: 1 GiB/4 hours (not a production default). Credentials saved only in ignored .env.media.",
  );
} catch (error) {
  console.error(`MEDIA_LOCAL_INITIALIZATION FAIL: ${error.name} (credential-bearing diagnostics suppressed)`);
  process.exitCode = 1;
}
