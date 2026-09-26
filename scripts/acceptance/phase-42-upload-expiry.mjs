import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readEnv } from "../dev/env.mjs";
const fixture = await readEnv(new URL("../../.env.media-acceptance", import.meta.url));
const base = "http://127.0.0.1:8080/api/v1";
async function api(token, path, method = "GET", body, key, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Connection: "close",
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${path}: ${response.status} ${value.error?.code ?? ""}`);
  return expected >= 400 ? value.error : value.data;
}
const login = await fetch(base + "/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: fixture.PHASE42_LECTURER_EMAIL,
    password: fixture.PHASE42_LECTURER_PASSWORD,
  }),
});
assert.equal(login.status, 200);
const token = (await login.json()).data.accessToken;
const route = `/courses/${fixture.PHASE42_COURSE_ID}/media-assets`;
const created = await api(
  token,
  route,
  "POST",
  {
    lessonId: fixture.PHASE42_LESSON_ID,
    originalFilename: "expiry.mp4",
    mimeType: "video/mp4",
    sizeBytes: 1,
  },
  randomUUID(),
  201,
);
const id = created.asset.mediaAssetId;
const signed = await api(token, `/media-assets/${id}/parts`, "POST", { partNumber: 1 });
assert.equal((await fetch(signed.uploadUrl, { method: "PUT", body: new Uint8Array([1]) })).status, 200);
execFileSync("docker", ["stop", "ailss-media-worker"], { stdio: "pipe" });
function run(program) {
  return execFileSync(
    "docker",
    ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", program],
    { input: JSON.stringify({ id }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const common = `
import assert from "node:assert/strict"; import {readFileSync} from "node:fs";
import {CassandraClient} from "./dist/packages/cassandra/src/index.js";
import {loadConfig} from "./dist/packages/config/src/index.js";
import {mediaRuntime} from "./dist/apps/learning-service/src/media/config.js";
import {CassandraMediaRepository} from "./dist/apps/learning-service/src/media/repository.js";
import {CassandraQuotaStore,MediaQuota} from "./dist/apps/learning-service/src/media/quota.js";
const {id}=JSON.parse(readFileSync(0,"utf8")), config=loadConfig({...process.env,APP_NAME:"AILSS",SERVICE_ID:"media-expiry-acceptance"}), settings=mediaRuntime(config);
const db=await CassandraClient.create({contactPoints:config.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:config.CASSANDRA_LOCAL_DC,keyspace:"learning_keyspace",username:config.CASSANDRA_USERNAME,password:config.CASSANDRA_PASSWORD});
const repo=new CassandraMediaRepository(db),quotaStore=new CassandraQuotaStore(db),quota=new MediaQuota(quotaStore,settings.quotaLimits);
`;
try {
  const shortUrl = run(
    common +
      `try{
    const asset=await repo.get(config.PLATFORM_TENANT_ID,id);
    assert.equal((await settings.storage.parts(asset.originalObjectKey,asset.uploadId)).length,1);
    const expiresAt=new Date(Date.now()-1000).toISOString();
    assert.equal(await repo.replace(asset,{...asset,revision:asset.revision+1,uploadExpiresAt:expiresAt}),true);
    const ledger=await quotaStore.read(config.PLATFORM_TENANT_ID),next=structuredClone(ledger);
    next.reservations[id].expiresAt=expiresAt;next.revision++;
    assert.equal(await quotaStore.cas(config.PLATFORM_TENANT_ID,ledger,next),true);
    console.log(await settings.storage.partUrl(asset.originalObjectKey,asset.uploadId,1,1));
  }finally{await db.close();}`,
  );
  for (const [path, method, body] of [
    [`/media-assets/${id}/upload`, "GET"],
    [`/media-assets/${id}/complete`, "POST", {}],
    [`/media-assets/${id}/parts`, "POST", { partNumber: 1 }],
  ])
    assert.equal(
      (await api(token, path, method, body, undefined, 409)).code,
      "MEDIA_UPLOAD_EXPIRED_OR_CLOSED",
    );
  await new Promise((resolve) => setTimeout(resolve, 2200));
  assert.equal((await fetch(shortUrl, { method: "PUT", body: new Uint8Array([1]) })).status, 403);
  console.log(
    run(
      common +
        `import{cleanupExpiredUploads}from"./dist/apps/media-worker/src/cleanup.js";
    try{await cleanupExpiredUploads(config.PLATFORM_TENANT_ID,repo,settings.storage,quota,()=>{});
      const asset=await repo.get(config.PLATFORM_TENANT_ID,id);assert.equal(asset.status,"DELETED");
      await assert.rejects(settings.storage.parts(asset.originalObjectKey,asset.uploadId),{code:"NoSuchUpload"});
      const reservation=(await quotaStore.read(config.PLATFORM_TENANT_ID)).reservations[id];
      assert.equal(reservation.state,"RELEASED");assert.equal(reservation.reservedBytes,0);assert.equal(reservation.reservedDerivedBytes,0);
      console.log("PHASE42_UPLOAD_EXPIRY_PASS 9 checks; S3 multipart aborted and quota released");
    }finally{await db.close();}`,
    ),
  );
  const next = await api(
    token,
    route,
    "POST",
    {
      lessonId: fixture.PHASE42_LESSON_ID,
      originalFilename: "new-session.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1,
    },
    randomUUID(),
    201,
  );
  assert.notEqual(next.asset.mediaAssetId, id);
  await api(token, `/media-assets/${next.asset.mediaAssetId}/cancel`, "POST", {});
  console.log("PHASE42_NEW_SESSION_AFTER_EXPIRY_PASS");
} finally {
  execFileSync("docker", ["start", "ailss-media-worker"], { stdio: "pipe" });
}
