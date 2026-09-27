import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readEnv, required } from "../dev/env.mjs";

const env = await readEnv(),
  media = await readEnv(new URL("../../.env.media", import.meta.url));
const tenantId = randomUUID(),
  mediaAssetId = randomUUID(),
  lease = randomUUID();
const day = new Date().toISOString().slice(0, 10),
  shard = Number.parseInt(mediaAssetId.slice(0, 2), 16) % 4;
const prefix = `media-hls/${tenantId}/${mediaAssetId}/1/${lease}`;
const original = `media-original/${tenantId}/${mediaAssetId}/1/source`;
const fixture = {
  tenantId,
  mediaAssetId,
  lease,
  day,
  shard,
  prefix,
  original,
  output: `${prefix}/poster.jpg`,
};
const denyPolicy = `phase42-cleanup-deny-${mediaAssetId.slice(0, 8)}`;
function mc(args, input) {
  return execFileSync("docker", ["exec", "-i", "-e", "MC_HOST_local", "ailss-minio", "mc", ...args], {
    env: {
      ...process.env,
      MC_HOST_local: `http://${encodeURIComponent(required(env, "OBJECT_STORAGE_ACCESS_KEY"))}:${encodeURIComponent(required(env, "OBJECT_STORAGE_SECRET_KEY"))}@127.0.0.1:9000`,
    },
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
// Each invocation creates a new OS process and Cassandra/S3 adapter. No fake
// repository or mocked failure: an exact-object IAM Deny rejects DeleteObject.
function phase(container, stage) {
  const program = `
import assert from "node:assert/strict";import{readFileSync}from"node:fs";import{mkdtemp,writeFile,rm}from"node:fs/promises";import{tmpdir}from"node:os";import path from"node:path";
import{CassandraClient}from"./dist/packages/cassandra/src/index.js";
import{CassandraMediaRepository}from"./dist/apps/learning-service/src/media/repository.js";
import{CassandraOutputJournal,recoverOutputIntent}from"./dist/apps/media-worker/src/output-journal.js";
import{S3MediaStorage}from"./dist/packages/storage/src/media.js";
const i=JSON.parse(readFileSync(0,"utf8")),db=await CassandraClient.create({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:"learning_keyspace",username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD});
const storage=new S3MediaStorage(process.env.MEDIA_STORAGE_BUCKET,{endPoint:process.env.OBJECT_STORAGE_ENDPOINT,port:Number(process.env.OBJECT_STORAGE_PORT),useSSL:false,accessKey:process.env.MEDIA_STORAGE_ACCESS_KEY,secretKey:process.env.MEDIA_STORAGE_SECRET_KEY},process.env.OBJECT_STORAGE_PUBLIC_URL);
const repo=new CassandraMediaRepository(db),journal=new CassandraOutputJournal(db);
try {
  if(i.stage==="original") {
    const dir=await mkdtemp(path.join(tmpdir(),"phase42-original-"));
    try{await writeFile(path.join(dir,"source"),"retained original fixture");await storage.writeFile(i.original,path.join(dir,"source"),"application/octet-stream");}finally{await rm(dir,{recursive:true,force:true});}
  } else if(i.stage==="create") {
    const asset={tenantId:i.tenantId,mediaAssetId:i.mediaAssetId,courseId:i.mediaAssetId,lessonId:i.mediaAssetId,ownerUserId:i.mediaAssetId,mediaType:"VIDEO",originalFilename:"cleanup-fixture",mimeType:"video/mp4",originalObjectKey:i.original,sizeBytes:25,status:"FAILED",revision:1,processingVersion:1,fingerprint:"cleanup",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),uploadExpiresAt:new Date().toISOString(),captionTracks:[],audit:[]};
    assert.equal(await repo.insert(asset),true);
    await journal.begin(i,i.lease,i.prefix,[i.output]);
    const dir=await mkdtemp(path.join(tmpdir(),"phase42-output-"));
    try{await writeFile(path.join(dir,"poster"),"temporary derived output");await storage.writeFile(i.output,path.join(dir,"poster"),"image/jpeg");}finally{await rm(dir,{recursive:true,force:true});}
  } else {
    const events=[],intent=(await journal.page(i.tenantId,i.day,i.shard)).intents[0];
    assert.ok(intent);
    await recoverOutputIntent(intent,journal,repo,storage,event=>events.push(event));
    const next=(await journal.page(i.tenantId,i.day,i.shard)).intents[0];
    if(i.stage==="denied") {
      assert.equal(next.state,"PENDING");assert.equal(next.failures,1);
      assert.ok((await storage.stat(i.output)).size>0);assert.deepEqual(events,["derived_cleanup_failed"]);
    } else {
      assert.equal(intent.state,"PENDING");assert.equal(intent.failures,1);
      assert.equal(next.state,"CLEANED");assert.equal(next.failures,1);
      await assert.rejects(()=>storage.stat(i.output),e=>["NoSuchKey","NotFound"].includes(e.code));
      assert.ok((await storage.stat(i.original)).size>0);assert.deepEqual(events,["derived_cleanup_completed"]);
      console.log(JSON.stringify({asset:i.mediaAssetId,state:next.state,failures:next.failures,originalRetained:true}));
    }
  }
}finally{await db.close();}
`;
  return execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", program], {
    input: JSON.stringify({ ...fixture, stage }),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
let attached = false,
  policyCreated = false;
try {
  phase("ailss-learning-service", "original");
  phase("ailss-media-worker", "create");
  mc(
    ["admin", "policy", "create", "local", denyPolicy, "/dev/stdin"],
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Deny",
          Action: ["s3:DeleteObject"],
          Resource: [`arn:aws:s3:::${required(media, "MEDIA_STORAGE_BUCKET")}/${fixture.output}`],
        },
      ],
    }),
  );
  policyCreated = true;
  mc([
    "admin",
    "policy",
    "attach",
    "local",
    denyPolicy,
    "--user",
    required(media, "MEDIA_WORKER_ACCESS_KEY"),
  ]);
  attached = true;
  phase("ailss-media-worker", "denied");
  execFileSync("docker", ["restart", "ailss-media-worker"], { stdio: "pipe" });
  mc([
    "admin",
    "policy",
    "detach",
    "local",
    denyPolicy,
    "--user",
    required(media, "MEDIA_WORKER_ACCESS_KEY"),
  ]);
  attached = false;
  const recovered = JSON.parse(phase("ailss-media-worker", "recover"));
  assert.equal(recovered.state, "CLEANED");
  assert.equal(recovered.originalRetained, true);
  console.log(
    `PHASE42_DURABLE_OUTPUT_CLEANUP_PASS asset=${mediaAssetId} pendingFailures=1 restart=true resolved=CLEANED originalRetained=true`,
  );
} catch {
  console.error("PHASE42_DURABLE_OUTPUT_CLEANUP_FAIL (credential-bearing diagnostics suppressed)");
  process.exitCode = 1;
} finally {
  if (attached)
    mc([
      "admin",
      "policy",
      "detach",
      "local",
      denyPolicy,
      "--user",
      required(media, "MEDIA_WORKER_ACCESS_KEY"),
    ]);
  if (policyCreated) mc(["admin", "policy", "remove", "local", denyPolicy]);
}
