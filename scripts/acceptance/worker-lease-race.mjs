import { execFileSync } from "node:child_process";
const program = `
import assert from "node:assert/strict";import{randomUUID}from"node:crypto";
import{CassandraClient}from"./dist/packages/cassandra/src/index.js";
import{CassandraMediaRepository}from"./dist/apps/learning-service/src/media/repository.js";
const db=await CassandraClient.create({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:"learning_keyspace",username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD});
try{
  const repo=new CassandraMediaRepository(db),other=new CassandraMediaRepository(db);
  const tenantId=randomUUID(),mediaAssetId=randomUUID(),day=new Date().toISOString().slice(0,10),shard=Number.parseInt(mediaAssetId.slice(0,2),16)%4;
  await repo.enqueue({tenantId,mediaAssetId,updatedAt:new Date().toISOString()});
  const initial=(await repo.jobs(tenantId,day,shard))[0],oldLease=randomUUID();
  if(!await repo.claim(initial,oldLease,new Date(Date.now()-1000)))throw Error("LEASE_FIXTURE_FAILED");
  const expired=(await repo.jobs(tenantId,day,shard))[0],first=randomUUID(),second=randomUUID();
  const outcomes=await Promise.all([repo.claim(expired,first,new Date(Date.now()+60000)),other.claim(expired,second,new Date(Date.now()+60000))]);
  assert.equal(outcomes.filter(Boolean).length,1);
  const lease=outcomes[0]?first:second,active=(await repo.jobs(tenantId,day,shard))[0];
  assert.equal(active.lease,lease);
  assert.equal(await repo.renew(active,lease,active.revision,new Date(Date.now()+120000)),true);
  assert.equal(await other.claim(expired,randomUUID(),new Date(Date.now()+60000)),false);
  assert.equal(await other.renew(active,oldLease,active.revision,new Date(Date.now()+60000)),false);
  await other.release(active,oldLease,true);assert.equal((await repo.jobs(tenantId,day,shard)).length,1);
  await repo.release(active,lease,true);assert.equal((await repo.jobs(tenantId,day,shard)).length,0);
  console.log("PHASE42_LEASE_CASSANDRA_RACE_PASS 7 checks; one expiry claimant; heartbeat rejects stale snapshot and stale owner");
}finally{await db.close();}
`;
try {
  console.log(
    execFileSync("docker", ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", program], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim(),
  );
} catch {
  console.error("PHASE42_LEASE_CASSANDRA_RACE_FAIL (credential-bearing diagnostics suppressed)");
  process.exitCode = 1;
}
