import assert from "node:assert/strict";
import { readEnv, required } from "../dev/env.mjs";

const fixture = await readEnv(new URL("../../.env.media-acceptance", import.meta.url));
const media = await readEnv(new URL("../../.env.media", import.meta.url));
const base = "http://127.0.0.1:8080";
let checks = 0;
async function request(path, status, token, method = "GET", body, key) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Connection: "close",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, status, `${path}: HTTP ${response.status}, expected ${status}`);
  checks++;
  return response;
}
async function login(prefix) {
  const response = await request("/api/v1/auth/login", 200, undefined, "POST", {
    email: required(fixture, `${prefix}_EMAIL`),
    password: required(fixture, `${prefix}_PASSWORD`),
  });
  return (await response.json()).data.accessToken;
}
const lecturer = await login("PHASE42_LECTURER");
const student = await login("PHASE42_STUDENT");
const other = await login("PHASE42_OTHER");
const lessonId = required(fixture, "PHASE42_LESSON_ID");
async function playback() {
  const response = await request(`/api/v1/lessons/${lessonId}/media-session`, 200, student, "POST", {});
  return (await response.json()).data;
}
const initial = await playback();
const activeId = initial.mediaAssetId;
const otherId = required(fixture, "PHASE42_ASSET_ID");
assert.notEqual(activeId, otherId);
const input = {
  language: "vi",
  label: "Tiếng Việt",
  kind: "SUBTITLES",
  contentType: "text/vtt",
  content: "WEBVTT\n\n00:00:00.000 --> 00:00:25.000\nPhụ đề kiểm thử AILSS\n",
};
for (const id of [activeId, otherId]) {
  const response = await request(
    `/api/v1/media-assets/${id}/captions`, 201, lecturer, "POST", input, `phase42-caption-${id}-v1`,
  );
  const value = (await response.json()).data;
  assert.equal(value.format, "WEBVTT");
  assert.equal(value.mediaAssetId, undefined);
  assert.ok(!JSON.stringify(value).includes("media-caption/"));
}
await request(`/api/v1/media-assets/${activeId}/captions`, 403, other, "POST", input, "non-owner-caption");
await request(`/api/v1/media-assets/${activeId}/captions`, 422, lecturer, "POST", {
  ...input, content: "WEBVTT\n\n00:00:25.000 --> 00:00:01.000\nInvalid\n",
}, "bad-caption");
const session = await playback();
const track = session.captionTracks.find((item) => item.language === "vi" && item.label === "Tiếng Việt");
assert.ok(track?.url);
assert.ok(!JSON.stringify(session).includes("media-caption/"));
const signed = await request(new URL(track.url).pathname + new URL(track.url).search, 200);
assert.match(await signed.text(), /Phụ đề kiểm thử AILSS/u);
const unsigned = new URL(track.url);
unsigned.search = "";
await request(unsigned.pathname, 403);
const bUrl = new URL(track.url);
bUrl.pathname = bUrl.pathname.replace(activeId, otherId);
await request(bUrl.pathname + bUrl.search, 403);
const signedToken = new URL(track.url).searchParams.get("token");
assert.ok(signedToken);
const tenantId = JSON.parse(Buffer.from(signedToken.split(".")[1], "base64url").toString("utf8")).tenantId;
assert.match(tenantId, /^[0-9a-f-]{36}$/i);
const privateObject = await fetch(
  `http://127.0.0.1:9000/${required(media, "MEDIA_STORAGE_BUCKET")}/media-caption/${tenantId}/${activeId}/${track.captionTrackId}.vtt`,
  { signal: AbortSignal.timeout(15_000) },
);
assert.equal(privateObject.status, 403, "Anonymous direct object request must remain denied");
checks++;
console.log(`PHASE42_CAPTIONS_PASS checks=${checks} active=${activeId} other=${otherId} track=${track.captionTrackId}`);
