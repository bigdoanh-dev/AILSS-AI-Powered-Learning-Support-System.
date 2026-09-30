import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { readEnv, required } from "../dev/env.mjs";

const fixture = Object.fromEntries(
  (await readFile(new URL("../../.env.media-acceptance", import.meta.url), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
const base = "http://127.0.0.1:8080/api/v1";
const storageOutage = process.argv.includes("--storage-outage");
const readOutage = process.argv.includes("--original-read-outage");
assert.ok(
  [storageOutage, readOutage, process.argv.includes("--race")].filter(Boolean).length <= 1,
  "Run fault scenarios separately",
);
async function api(token, route, method = "GET", body, key, expected = 200) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Connection: "close",
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${route}: HTTP ${response.status} ${value.error?.code ?? ""}`);
  return value.data;
}
function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}
function rawAsset(id) {
  const program = `import{readFileSync}from"node:fs";import{Client,types}from"cassandra-driver";
    const i=JSON.parse(readFileSync(0,"utf8")),db=new Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,credentials:{username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD}});
    try{const r=(await db.execute("SELECT payload FROM media_asset_by_tenant_id WHERE tenant_id=? AND media_asset_id=?",[types.Uuid.fromString(i.tenantId),types.Uuid.fromString(i.id)],{prepare:true,consistency:types.consistencies.localQuorum})).rows[0];console.log(r.payload);}finally{await db.shutdown();}`;
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", program],
      {
        input: JSON.stringify({ tenantId: "00000000-0000-4000-8000-000000000001", id }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ),
  );
}

const login = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Connection: "close" },
  body: JSON.stringify({
    email: fixture.PHASE42_LECTURER_EMAIL,
    password: fixture.PHASE42_LECTURER_PASSWORD,
  }),
});
assert.equal(login.status, 200);
const token = (await login.json()).data.accessToken;
const source = fixture.PHASE42_SOURCE_FILE;
const size = (await stat(source)).size;
const hash = createHash("sha256");
for await (const chunk of createReadStream(source)) hash.update(chunk);
const sourceSha256 = hash.digest("hex");
const created = await api(
  token,
  `/courses/${fixture.PHASE42_COURSE_ID}/media-assets`,
  "POST",
  {
    lessonId: fixture.PHASE42_LESSON_ID,
    originalFilename: "recovery-source.mp4",
    mimeType: "video/mp4",
    sizeBytes: size,
    sourceSha256,
  },
  randomUUID(),
  201,
);
const id = created.asset.mediaAssetId;
const file = await open(source, "r");
try {
  for (let part = 1; part <= created.partCount; part++) {
    const start = (part - 1) * created.partSize;
    const bytes = Buffer.alloc(Math.min(created.partSize, size - start));
    await file.read(bytes, 0, bytes.length, start);
    const signed = await api(token, `/media-assets/${id}/parts`, "POST", { partNumber: part });
    const uploaded = await fetch(signed.uploadUrl, {
      method: "PUT",
      body: bytes,
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(uploaded.status, 200);
  }
} finally {
  await file.close();
}
let deniedRead = false,
  createdReadPolicy = false;
const readPolicy = `phase42-read-deny-${id.slice(0, 8)}`;
let localEnv, mediaEnv;
function readPolicyCommand(args, input) {
  return execFileSync("docker", ["exec", "-i", "-e", "MC_HOST_local", "ailss-minio", "mc", ...args], {
    env: {
      ...process.env,
      MC_HOST_local: `http://${encodeURIComponent(required(localEnv, "OBJECT_STORAGE_ACCESS_KEY"))}:${encodeURIComponent(required(localEnv, "OBJECT_STORAGE_SECRET_KEY"))}@127.0.0.1:9000`,
    },
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
try {
  if (readOutage) {
    // Stop the poll scheduler before completion. One real MediaProcessor.handle
    // invocation under the worker identity proves read failure without exhausting
    // all retries while host-side Docker/Cassandra probes are starting.
    docker("stop", "ailss-media-worker");
    localEnv = await readEnv();
    mediaEnv = await readEnv(new URL("../../.env.media", import.meta.url));
    const pending = rawAsset(id);
    readPolicyCommand(
      ["admin", "policy", "create", "local", readPolicy, "/dev/stdin"],
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Deny",
            Action: ["s3:GetObject"],
            Resource: [
              `arn:aws:s3:::${required(mediaEnv, "MEDIA_STORAGE_BUCKET")}/${pending.originalObjectKey}`,
            ],
          },
        ],
      }),
    );
    createdReadPolicy = true;
  }
  await api(token, `/media-assets/${id}/complete`, "POST", {}, undefined, 202);
  if (readOutage) {
    const program = `import assert from"node:assert/strict";import{Registry}from"prom-client";import{createInterface}from"node:readline";
import{loadConfig}from"./dist/packages/config/src/index.js";import{CassandraClient}from"./dist/packages/cassandra/src/index.js";
import{createMediaMetrics}from"./dist/packages/observability/src/media.js";import{mediaRuntime}from"./dist/apps/learning-service/src/media/config.js";
import{CassandraMediaRepository}from"./dist/apps/learning-service/src/media/repository.js";import{CassandraQuotaStore,MediaQuota}from"./dist/apps/learning-service/src/media/quota.js";
import{CassandraOutputJournal}from"./dist/apps/media-worker/src/output-journal.js";import{MediaProcessor}from"./dist/apps/media-worker/src/processor.js";
const config=loadConfig(),settings=mediaRuntime(config,false),db=await CassandraClient.create({contactPoints:config.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:config.CASSANDRA_LOCAL_DC,keyspace:"learning_keyspace",username:config.CASSANDRA_USERNAME,password:config.CASSANDRA_PASSWORD});
try{const repo=new CassandraMediaRepository(db),asset=await repo.get(config.PLATFORM_TENANT_ID,"${id}"),job=await repo.job(asset.tenantId,asset.jobDay,Number.parseInt(asset.mediaAssetId.slice(0,2),16)%4,asset.mediaAssetId);
assert.ok(job);const input=createInterface({input:process.stdin});
// A timing barrier only: all bytes/errors still come from the real S3 adapter.
const storage=new Proxy(settings.storage,{get(target,property){if(property==="readStream")return async key=>{
assert.equal(key,asset.originalObjectKey);const claimed=await repo.job(asset.tenantId,asset.jobDay,job.shard,asset.mediaAssetId);
assert.ok(claimed.lease&&claimed.leaseUntil.getTime()>Date.now());
const acknowledgment=new Promise((resolve,reject)=>{input.once("line",line=>line==="DENIED"?resolve():reject(Error("INVALID_FAULT_ACK")));setTimeout(()=>reject(Error("FAULT_BARRIER_TIMEOUT")),15000).unref();});
console.log("CLAIMED_READ_BARRIER");await acknowledgment;return target.readStream(key);
};const value=Reflect.get(target,property,target);return typeof value==="function"?value.bind(target):value;}});
try{await new MediaProcessor(repo,storage,settings.policy,createMediaMetrics(new Registry()),new MediaQuota(new CassandraQuotaStore(db),settings.quotaLimits),new CassandraOutputJournal(db)).handle(job);}finally{input.close();}
const failed=await repo.get(asset.tenantId,asset.mediaAssetId),retry=await repo.job(asset.tenantId,asset.jobDay,job.shard,asset.mediaAssetId);
assert.equal(failed.status,"FAILED");assert.equal(retry.attempts,1);assert.equal(retry.lease,null);assert.equal(failed.originalObjectKey,asset.originalObjectKey);assert.equal(failed.sourceSha256,asset.sourceSha256);
console.log("ORIGINAL_READ_FAILURE_PERSISTED jobRetryable=true attempts=1 originalMetadataUnchanged=true");
}finally{await db.close();}`;
    const args = [
      "compose",
      "--env-file",
      ".env",
      "--env-file",
      ".env.media",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.async.yml",
      "-f",
      "docker-compose.media.yml",
      "--profile",
      "dev-async",
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "-e",
      "APP_NAME=AILSS",
      "-e",
      "SERVICE_ID=media-original-read-acceptance",
      "media-worker",
      "--input-type=module",
      "-e",
      program,
    ];
    const output = await new Promise((resolve, reject) => {
      const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "",
        signaled = false;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(Error("READ_FAULT_PROCESS_TIMEOUT"));
      }, 60_000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (!signaled && stdout.includes("CLAIMED_READ_BARRIER")) {
          signaled = true;
          try {
            // Activate IAM Deny only after the processor durably owns the job.
            readPolicyCommand([
              "admin",
              "policy",
              "attach",
              "local",
              readPolicy,
              "--user",
              required(mediaEnv, "MEDIA_WORKER_ACCESS_KEY"),
            ]);
            deniedRead = true;
            child.stdin.end("DENIED\n");
          } catch {
            child.kill("SIGTERM");
            reject(Error("READ_FAULT_POLICY_FAILED"));
          }
        }
      });
      child.stderr.on("data", () => {
        /* credential-bearing SDK diagnostics are not emitted */
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && signaled) resolve(stdout.trim());
        else reject(Error("READ_FAULT_PROCESS_FAILED"));
      });
    });
    console.log(output);
  }
  const processingDeadline = Date.now() + 60_000;
  let asset;
  while (Date.now() < processingDeadline) {
    asset = rawAsset(id);
    if (asset.status === (readOutage ? "FAILED" : "PROCESSING")) break;
    assert.notEqual(asset.status, "READY", "Fault must occur before READY");
    await new Promise((resolve) => setTimeout(resolve, readOutage ? 100 : 500));
  }
  assert.equal(
    asset?.status,
    readOutage ? "FAILED" : "PROCESSING",
    "Worker must reach the targeted failure point",
  );
  if (readOutage) {
    assert.ok(asset.audit.some((entry) => entry.from === "VERIFYING" && entry.to === "FAILED"));
    assert.equal(
      asset.audit.some((entry) => entry.to === "PROCESSING"),
      false,
    );
    assert.equal(
      asset.audit.some((entry) => entry.to === "READY"),
      false,
    );
  }
  const oldLease = asset.processingLease;
  assert.match(oldLease, /^[0-9a-f-]{36}$/);
  const oldPid = Number(docker("inspect", "ailss-media-worker", "--format", "{{.State.Pid}}"));
  if (readOutage) {
    docker("stop", "ailss-media-worker");
    readPolicyCommand([
      "admin",
      "policy",
      "detach",
      "local",
      readPolicy,
      "--user",
      required(mediaEnv, "MEDIA_WORKER_ACCESS_KEY"),
    ]);
    deniedRead = false;
    docker("start", "ailss-media-worker");
    console.log(
      `ORIGINAL_READ_DENIED_THEN_RESTORED asset=${id} from=VERIFYING to=FAILED; retrying durable job`,
    );
  } else if (storageOutage) {
    docker("stop", "ailss-minio");
    console.log(`STORAGE_STOPPED_DURING_PROCESSING asset=${id}; waiting for truthful failure`);
  } else {
    docker("kill", "ailss-media-worker");
    console.log(`WORKER_KILLED asset=${id}; waiting for lease takeover`);
  }
  const raceName = process.argv.includes("--race") ? `ailss-media-race-${id.slice(0, 8)}` : undefined;
  try {
    if (storageOutage) {
      const failureDeadline = Date.now() + 150_000;
      while (Date.now() < failureDeadline) {
        asset = rawAsset(id);
        assert.notEqual(asset.status, "READY", "Storage outage must never produce false READY");
        if (asset.status === "FAILED") break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.equal(asset.status, "FAILED", "Object write outage must persist failure metadata");
      assert.equal(asset.failureCode, "MEDIA_PROCESSING_FAILED");
      docker("stop", "ailss-media-worker");
      docker("start", "ailss-minio");
      const healthDeadline = Date.now() + 30000;
      while (Date.now() < healthDeadline) {
        try {
          if ((await fetch("http://127.0.0.1:9000/minio/health/ready")).ok) break;
        } catch {
          /* still starting */
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      docker("start", "ailss-media-worker");
      console.log("STORAGE_RESTORED; retrying durable failed job");
    }
    if (raceName) {
      docker(
        "compose",
        "--env-file",
        ".env",
        "--env-file",
        ".env.media",
        "-f",
        "docker-compose.yml",
        "-f",
        "docker-compose.async.yml",
        "-f",
        "docker-compose.media.yml",
        "--profile",
        "dev-async",
        "run",
        "-d",
        "--no-deps",
        "--name",
        raceName,
        "media-worker",
      );
      console.log("SECOND_WORKER_STARTED for lease-expiry race");
    }
    const recoveryDeadline = Date.now() + 240_000;
    while (Date.now() < recoveryDeadline) {
      const running = docker("inspect", "ailss-media-worker", "--format", "{{.State.Running}}");
      if (running !== "true") docker("start", "ailss-media-worker");
      asset = rawAsset(id);
      if (asset.status === "READY") break;
      if (asset.status === "QUARANTINED" || (!storageOutage && !readOutage && asset.status === "FAILED"))
        throw Error(`WORKER_RECOVERY_FAILED status=${asset.status} code=${asset.failureCode}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    assert.equal(asset?.status, "READY", "Replacement worker must reach READY after lease expiry");
    assert.notEqual(asset.processingLease, oldLease, "New worker must own a new lease");
    assert.equal(asset.audit.filter((event) => event.to === "READY").length, 1);
    assert.equal(
      asset.sourceSha256,
      sourceSha256,
      "Recovered original must match the actual uploaded checksum",
    );
    assert.ok(asset.masterPlaylistObjectKey.includes(`/${asset.processingLease}/`));
    if (!storageOutage && !readOutage)
      assert.notEqual(Number(docker("inspect", "ailss-media-worker", "--format", "{{.State.Pid}}")), oldPid);
    const current = await api(token, `/media-assets/${id}`);
    assert.equal(current.status, "READY");
    if (raceName) {
      for (const name of ["ailss-media-worker", raceName])
        assert.ok(docker("logs", name).includes(id), `${name} must observe the same job`);
      console.log(
        "PHASE42_TWO_WORKER_OBSERVATION_PASS two live workers observed same expired job; one READY transition",
      );
    }
    console.log(
      `${readOutage ? "PHASE42_ORIGINAL_READ_RECOVERY_PASS" : storageOutage ? "PHASE42_STORAGE_RECOVERY_PASS" : "PHASE42_WORKER_RECOVERY_PASS"} asset=${id} status=READY readyTransitions=1 sourceSha256=${asset.sourceSha256}`,
    );
  } finally {
    if (storageOutage) {
      docker("start", "ailss-minio");
      docker("start", "ailss-media-worker");
    }
    if (raceName) {
      docker("stop", raceName);
      docker("rm", raceName);
    }
  }
} finally {
  if (deniedRead)
    readPolicyCommand([
      "admin",
      "policy",
      "detach",
      "local",
      readPolicy,
      "--user",
      required(mediaEnv, "MEDIA_WORKER_ACCESS_KEY"),
    ]);
  if (createdReadPolicy) {
    readPolicyCommand(["admin", "policy", "remove", "local", readPolicy]);
    docker("start", "ailss-media-worker");
  }
}
