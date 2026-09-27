import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const gateway = "http://127.0.0.1:8080";
const evidenceDir = "evidence/p12-9rc/avatar";
await mkdir(evidenceDir, { recursive: true });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1cAAAAASUVORK5CYII=",
  "base64",
);
const dataUrl = (bytes, type = "image/png") => `data:${type};base64,${bytes.toString("base64")}`;
async function http(method, path, { token, body, key = randomUUID() } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${gateway}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "idempotency-key": key,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, json: await response.json() };
    } catch (error) {
      if (attempt >= 2 || error?.cause?.code !== "UND_ERR_SOCKET") throw error;
    }
  }
}
async function actor(label) {
  const password = `${randomUUID()}-Aa1!`;
  const email = `avatar-${label}-${randomUUID()}@example.test`;
  const registration = await http("POST", "/api/v1/auth/register", {
    body: { email, password, displayName: `Avatar ${label}` },
  });
  assert.equal(registration.status, 201);
  const login = await http("POST", "/api/v1/auth/login", { body: { email, password } });
  assert.equal(login.status, 200);
  return { userId: registration.json.data.userId, token: login.json.data.accessToken };
}
const owner = await actor("owner");
const foreign = await actor("foreign");
assert.equal((await http("GET", "/api/v1/me/avatar", { token: owner.token })).json.data.dataUrl, null);
assert.equal(
  (await http("POST", "/api/v1/me/avatar", { token: owner.token, body: { dataUrl: dataUrl(png) } })).status,
  200,
);
assert.equal(
  (await http("GET", "/api/v1/me/avatar", { token: owner.token })).json.data.dataUrl,
  dataUrl(png),
);
assert.equal((await http("GET", "/api/v1/me/avatar", { token: foreign.token })).json.data.dataUrl, null);
for (const invalid of [
  { dataUrl: dataUrl(png, "image/jpeg") },
  { dataUrl: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` },
])
  assert.equal((await http("POST", "/api/v1/me/avatar", { token: owner.token, body: invalid })).status, 422);
const tooLarge = Buffer.alloc(256 * 1024 + 1);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(tooLarge);
assert.equal(
  (await http("POST", "/api/v1/me/avatar", { token: owner.token, body: { dataUrl: dataUrl(tooLarge) } }))
    .status,
  422,
);
const maximum = tooLarge.subarray(0, 256 * 1024);
assert.equal(
  (await http("POST", "/api/v1/me/avatar", { token: owner.token, body: { dataUrl: dataUrl(maximum) } }))
    .status,
  200,
);
const first = probe(owner.userId);
assert.equal(first.contentType, "image/png");
assert.equal(first.size, maximum.length);
assert.equal(first.anonymousStatus, 403);
assert.deepEqual(first.columns.sort(), ["content_type", "object_key", "updated_at", "user_id"]);
assert.equal(
  (await http("POST", "/api/v1/me/avatar", { token: owner.token, body: { dataUrl: dataUrl(png) } })).status,
  200,
);
const replacement = probe(owner.userId, first.objectKey);
assert.notEqual(replacement.objectKey, first.objectKey);
assert.equal(replacement.oldExists, false);
assert.equal(
  (await http("POST", "/api/v1/me/avatar", { token: owner.token, body: { dataUrl: null } })).status,
  200,
);
const removed = probe(owner.userId, replacement.objectKey);
assert.equal(removed.rowExists, false);
assert.equal(removed.oldExists, false);
const result = {
  gate: "real-avatar-gateway-minio",
  status: "PASS",
  validUploadRead: true,
  replacementAndDelete: true,
  invalidMimeAndSignatureDenied: true,
  sizeBoundary: { accepted: 256 * 1024, rejected: 256 * 1024 + 1 },
  actorIsolation: true,
  privateObjectAnonymousStatus: 403,
  cassandraMetadataOnly: true,
};
await writeFile(`${evidenceDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));

function probe(userId, oldKey = null) {
  const source = `import c from'cassandra-driver';import{Client as M}from'minio';const i=JSON.parse(process.argv[1]),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(','),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum};await x.connect();const r=(await x.execute('SELECT * FROM avatar_by_user WHERE user_id=?',[c.types.Uuid.fromString(i.userId)],q)).rows[0],m=new M({endPoint:process.env.OBJECT_STORAGE_ENDPOINT,port:Number(process.env.OBJECT_STORAGE_PORT),useSSL:false,accessKey:process.env.OBJECT_STORAGE_ACCESS_KEY,secretKey:process.env.OBJECT_STORAGE_SECRET_KEY}),key=r?.get('object_key')??null;let size=null,oldExists=null,anonymousStatus=null;if(key){size=(await m.statObject(process.env.OBJECT_STORAGE_BUCKET,key)).size;const a=await fetch('http://'+process.env.OBJECT_STORAGE_ENDPOINT+':'+process.env.OBJECT_STORAGE_PORT+'/'+process.env.OBJECT_STORAGE_BUCKET+'/'+key);anonymousStatus=a.status;await a.body?.cancel()}if(i.oldKey){try{await m.statObject(process.env.OBJECT_STORAGE_BUCKET,i.oldKey);oldExists=true}catch{oldExists=false}}console.log(JSON.stringify({rowExists:!!r,contentType:r?.get('content_type')??null,objectKey:key,size,oldExists,anonymousStatus,columns:r?Object.keys(r):[]}));await x.shutdown();`;
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "ailss-identity-service",
        "node",
        "--input-type=module",
        "-e",
        source,
        JSON.stringify({ userId, oldKey }),
      ],
      { encoding: "utf8" },
    ).trim(),
  );
}
