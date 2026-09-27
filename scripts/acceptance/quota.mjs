import { execFileSync } from "node:child_process";
const program = `
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CassandraClient } from "./dist/packages/cassandra/src/index.js";
import { CassandraQuotaStore, MediaQuota, quotaUsage } from "./dist/apps/learning-service/src/media/quota.js";
const db=await CassandraClient.create({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:"learning_keyspace",username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD});
const tenantId=randomUUID(), courseId=randomUUID(), store=new CassandraQuotaStore(db);
const limits={tenantOriginalBytes:100,tenantDerivedBytes:100,courseOriginalBytes:100,courseDerivedBytes:100,tenantAssets:10,courseAssets:10};
const quota=new MediaQuota(store,limits), other=new MediaQuota(new CassandraQuotaStore(db),limits);
const asset=()=>({mediaAssetId:randomUUID(),tenantId,courseId,sizeBytes:60,uploadExpiresAt:new Date(Date.now()+60000).toISOString()});
try {
  await assert.rejects(quota.reserve(asset(),40),{code:"MEDIA_QUOTA_BACKFILL_REQUIRED"});
  await quota.initialize(tenantId,[]);
  const a=asset(), b=asset(), result=await Promise.allSettled([quota.reserve(a,40),other.reserve(b,40)]);
  assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(result.filter(r=>r.status==="rejected"&&r.reason.code==="MEDIA_QUOTA_EXCEEDED").length,1);
  const winner=result[0].status==="fulfilled"?a:b;
  const reserved=await store.read(tenantId); assert.equal(quotaUsage(reserved).reservedOriginalBytes,60);
  await other.reserve(winner,40); assert.equal((await store.read(tenantId)).revision,reserved.revision);
  await other.originalStored(winner); await quota.derivedStored(winner,20);
  assert.deepEqual(quotaUsage(await new CassandraQuotaStore(db).read(tenantId)),{originalBytes:60,derivedBytes:20,reservedOriginalBytes:0,reservedDerivedBytes:0,assetCount:1});
  await quota.release(winner); assert.equal(quotaUsage(await store.read(tenantId)).originalBytes,60);
  await assert.rejects(other.reserve({...asset(),sizeBytes:50},1),{code:"MEDIA_QUOTA_EXCEEDED"});
  const cancel={...asset(),sizeBytes:30}; await other.reserve(cancel,1); await quota.release(cancel);
  assert.equal(quotaUsage(await store.read(tenantId)).reservedOriginalBytes,0);
  await assert.rejects(quota.reserve(cancel,1),{code:"MEDIA_RESERVATION_CLOSED"});
  console.log("PHASE42_QUOTA_CASSANDRA_PASS 10 checks; concurrent 60+60 against 100: exactly one accepted; durable accounting and replay verified");
} finally { await db.close(); }
`;
try {
  console.log(
    execFileSync("docker", ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", program], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim(),
  );
} catch {
  console.error("PHASE42_QUOTA_CASSANDRA_FAIL (credential-bearing diagnostics suppressed)");
  process.exitCode = 1;
}
