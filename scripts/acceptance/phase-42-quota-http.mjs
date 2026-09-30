import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readEnv, required } from "../dev/env.mjs";

const fixture = await readEnv(new URL("../../.env.media-acceptance", import.meta.url));
const env = await readEnv();
const tenantId = randomUUID(),
  suffix = tenantId.slice(0, 8);
const learningName = `ailss-quota-learning-${suffix}`,
  gatewayName = `ailss-quota-gateway-${suffix}`;
const limits = {
  tenantOriginalBytes: 100,
  courseOriginalBytes: 100,
  tenantDerivedBytes: 1_099_511_627_776,
  courseDerivedBytes: 1_099_511_627_776,
  tenantAssets: 10,
  courseAssets: 10,
};
const compose = [
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
];
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
async function api(base, token, route, body, key, expected = 200) {
  const response = await fetch(base + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  if (expected !== null)
    assert.equal(response.status, expected, `${route}: ${response.status} ${value.error?.code ?? ""}`);
  return { status: response.status, value };
}
function dbCheck(stage, requests = [], userId) {
  const program = `import assert from"node:assert/strict";import{readFileSync}from"node:fs";import{Client}from"minio";
import{CassandraClient}from"./dist/packages/cassandra/src/index.js";import{CassandraQuotaStore,MediaQuota,quotaUsage}from"./dist/apps/learning-service/src/media/quota.js";
import{CassandraMediaRepository}from"./dist/apps/learning-service/src/media/repository.js";import{mediaId}from"./dist/apps/learning-service/src/media/model.js";
const i=JSON.parse(readFileSync(0,"utf8")),db=await CassandraClient.create({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:"learning_keyspace",username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD});
try{
const store=new CassandraQuotaStore(db),repo=new CassandraMediaRepository(db);
if(i.stage==="initialize"){await new MediaQuota(store,i.limits).initialize(i.tenantId,[]);console.log("INITIALIZED");}
else{
const ledger=await store.read(i.tenantId),usage=quotaUsage(ledger),active=Object.values(ledger.reservations).filter(row=>row.state==="RESERVED");
if(i.stage==="afterCancel"){assert.equal(usage.reservedOriginalBytes,0);assert.equal(active.length,0);console.log("CANCELLED");}
else{
console.log("INSPECT_USAGE active="+active.length+" reserved="+usage.reservedOriginalBytes);
assert.equal(active.length,1);assert.equal(usage.reservedOriginalBytes,60);assert.ok(usage.reservedOriginalBytes<=i.limits.tenantOriginalBytes);
const s3=new Client({endPoint:process.env.OBJECT_STORAGE_ENDPOINT,port:Number(process.env.OBJECT_STORAGE_PORT),useSSL:false,accessKey:i.storageUser,secretKey:i.storageSecret});
for(const request of i.requests){
 const id=mediaId(process.env.MEDIA_PLAYBACK_SECRET,i.tenantId+":"+i.userId+":"+request.courseId+":"+request.key);
 const asset=await repo.get(i.tenantId,id),prefix="media-original/"+i.tenantId+"/"+id+"/";
 const uploads=[];for await(const upload of s3.listIncompleteUploads(process.env.MEDIA_STORAGE_BUCKET,prefix,true))uploads.push(upload);
 console.log("INSPECT_REQUEST winner="+request.winner+" asset="+Boolean(asset)+" multipart="+uploads.length);
 if(request.winner){assert.equal(asset.mediaAssetId,id);assert.equal(asset.status,"UPLOADING");assert.equal(active[0].mediaAssetId,id);
 // MinIO may omit an empty MPU from ListMultipartUploads. Its exact upload ID
 // must still resolve through the authoritative ListParts API (not NoSuchUpload).
 assert.deepEqual(await s3.listParts(process.env.MEDIA_STORAGE_BUCKET,asset.originalObjectKey,asset.uploadId),[]);
 assert.ok(uploads.every(upload=>upload.key===asset.originalObjectKey));}
 else{assert.equal(asset,undefined);assert.equal(await repo.binding(i.tenantId,request.lessonId),undefined);assert.equal(uploads.length,0);}
}
console.log(JSON.stringify({tenantId:i.tenantId,activeReservations:active.length,reservedOriginalBytes:usage.reservedOriginalBytes,loserAsset:false,loserMultipart:false}));
}
}
}catch(error){console.log("INSPECT_ERROR name="+error.name+" code="+(error.code??"none"));throw Error("INSPECTION_FAILED");}finally{await db.close();}`;
  try {
    return execFileSync(
      "docker",
      ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", program],
      {
        input: JSON.stringify({
          stage,
          tenantId,
          limits,
          requests,
          userId,
          storageUser: required(env, "OBJECT_STORAGE_ACCESS_KEY"),
          storageSecret: required(env, "OBJECT_STORAGE_SECRET_KEY"),
        }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
      .trim()
      .split("\n")
      .at(-1);
  } catch (error) {
    // Only the program's bounded diagnostic lines, never SDK stderr or args.
    for (const line of String(error.stdout ?? "").split("\n"))
      if (line.startsWith("INSPECT_")) console.error(line);
    throw Error("DURABLE_INSPECTION_FAILED");
  }
}
const started = [];
let base, token, winner;
let step = "login";
try {
  const primary = "http://127.0.0.1:8080/api/v1";
  const login = await api(primary, undefined, "/auth/login", {
    email: required(fixture, "PHASE42_LECTURER_EMAIL"),
    password: required(fixture, "PHASE42_LECTURER_PASSWORD"),
  });
  token = login.value.data.accessToken;
  const userId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
  assert.match(userId, /^[0-9a-f-]{36}$/);
  // Separate real courses avoid mistaking a course-write lock conflict for quota rejection.
  const requests = [];
  step = "course-fixtures";
  for (let index = 0; index < 2; index++) {
    const course = (
      await api(
        primary,
        token,
        "/courses",
        {
          title: `Quota HTTP race ${suffix} ${index}`,
          slug: `quota-http-${randomUUID()}`,
          categoryId: randomUUID(),
          priceType: "FREE",
          price: "0",
          currency: "VND",
        },
        randomUUID(),
        201,
      )
    ).value.data;
    const lesson = (
      await api(
        primary,
        token,
        `/courses/${course.courseId}/lessons`,
        {
          title: "Quota reservation fixture",
          sectionTitle: "Quota race",
          position: { sectionOrder: 1, lessonOrder: 1 },
          preview: false,
        },
        randomUUID(),
        201,
      )
    ).value.data;
    requests.push({ courseId: course.courseId, lessonId: lesson.lessonId, key: randomUUID() });
  }
  step = "quota-initialize";
  dbCheck("initialize");
  step = "isolated-learning";
  docker(
    ...compose,
    "run",
    "-d",
    "--no-deps",
    "--name",
    learningName,
    "-e",
    `PLATFORM_TENANT_ID=${tenantId}`,
    "-e",
    `MEDIA_QUOTA_LIMITS=${JSON.stringify(limits)}`,
    "learning-service",
  );
  started.push(learningName);
  step = "isolated-gateway";
  docker(
    ...compose,
    "run",
    "-d",
    "--no-deps",
    "--name",
    gatewayName,
    "--publish",
    "127.0.0.1::8080",
    "-e",
    `LEARNING_SERVICE_URL=http://${learningName}:8102`,
    "-e",
    `PLATFORM_TENANT_ID=${tenantId}`,
    "api-gateway",
  );
  started.push(gatewayName);
  const published = docker("port", gatewayName, "8080/tcp");
  assert.match(published, /^127\.0\.0\.1:\d+$/);
  base = `http://${published}/api/v1`;
  step = "readiness";
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      docker(
        "exec",
        learningName,
        "node",
        "-e",
        'fetch("http://127.0.0.1:8102/health/ready").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))',
      );
      const response = await fetch(`http://${published}/health/ready`, {
        signal: AbortSignal.timeout(3000),
        headers: { Connection: "close" },
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting isolated services */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(ready, true, "Isolated real Gateway/Learning must become ready");
  step = "http-race";
  const results = await Promise.all(
    requests.map((request) =>
      api(
        base,
        token,
        `/courses/${request.courseId}/media-assets`,
        { lessonId: request.lessonId, originalFilename: "quota.mp4", mimeType: "video/mp4", sizeBytes: 60 },
        request.key,
        null,
      ),
    ),
  );
  console.log(
    "HTTP_RACE_RESULTS " +
      JSON.stringify(
        results.map((result) => ({ status: result.status, code: result.value.error?.code ?? "NONE" })),
      ),
  );
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.value.error?.code === "MEDIA_QUOTA_EXCEEDED").length, 1);
  for (let index = 0; index < requests.length; index++)
    requests[index].winner = results[index].status === 201;
  winner = results.find((result) => result.status === 201).value.data.asset.mediaAssetId;
  step = "durable-inspection";
  const proof = JSON.parse(dbCheck("inspect", requests, userId));
  assert.equal(proof.activeReservations, 1);
  assert.equal(proof.reservedOriginalBytes, 60);
  step = "cancel";
  await api(base, token, `/media-assets/${winner}/cancel`, {});
  winner = undefined;
  dbCheck("afterCancel");
  console.log(
    `PHASE42_QUOTA_HTTP_RACE_PASS tenant=${tenantId} requests=2 accepted=1 rejected=1 originalLimit=100 reserved=60 loserAsset=false loserMultipart=false cancelled=true`,
  );
} catch (error) {
  const reason = error instanceof assert.AssertionError ? error.message : error.name;
  console.error(
    `PHASE42_QUOTA_HTTP_RACE_FAIL stage=${step} reason=${reason} (child-process diagnostics suppressed)`,
  );
  process.exitCode = 1;
} finally {
  if (winner) await api(base, token, `/media-assets/${winner}/cancel`, {}).catch(() => undefined);
  for (const name of started.reverse()) {
    docker("stop", name);
    docker("rm", name);
  }
}
