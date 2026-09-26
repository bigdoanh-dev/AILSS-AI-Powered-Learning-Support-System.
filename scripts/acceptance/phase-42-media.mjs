import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readEnv } from "../dev/env.mjs";

const base = "http://127.0.0.1:8080",
  media = await readEnv(new URL("../../.env.media", import.meta.url));
const journal = [];
const check = (label, value) => {
  assert.ok(value, label);
  journal.push(label);
  console.log(`PASS ${label}`);
};
async function api(token, route, method = "GET", body, key, expected = 200) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(base + "/api/v1" + route, {
        method,
        headers: {
          Connection: "close",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      });
      break;
    } catch (error) {
      const code = error.cause?.code ?? error.name;
      if (
        attempt === 0 &&
        code === "UND_ERR_SOCKET" &&
        (method === "GET" || route.endsWith("/media-session"))
      ) {
        console.warn(`RETRY local transport ${route}: ${code}`);
        continue;
      }
      throw Error(`HTTP_TRANSPORT ${route}: ${code}`);
    }
  }
  const value = await response.json();
  assert.equal(response.status, expected, `${route}: ${response.status} ${value.error?.code ?? ""}`);
  return value.data;
}
function db(container, input) {
  const source = `import{readFileSync}from"node:fs";import{createHash,randomUUID}from"node:crypto";import{Client,types}from"cassandra-driver";
    const i=JSON.parse(readFileSync(0,"utf8")),db=new Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,credentials:{username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD}}),q={prepare:true,consistency:types.consistencies.localQuorum},u=types.Uuid.fromString;
    try{let output;
      if(i.action==="promote"){
        const r=(await db.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],shard=createHash("sha256").update(i.userId).digest()[0]%16;
        await db.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.role,r.status,shard,r.updated_at,u(i.userId)],q);
        await db.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);
        await db.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.status,shard,r.updated_at,u(i.userId),r.display_name,r.lecturer_verified,r.profile_version],q);output={ok:true};
      }else if(i.action==="entitle"){
        await db.execute("INSERT INTO entitlement_by_student_course (student_id,course_id,entitlement_id,state,source_offering_id,source_enrollment_id,granted_at,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",[u(i.userId),u(i.courseId),u(i.entitlementId),i.state,u(i.offeringId),u(i.enrollmentId),new Date(),types.Long.fromNumber(i.version),new Date()],q);output={ok:true};
      }else if(i.action==="asset"){
        const r=(await db.execute("SELECT payload FROM media_asset_by_tenant_id WHERE tenant_id=? AND media_asset_id=?",[u(i.tenantId),u(i.id)],q)).rows[0];output=JSON.parse(r.payload);
      }else if(i.action==="legacy"){
        await db.execute("INSERT INTO enrollment_by_student_course (student_id,course_id,enrollment_id,state,source,enrolled_at,version) VALUES (?,?,?,'ACTIVE','PHASE42_FIXTURE',?,1)",[u(i.userId),u(i.courseId),u(randomUUID()),new Date()],q);output={ok:true};
      }else if(i.action==="workerDeny"){
        const readable=(await db.execute("SELECT media_asset_id FROM learning_keyspace.media_asset_by_tenant_id WHERE tenant_id=? AND media_asset_id=?",[u(i.tenantId),u(i.id)],q)).rows.length===1;
        let denied=false;try{await db.execute("SELECT course_id FROM learning_keyspace.course_by_id LIMIT 1",[],q);}catch(e){denied=/unauthorized|not authorized|permission/i.test(String(e));}output={readable,denied};
      }
      console.log(JSON.stringify(output));
    }finally{await db.shutdown();}`;
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", source], {
      input: JSON.stringify(input),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
}
async function register(role) {
  const id = randomUUID(),
    user = {
      email: `phase42-${role}-${id}@example.test`,
      password: `Phase42-${id}-Aa1!`,
      displayName: `Phase42 ${role}`,
    };
  const created = await api(undefined, "/auth/register", "POST", user, `register-${id}`, 201);
  if (role !== "student")
    db("ailss-identity-service", { action: "promote", userId: created.userId, role: role.toUpperCase() });
  const login = await api(undefined, "/auth/login", "POST", { email: user.email, password: user.password });
  return { ...user, userId: created.userId, token: login.accessToken };
}
const directory = await mkdtemp(path.join(tmpdir(), "ailss-phase42-source-")),
  filename = path.join(directory, "source.mp4");
try {
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--cpus",
      "1",
      "--memory",
      "512m",
      "-v",
      `${directory}:/fixture`,
      "--entrypoint",
      "ffmpeg",
      "ailss-media-worker:phase42-a",
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "30",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-b:v",
      "8M",
      "-minrate",
      "8M",
      "-maxrate",
      "8M",
      "-bufsize",
      "16M",
      "-x264-params",
      "nal-hrd=cbr",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "/fixture/source.mp4",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const size = (await stat(filename)).size,
    hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  const sha = hash.digest("hex");
  check("Real FFmpeg-generated source exceeds former 25 MiB limit", size > 25 * 1024 ** 2);
  const admin = await register("admin"),
    lecturer = await register("lecturer"),
    student = await register("student"),
    other = await register("student");
  await api(
    admin.token,
    `/admin/lecturers/${lecturer.userId}/verify`,
    "POST",
    { currentPassword: admin.password },
    randomUUID(),
  );
  lecturer.token = (
    await api(undefined, "/auth/login", "POST", { email: lecturer.email, password: lecturer.password })
  ).accessToken;
  const course = await api(
    lecturer.token,
    "/courses",
    "POST",
    {
      title: "Phase42 Real HLS Lesson",
      slug: `phase42-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
    randomUUID(),
    201,
  );
  const lesson = await api(
    lecturer.token,
    `/courses/${course.courseId}/lessons`,
    "POST",
    {
      title: "Real protected lecture",
      sectionTitle: "Media architecture",
      position: { sectionOrder: 1, lessonOrder: 1 },
      preview: false,
    },
    randomUUID(),
    201,
  );
  const body = {
      lessonId: lesson.lessonId,
      originalFilename: "source.mp4",
      mimeType: "video/mp4",
      sizeBytes: size,
      sourceSha256: sha,
    },
    key = randomUUID();
  const upload = await api(
      lecturer.token,
      `/courses/${course.courseId}/media-assets`,
      "POST",
      body,
      key,
      201,
    ),
    id = upload.asset.mediaAssetId;
  const replay = await api(
    lecturer.token,
    `/courses/${course.courseId}/media-assets`,
    "POST",
    body,
    key,
    201,
  );
  check("Create replay retains one authoritative media asset", id === replay.asset.mediaAssetId);
  await api(lecturer.token, `/courses/${course.courseId}/submit-review`, "POST", {}, randomUUID(), 409);
  check("Course cannot be reviewed while required media is UPLOADING", true);
  await api(other.token, `/media-assets/${id}`, "GET", undefined, undefined, 403);
  check("Non-owner cannot access upload metadata", true);
  const file = await open(filename, "r");
  try {
    for (let part = 1; part <= upload.partCount; part++) {
      const start = (part - 1) * upload.partSize,
        bytes = Buffer.alloc(Math.min(upload.partSize, size - start));
      await file.read(bytes, 0, bytes.length, start);
      const signed = await api(lecturer.token, `/media-assets/${id}/parts`, "POST", { partNumber: part });
      assert.equal(new URL(signed.uploadUrl).port, "9000", "Upload goes directly to MinIO, never Learning");
      const put = () =>
        fetch(signed.uploadUrl, { method: "PUT", body: bytes, signal: AbortSignal.timeout(60000) });
      assert.equal((await put()).status, 200, "Actual direct part upload");
      if (part === 1) {
        assert.equal((await put()).status, 200, "Retry same uploaded part");
        const resumed = await api(lecturer.token, `/media-assets/${id}/upload`);
        check(
          "Actual S3 uploaded-part listing survives part retry",
          resumed.parts.length === 1 && resumed.parts[0].part === 1,
        );
      }
    }
  } finally {
    await file.close();
  }
  check(`Real direct multipart upload (${upload.partCount} parts)`, upload.partCount > 1);
  await api(lecturer.token, `/media-assets/${id}/complete`, "POST", {}, undefined, 202);
  let asset;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    asset = await api(lecturer.token, `/media-assets/${id}`);
    if (asset.status === "READY") break;
    if (["FAILED", "QUARANTINED"].includes(asset.status))
      throw Error(`Worker rejected fixture: ${asset.status}:${asset.failureCode}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  check("Dedicated worker ffprobes, transcodes and persists READY", asset?.status === "READY");
  const original = db("ailss-learning-service", {
    action: "asset",
    tenantId: "00000000-0000-4000-8000-000000000001",
    id,
  });
  check(
    "Actual source SHA256 and ffprobe metadata persisted",
    original.sourceSha256 === sha &&
      original.videoCodec === "h264" &&
      original.width === 1280 &&
      original.height === 720 &&
      original.durationMs >= 30000,
  );
  check(
    "Single rendition is not upscaled",
    original.availableRenditions.length === 1 && original.availableRenditions[0].height === 360,
  );
  check(
    "Auditable lifecycle includes actual verification and encoding",
    ["UPLOADED", "VERIFYING", "QUEUED", "PROCESSING", "READY"].every((state) =>
      original.audit.some((row) => row.to === state),
    ),
  );
  await api(lecturer.token, `/courses/${course.courseId}/submit-review`, "POST", {}, randomUUID(), 202);
  await api(
    admin.token,
    `/admin/courses/${course.courseId}/publish`,
    "POST",
    { currentPassword: admin.password },
    randomUUID(),
  );
  // Fixture-only commercial setup, explicitly not a paid-provider attestation.
  const entitlementIds = {
    entitlementId: randomUUID(),
    offeringId: randomUUID(),
    enrollmentId: randomUUID(),
  };
  db("ailss-learning-service", {
    action: "entitle",
    userId: student.userId,
    courseId: course.courseId,
    state: "ACTIVE",
    version: 1,
    ...entitlementIds,
  });
  const playback = await api(student.token, `/lessons/${lesson.lessonId}/media-session`, "POST", {});
  check(
    "Entitled published student receives delivery session, not S3 read URL",
    new URL(playback.playlistUrl).port === "8080",
  );
  const master = await fetch(playback.playlistUrl),
    text = await master.text();
  check(
    "Private delivery serves actual HLS master",
    master.status === 200 && text.startsWith("#EXTM3U") && text.includes("RESOLUTION=640x360"),
  );
  const variantUrl = new URL(
      text.split("\n").find((line) => line && !line.startsWith("#")),
      playback.playlistUrl,
    ),
    variant = await fetch(variantUrl),
    variantText = await variant.text();
  check(
    "Variant playlist references scoped segments and has ENDLIST",
    variant.status === 200 && variantText.includes("#EXT-X-ENDLIST"),
  );
  const segmentUrl = new URL(
      variantText.split("\n").find((line) => line && !line.startsWith("#")),
      variantUrl,
    ),
    segment = await fetch(segmentUrl),
    segmentBytes = new Uint8Array(await segment.arrayBuffer());
  check(
    "Real MPEG-TS segment bytes delivered outside Learning",
    segment.status === 200 && segmentBytes.length > 188 && segmentBytes[0] === 0x47,
  );
  check(
    "Anonymous object storage cannot read the original",
    (await fetch(`http://127.0.0.1:9000/${media.MEDIA_STORAGE_BUCKET}/${original.originalObjectKey}`))
      .status === 403,
  );
  check(
    "Unsigned media delivery cannot read segments",
    (await fetch(segmentUrl.origin + segmentUrl.pathname)).status === 403,
  );
  await api(other.token, `/lessons/${lesson.lessonId}/media-session`, "POST", {}, undefined, 403);
  check("Non-entitled student gets no playback token", true);
  db("ailss-learning-service", { action: "legacy", userId: student.userId, courseId: course.courseId });
  db("ailss-learning-service", {
    action: "entitle",
    userId: student.userId,
    courseId: course.courseId,
    state: "REVOKED",
    version: 2,
    ...entitlementIds,
  });
  await api(student.token, `/lessons/${lesson.lessonId}/media-session`, "POST", {}, undefined, 403);
  await api(student.token, `/lessons/${lesson.lessonId}`, "GET", undefined, undefined, 403);
  check("Canonical revocation defeats ACTIVE legacy enrollment fallback", true);
  db("ailss-learning-service", {
    action: "entitle",
    userId: student.userId,
    courseId: course.courseId,
    state: "ACTIVE",
    version: 3,
    ...entitlementIds,
  });
  check(
    "Worker Cassandra role cannot read course commercial tables",
    (() => {
      const permission = db("ailss-media-worker", {
        action: "workerDeny",
        tenantId: "00000000-0000-4000-8000-000000000001",
        id,
      });
      return permission.readable && permission.denied;
    })(),
  );
  const evidence = new URL("../../docs/evidence/phase42-a/", import.meta.url);
  await mkdir(evidence, { recursive: true });
  const implementationHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const sourceState = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
    ? "DIRTY"
    : "CLEAN";
  await writeFile(
    new URL("runtime.md", evidence),
    `# Phase 42 real media runtime\n\nGenerated: ${new Date().toISOString()}\nBaseline RC7: 73d7b8a187fc9ea2a5b8d7f05fe51581c50d38d2\nImplementation HEAD: ${implementationHead}\nSource state: ${sourceState}; local Docker images were built from the implementation source, not from RC7. No Phase 42 RC or tag was created.\n\n${journal.map((label) => `- PASS: ${label}`).join("\n")}\n\nSource size: ${size}; SHA256: ${sha}.\nCourse: ${course.courseId}; lesson: ${lesson.lessonId}; asset: ${id}.\n\nEntitlement was seeded as an explicit local acceptance fixture. This is NOT proof of live purchase/payment-provider fulfillment. No object storage, transcoding, HTTP authorization, or media delivery was mocked.\n`,
  );
  const fixture = {
    PHASE42_STUDENT_EMAIL: student.email,
    PHASE42_STUDENT_PASSWORD: student.password,
    PHASE42_OTHER_EMAIL: other.email,
    PHASE42_OTHER_PASSWORD: other.password,
    PHASE42_LECTURER_EMAIL: lecturer.email,
    PHASE42_LECTURER_PASSWORD: lecturer.password,
    PHASE42_COURSE_ID: course.courseId,
    PHASE42_LESSON_ID: lesson.lessonId,
    PHASE42_ASSET_ID: id,
    PHASE42_SOURCE_FILE: filename,
  };
  await writeFile(
    new URL("../../.env.media-acceptance", import.meta.url),
    Object.entries(fixture)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  console.log(
    `PHASE42_RUNTIME_PASS ${journal.length} assertions. No mocks. Browser playback not yet attested.`,
  );
} catch (error) {
  console.error(
    `PHASE42_RUNTIME_FAIL ${error.name}: ${error.message?.replace(/https?:\/\/[^\s]+/g, "[URL REDACTED]")}`,
  );
  process.exitCode = 1;
}
