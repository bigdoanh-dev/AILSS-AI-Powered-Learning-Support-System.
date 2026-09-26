import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readEnv, required } from "../dev/env.mjs";

// Real Gateway + delivery, using the actual lesson binding and production-issued
// session. This is the token/HLS/poster subset, NOT the full upload/caption matrix.
const fixture = await readEnv(new URL("../../.env.media-acceptance", import.meta.url));
const base = "http://127.0.0.1:8080";
let checks = 0;
async function response(url, expected, options = {}) {
  const result = await fetch(url, {
    ...options,
    headers: { Connection: "close", ...options.headers },
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(result.status, expected, `HTTP ${result.status}, expected ${expected}`);
  checks++;
  return result;
}
async function login(prefix) {
  const result = await response(`${base}/api/v1/auth/login`, 200, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: required(fixture, `${prefix}_EMAIL`),
      password: required(fixture, `${prefix}_PASSWORD`),
    }),
  });
  return (await result.json()).data.accessToken;
}
try {
  const student = await login("PHASE42_STUDENT");
  const authorized = await response(
    `${base}/api/v1/lessons/${required(fixture, "PHASE42_LESSON_ID")}/media-session`,
    200,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${student}`, "Content-Type": "application/json" },
      body: "{}",
    },
  );
  const session = (await authorized.json()).data;
  const masterUrl = new URL(session.playlistUrl);
  assert.equal(masterUrl.origin, base);
  const token = masterUrl.searchParams.get("token");
  assert.ok(token && token.split(".").length === 3);
  const master = await (await response(masterUrl, 200)).text();
  const variantUrl = new URL(
    master.split("\n").find((line) => line && !line.startsWith("#")),
    masterUrl,
  );
  const variant = await (await response(variantUrl, 200)).text();
  const segmentUrl = new URL(
    variant.split("\n").find((line) => line && !line.startsWith("#")),
    variantUrl,
  );
  assert.ok((await (await response(segmentUrl, 200)).arrayBuffer()).byteLength > 188);
  await response(session.posterUrl, 200);
  const caption = session.captionTracks?.find((track) => track.language === "vi");
  assert.ok(caption?.url, "Requires actual private caption on active asset");
  assert.match(await (await response(caption.url, 200)).text(), /^WEBVTT/u);
  // B is an actual retained READY version with real private output objects, not
  // merely an invented/nonexistent UUID that happens to return a denial.
  const otherAssetId = required(fixture, "PHASE42_ASSET_ID");
  assert.notEqual(otherAssetId, session.mediaAssetId, "Requires distinct actual READY assets A and B");
  const program = `import assert from"node:assert/strict";import{readFileSync}from"node:fs";
import{CassandraClient}from"./dist/packages/cassandra/src/index.js";import{CassandraMediaRepository}from"./dist/apps/learning-service/src/media/repository.js";
import{loadConfig}from"./dist/packages/config/src/index.js";import{mediaRuntime}from"./dist/apps/learning-service/src/media/config.js";
const i=JSON.parse(readFileSync(0,"utf8")),config=loadConfig({...process.env,APP_NAME:"AILSS",SERVICE_ID:"media-token-isolation-acceptance"}),settings=mediaRuntime(config,false);
const db=await CassandraClient.create({contactPoints:config.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:config.CASSANDRA_LOCAL_DC,keyspace:"learning_keyspace",username:config.CASSANDRA_USERNAME,password:config.CASSANDRA_PASSWORD});
try{const repo=new CassandraMediaRepository(db),asset=await repo.get(config.PLATFORM_TENANT_ID,i.id);assert.equal(asset.status,"READY");const prefix=asset.masterPlaylistObjectKey.replace(/master\\.m3u8$/,""),names=["master.m3u8",i.variant,i.segment,"poster.jpg"];
for(const name of names)assert.ok((await settings.storage.stat(prefix+name)).size>0);
assert.equal(await repo.get(i.otherTenant,i.id),undefined);
console.log(JSON.stringify({asset:i.id,ready:true,privateObjectsVerified:names.length,crossTenantReadDenied:true}));}finally{await db.close();}`;
  let inspected;
  try {
    inspected = JSON.parse(
      execFileSync(
        "docker",
        ["exec", "-i", "ailss-media-worker", "node", "--input-type=module", "-e", program],
        {
          input: JSON.stringify({
            id: otherAssetId,
            otherTenant: randomUUID(),
            variant: variantUrl.pathname.split("/").at(-1),
            segment: segmentUrl.pathname.split("/").at(-1),
          }),
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      ),
    );
  } catch {
    throw Error("ACTUAL_READY_ASSET_B_INSPECTION_FAILED");
  }
  assert.equal(inspected.privateObjectsVerified, 4);
  assert.equal(inspected.crossTenantReadDenied, true);
  checks++;
  for (const url of [masterUrl, variantUrl, segmentUrl, new URL(session.posterUrl), new URL(caption.url)]) {
    const unsigned = new URL(url);
    unsigned.search = "";
    await response(unsigned, 403);
    const wrongAsset = new URL(url);
    wrongAsset.pathname = wrongAsset.pathname.replace(session.mediaAssetId, otherAssetId);
    await response(wrongAsset, 403);
  }
  const pieces = token.split(".");
  const payload = JSON.parse(Buffer.from(pieces[1], "base64url").toString());
  for (const alteration of [
    { tenantId: randomUUID() },
    { courseId: randomUUID() },
    { mediaAssetId: randomUUID() },
    { operation: "UPLOAD" },
    { exp: Math.floor(Date.now() / 1000) + 86400 },
  ]) {
    const forged = new URL(masterUrl);
    forged.searchParams.set(
      "token",
      `${pieces[0]}.${Buffer.from(JSON.stringify({ ...payload, ...alteration })).toString("base64url")}.${pieces[2]}`,
    );
    await response(forged, 403);
  }
  const badSignature = new URL(masterUrl);
  badSignature.searchParams.set("token", `${pieces[0]}.${pieces[1]}.${"A".repeat(43)}`);
  await response(badSignature, 403);
  const noAlgorithm = new URL(masterUrl);
  noAlgorithm.searchParams.set(
    "token",
    `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${pieces[1]}.`,
  );
  await response(noAlgorithm, 403);
  const tooLong = new URL(masterUrl);
  tooLong.searchParams.set("token", "x".repeat(4097));
  await response(tooLong, 403);
  const extraQuery = new URL(masterUrl);
  extraQuery.searchParams.set("objectKey", "media-original/source");
  await response(extraQuery, 403);
  await response(masterUrl, 403, { headers: { Origin: "https://untrusted.example.test" } });
  await response(`${base}/api/v1/media-assets/${session.mediaAssetId}/parts`, 401, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: '{"partNumber":1}',
  });
  await response(`${base}/api/v1/media-assets/${session.mediaAssetId}/upload`, 401, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const other = await login("PHASE42_OTHER");
  await response(`${base}/api/v1/media-assets/${session.mediaAssetId}/upload`, 403, {
    headers: { Authorization: `Bearer ${other}` },
  });
  // No known source key is accepted by the allowlisted delivery filename route.
  await response(`${base}/playback/${session.mediaAssetId}/source?token=${encodeURIComponent(token)}`, 404);
  console.log(
    `PHASE42_TOKEN_ISOLATION_PASS checks=${checks} assetA=${session.mediaAssetId} assetB=${otherAssetId} actualPrivateObjectsB=4 crossTenant=CASSANDRA_DOMAIN scope=HLS_POSTER_CAPTION_TOKEN_UPLOAD_NONOWNER native=NOT_RUN`,
  );
} catch (error) {
  console.error(
    `PHASE42_TOKEN_ISOLATION_FAIL name=${error.name} message=${String(error.message).replace(/https?:\/\/[^\s]+/g, "[URL REDACTED]")}`,
  );
  process.exitCode = 1;
}
