import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";

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
const transcodeFailure = process.argv.includes("--transcode-failure");
let workerPaused = false;
let heldRetry;
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
async function login(email, password) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200);
  return (await response.json()).data.accessToken;
}
function binding(lessonId) {
  const program = `import{readFileSync}from"node:fs";import{Client,types}from"cassandra-driver";
    const i=JSON.parse(readFileSync(0,"utf8")),db=new Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,credentials:{username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD}});
    try{const r=(await db.execute("SELECT media_asset_id,replacement_history FROM media_asset_by_lesson WHERE tenant_id=? AND lesson_id=?",[types.Uuid.fromString(i.tenantId),types.Uuid.fromString(i.lessonId)],{prepare:true,consistency:types.consistencies.localQuorum})).rows[0];console.log(JSON.stringify({id:String(r.media_asset_id),history:r.replacement_history?JSON.parse(r.replacement_history):[]}));}finally{await db.shutdown();}`;
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", program],
      {
        input: JSON.stringify({ tenantId: "00000000-0000-4000-8000-000000000001", lessonId }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ),
  );
}
async function uploadVersion(token, body, source, key) {
  const created = await api(
    token,
    `/courses/${fixture.PHASE42_COURSE_ID}/media-assets`,
    "POST",
    body,
    key,
    201,
  );
  const id = created.asset.mediaAssetId;
  const handle = await open(source, "r");
  try {
    for (let part = 1; part <= created.partCount; part++) {
      const start = (part - 1) * created.partSize;
      const bytes = Buffer.alloc(Math.min(created.partSize, body.sizeBytes - start));
      await handle.read(bytes, 0, bytes.length, start);
      const signed = await api(token, `/media-assets/${id}/parts`, "POST", { partNumber: part });
      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        body: bytes,
        signal: AbortSignal.timeout(60_000),
      });
      assert.equal(put.status, 200, `part ${part}`);
    }
  } finally {
    await handle.close();
  }
  await api(token, `/media-assets/${id}/complete`, "POST", {}, undefined, 202);
  const deadline = Date.now() + 240_000;
  let killed = false;
  while (Date.now() < deadline) {
    const asset = await api(token, `/media-assets/${id}`);
    if (transcodeFailure && !killed && asset.status === "PROCESSING") {
      // The local worker is sequential. Kill only its unique HLS FFmpeg child,
      // not the service, and only after the target asset passed source validation.
      const program = `import{readdir,readFile}from"node:fs/promises";import{randomUUID}from"node:crypto";
import{CassandraClient}from"./dist/packages/cassandra/src/index.js";import{CassandraMediaRepository}from"./dist/apps/learning-service/src/media/repository.js";
const matches=[];for(const pid of await readdir("/proc")){if(!/^\\d+$/.test(pid))continue;try{const args=(await readFile("/proc/"+pid+"/cmdline","utf8")).split("\\0");if(args[0]==="ffmpeg"&&args.includes("-hls_segment_filename"))matches.push(Number(pid));}catch{}}
if(matches.length!==1)process.exitCode=2;else{
const db=await CassandraClient.create({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:"learning_keyspace",username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD}),repo=new CassandraMediaRepository(db);
try{process.kill(matches[0],"SIGKILL");const deadline=Date.now()+15000;
while(Date.now()<deadline){const asset=await repo.get("00000000-0000-4000-8000-000000000001","${id}"),history=await repo.replacementHistory(asset.tenantId,asset.lessonId);
if(asset.status==="FAILED"&&history.some(e=>e.status==="FAILED"&&e.replacementMediaAssetId==="${id}")){
const day=asset.jobDay,shard=Number.parseInt(asset.mediaAssetId.slice(0,2),16)%4,job=await repo.job(asset.tenantId,day,shard,asset.mediaAssetId),lease=randomUUID();
if(job&&await repo.claim(job,lease,new Date(Date.now()+120000))){console.log(JSON.stringify({pid:matches[0],asset:asset.mediaAssetId,tenantId:asset.tenantId,day,shard,lease}));break;}}
await new Promise(r=>setTimeout(r,25));}
if(Date.now()>=deadline)throw Error("FAILED_AUDIT_TIMEOUT");
}finally{await db.close();}}`;
      try {
        heldRetry = JSON.parse(
          execFileSync(
            "docker",
            ["exec", "ailss-media-worker", "node", "--input-type=module", "-e", program],
            { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
          ).trim(),
        );
        console.log(`HLS_FFMPEG_KILLED ${heldRetry.pid} FAILED_AND_AUDITED; retry held by Cassandra lease`);
        killed = true;
      } catch {
        /* wait for the target HLS child to spawn */
      }
    }
    if (["READY", "FAILED", "QUARANTINED"].includes(asset.status)) {
      if (transcodeFailure) {
        assert.equal(killed, true, "Must inject a real FFmpeg processing failure");
        assert.equal(asset.status, "FAILED", "Not QUARANTINED validation rejection");
        const auditDeadline = Date.now() + 10_000;
        while (
          !binding(fixture.PHASE42_LESSON_ID).history.some(
            (event) => event.status === "FAILED" && event.replacementMediaAssetId === id,
          )
        ) {
          assert.ok(Date.now() < auditDeadline, "Failure audit must be durable before proof");
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        execFileSync("docker", ["pause", "ailss-media-worker"], { stdio: "pipe" });
        workerPaused = true;
        assert.equal((await api(token, `/media-assets/${id}`)).status, "FAILED");
      }
      return asset;
    }
    await new Promise((resolve) => setTimeout(resolve, transcodeFailure ? 100 : 1000));
  }
  throw Error("MEDIA_REPLACEMENT_PROCESSING_TIMEOUT");
}

const lecturer = await login(fixture.PHASE42_LECTURER_EMAIL, fixture.PHASE42_LECTURER_PASSWORD);
const student = await login(fixture.PHASE42_STUDENT_EMAIL, fixture.PHASE42_STUDENT_PASSWORD);
const first = await api(student, `/lessons/${fixture.PHASE42_LESSON_ID}/media-session`, "POST", {});
const size = (await stat(fixture.PHASE42_SOURCE_FILE)).size;
const hash = createHash("sha256");
for await (const chunk of createReadStream(fixture.PHASE42_SOURCE_FILE)) hash.update(chunk);
const body = {
  lessonId: fixture.PHASE42_LESSON_ID,
  originalFilename: "source.mp4",
  mimeType: "video/mp4",
  sizeBytes: size,
  sourceSha256: hash.digest("hex"),
};
try {
  if (transcodeFailure) {
    const failed = await uploadVersion(lecturer, body, fixture.PHASE42_SOURCE_FILE, randomUUID());
    assert.equal(failed.status, "FAILED");
    const current = binding(fixture.PHASE42_LESSON_ID);
    assert.equal(current.id, first.mediaAssetId);
    const event = current.history.find(
      (entry) => entry.status === "FAILED" && entry.replacementMediaAssetId === failed.mediaAssetId,
    );
    assert.equal(event.previousMediaAssetId, first.mediaAssetId);
    assert.equal(event.failureCode, "MEDIA_PROCESSING_FAILED");
    assert.equal(event.recordedBy, "media-worker");
    assert.match(event.changedBy, /^[0-9a-f-]{36}$/);
    const session = await api(student, `/lessons/${fixture.PHASE42_LESSON_ID}/media-session`, "POST", {});
    assert.equal(session.mediaAssetId, first.mediaAssetId);
    const masterResponse = await fetch(session.playlistUrl, {
      headers: { Connection: "close" },
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(masterResponse.status, 200);
    const variant = (await masterResponse.text()).split("\n").find((line) => line && !line.startsWith("#"));
    assert.ok(variant);
    const variantUrl = new URL(variant, session.playlistUrl);
    const variantResponse = await fetch(variantUrl, {
      headers: { Connection: "close" },
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(variantResponse.status, 200);
    const segment = (await variantResponse.text()).split("\n").find((line) => line && !line.startsWith("#"));
    assert.ok(segment);
    const segmentResponse = await fetch(new URL(segment, variantUrl), {
      headers: { Connection: "close" },
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(segmentResponse.status, 200);
    assert.ok((await segmentResponse.arrayBuffer()).byteLength > 0);
    console.log(
      `PHASE42_FAILED_REPLACEMENT_PASS failed=${failed.mediaAssetId} retained=${first.mediaAssetId} status=FAILED audit=FAILED playlist=200 variant=200 segment=200`,
    );
  } else {
    const second = await uploadVersion(lecturer, body, fixture.PHASE42_SOURCE_FILE, randomUUID());
    assert.equal(second.status, "READY");
    assert.equal(
      (await api(student, `/lessons/${fixture.PHASE42_LESSON_ID}/media-session`, "POST", {})).mediaAssetId,
      first.mediaAssetId,
      "V1 must remain active until explicit attach",
    );
    await api(lecturer, `/media-assets/${second.mediaAssetId}/attach`, "POST", {});
    assert.equal(
      (await api(student, `/lessons/${fixture.PHASE42_LESSON_ID}/media-session`, "POST", {})).mediaAssetId,
      second.mediaAssetId,
      "New playback sessions must resolve V2",
    );
    const applied = binding(fixture.PHASE42_LESSON_ID);
    assert.equal(applied.id, second.mediaAssetId);
    const event = applied.history.at(-1);
    assert.equal(event.previousMediaAssetId, first.mediaAssetId);
    assert.equal(event.replacementMediaAssetId, second.mediaAssetId);
    assert.equal(event.lessonId, fixture.PHASE42_LESSON_ID);
    assert.equal(event.status, "APPLIED");
    assert.match(event.changedBy, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(event.changedAt)));
    const rejected = await uploadVersion(
      lecturer,
      { ...body, sourceSha256: "0".repeat(64) },
      fixture.PHASE42_SOURCE_FILE,
      randomUUID(),
    );
    assert.equal(rejected.status, "QUARANTINED", "Checksum validation must reject V3");
    assert.equal(binding(fixture.PHASE42_LESSON_ID).id, second.mediaAssetId);
    assert.equal(
      (await api(student, `/lessons/${fixture.PHASE42_LESSON_ID}/media-session`, "POST", {})).mediaAssetId,
      second.mediaAssetId,
    );
    console.log("PHASE42_REPLACEMENT_PASS 6 checks; V3 rejection is QUARANTINED, not FAILED");
  }
} finally {
  if (heldRetry) {
    const program = `import{CassandraClient}from"./dist/packages/cassandra/src/index.js";import{CassandraMediaRepository}from"./dist/apps/learning-service/src/media/repository.js";import{readFileSync}from"node:fs";
const i=JSON.parse(readFileSync(0,"utf8")),db=await CassandraClient.create({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:"learning_keyspace",username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD});
try{const repo=new CassandraMediaRepository(db),job=await repo.job(i.tenantId,i.day,i.shard,i.asset);if(job)await repo.release(job,i.lease,false);}finally{await db.close();}`;
    execFileSync(
      "docker",
      ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", program],
      { input: JSON.stringify(heldRetry), stdio: ["pipe", "pipe", "pipe"] },
    );
  }
  if (workerPaused) execFileSync("docker", ["unpause", "ailss-media-worker"], { stdio: "pipe" });
}
