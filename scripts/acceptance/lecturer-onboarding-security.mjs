import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const logs = execFileSync(
  "docker",
  ["compose", "logs", "--since", "2h", "--no-color", "identity-service", "api-gateway"],
  { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
);
const jwt = /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{20,}/;
assert.equal(jwt.test(logs), false, "JWT found in service logs");
assert.equal(/p122b-[^\s"@]+@example\.test/.test(logs), false, "Raw applicant email in service logs");
assert.equal(/P122b![0-9a-f-]{36}|Web-Fixture![0-9a-f-]{36}/.test(logs), false, "Fixture credential in logs");
// Bounded verification of this command family's journals, never a runtime access pattern.
const source = `import c from 'cassandra-driver';const x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(','),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});await x.connect();const q={prepare:true,consistency:c.types.consistencies.localQuorum},r=await x.execute('SELECT payload_json FROM lecturer_application_by_applicant LIMIT 100',[],q);let checked=0;for(const row of r.rows){const text=row.get('payload_json');if(/accessToken|refreshToken|currentPassword|password|rawEmail|normalizedEmail|eyJ[A-Za-z0-9_-]+\\./.test(text))throw Error('Application sensitive field');checked++;}let journals=0,audits=0;for(const table of ['idempotency_by_scope_key','identity_commands_by_due_bucket']){const column=table==='idempotency_by_scope_key'?'result_checksum':'intent_json';const result=await x.execute('SELECT '+column+' FROM '+table+' LIMIT 500',[],q);for(const row of result.rows){const text=row.get(column)||'';if(!text.includes('lecturer-application:'))continue;if(/accessToken|refreshToken|currentPassword|passwordHash|normalizedEmail|Bearer |eyJ[A-Za-z0-9_-]+\\./.test(text))throw Error('Command secret');journals++;}}const pending=await x.execute('SELECT payload_json FROM pending_events_by_due_bucket LIMIT 500',[],q);for(const row of pending.rows){const text=row.get('payload_json')||'';if(!text.includes('LECTURER_APPLICATION_'))continue;const data=JSON.parse(text).data;if(Object.keys(data).some(k=>!['action','actorType','actorId','targetType','targetId','outcome','requestId'].includes(k)))throw Error('Audit extra fields');audits++;}await x.shutdown();console.log(JSON.stringify({applicationRows:checked,journals,audits}));`;
const rows = JSON.parse(
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "identity-service", "node", "--input-type=module", "-e", source],
    { encoding: "utf8" },
  ),
);
assert.ok(rows.applicationRows > 0);
await mkdir("docs/evidence/p12.2b-security", { recursive: true });
await writeFile(
  "docs/evidence/p12.2b-security/report.json",
  JSON.stringify(
    {
      status: "PASS",
      scope: "bounded current local dev application rows and last two hours Identity/Gateway logs",
      ...rows,
      checks: [
        "no JWT in logs",
        "no raw fixture email in logs",
        "no fixture password in logs",
        "no secret fields in application payloads",
      ],
      limitations: ["bounded sample of 500 journal/intent/audit rows; not an exhaustive historical scan"],
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ status: "PASS", ...rows }));
