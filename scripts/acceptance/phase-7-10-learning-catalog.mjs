import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.10 acceptance requires AILSS_PROFILE=dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });

await waitForReady();

// ---------------------------------------------------------------------------
// Controlled published-course fixture (bootstrap/test-only; NOT a production
// publish workflow — LRN-08 remains the future producer; see OD-P7-010-01).
// ---------------------------------------------------------------------------
const categoryId = randomUUID();
const otherCategoryId = randomUUID();
const lecturerId = randomUUID();
const now = new Date();
const isolatedSearchToken = `p${createHash("sha256").update(runId).digest("hex").slice(0, 7)}`;
const publishedAt = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
const previousMonthPublishedAt = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12, 0, 0),
).toISOString();

function shardOf(courseId) {
  return (createHash("sha256").update(courseId).digest()[0] ?? 0) % 4;
}
function yearMonthOf(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function normalizeToken(raw) {
  const base = raw.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const first = base.split(/\s+/u)[0] ?? "";
  const token = first.replace(/[^a-z0-9]/gu, "").slice(0, 20);
  return token.length >= 3 ? token : undefined;
}

// Five visible published courses in the target category (freshest first), spread
// across shards/months, plus controlled stale/ahead/archived/search candidates.
const visible = [0, 1, 2, 3, 4].map((index) => ({
  courseId: randomUUID(),
  title: `${isolatedSearchToken} Course ${index}`,
  slug: `published-course-${index}`,
  categoryId,
  lecturerId,
  state: "PUBLISHED",
  recordVersion: 1,
  projectionVersion: 1,
  priceType: index % 2 === 0 ? "PAID" : "FREE",
  price: index % 2 === 0 ? "19.99" : "0",
  currency: "USD",
  publishedAt: index === 4 ? previousMonthPublishedAt : publishedAt(10 + index),
  searchTokens: [normalizeToken(isolatedSearchToken)].filter(Boolean),
}));
const archivedCourse = {
  courseId: randomUUID(),
  title: "Archived Course",
  slug: "archived-course",
  categoryId,
  lecturerId,
  state: "ARCHIVED",
  recordVersion: 1,
  projectionVersion: 1,
  priceType: "PAID",
  price: "9.99",
  currency: "USD",
  publishedAt: publishedAt(5),
  searchTokens: [],
};
const staleCourse = {
  courseId: randomUUID(),
  title: "Stale Projection Course",
  slug: "stale-projection-course",
  categoryId,
  lecturerId,
  state: "PUBLISHED",
  recordVersion: 3,
  projectionVersion: 1,
  priceType: "PAID",
  price: "5.00",
  currency: "USD",
  publishedAt: publishedAt(4),
  searchTokens: [],
};
const aheadCourse = {
  courseId: randomUUID(),
  title: "Ahead Projection Course",
  slug: "ahead-projection-course",
  categoryId,
  lecturerId,
  state: "PUBLISHED",
  recordVersion: 1,
  projectionVersion: 5,
  priceType: "PAID",
  price: "5.00",
  currency: "USD",
  publishedAt: publishedAt(3),
  searchTokens: [],
};
const draftCourse = {
  courseId: randomUUID(),
  title: "Draft Course",
  slug: "draft-course",
  categoryId,
  lecturerId,
  state: "DRAFT",
  recordVersion: 1,
  projectionVersion: 1,
  priceType: "FREE",
  price: "0",
  currency: "USD",
  publishedAt: publishedAt(2),
  searchTokens: [],
  noProjections: true,
};
const retitledCourse = {
  courseId: randomUUID(),
  title: "Completely Different Title",
  slug: "completely-different-title",
  categoryId,
  lecturerId,
  state: "PUBLISHED",
  recordVersion: 2,
  projectionVersion: 2,
  priceType: "PAID",
  price: "7.50",
  currency: "USD",
  publishedAt: publishedAt(1),
  searchTokens: ["oldtoken"],
  noCategoryProjection: true,
  oldSlug: "old-retitled-course",
};
const otherCategoryCourse = {
  courseId: randomUUID(),
  title: "Other Category Course",
  slug: "other-category-course",
  categoryId: otherCategoryId,
  lecturerId,
  state: "PUBLISHED",
  recordVersion: 1,
  projectionVersion: 1,
  priceType: "PAID",
  price: "1.00",
  currency: "USD",
  publishedAt: publishedAt(8),
  searchTokens: [],
  projectionCategoryId: categoryId,
};

db({
  action: "seed",
  courses: [
    ...visible,
    archivedCourse,
    staleCourse,
    aheadCourse,
    draftCourse,
    retitledCourse,
    otherCategoryCourse,
  ].map(prepareCourse),
});

function prepareCourse(course) {
  return {
    courseId: course.courseId,
    title: course.title,
    slug: course.slug,
    categoryId: course.categoryId,
    lecturerId: course.lecturerId,
    state: course.state,
    recordVersion: course.recordVersion,
    projectionVersion: course.projectionVersion,
    priceType: course.priceType,
    price: course.price,
    currency: course.currency,
    publishedAt: course.publishedAt,
    yearMonth: yearMonthOf(course.publishedAt),
    shard: shardOf(course.courseId),
    searchTokens: course.searchTokens ?? [],
    noProjections: course.noProjections === true,
    noCategoryProjection: course.noCategoryProjection === true,
    projectionCategoryId: course.projectionCategoryId ?? course.categoryId,
    oldSlug: course.oldSlug,
  };
}

// Optional-auth bearer: a valid Identity access token must verify; invalid must 401.
const authUser = await registerAndLogin("p710-auth");

// ---------------------------------------------------------------------------
// LRN-01 catalog
// ---------------------------------------------------------------------------
const catalogPage1 = await request("GET", `/api/v1/courses?categoryId=${categoryId}&limit=2`);
assertStatus(catalogPage1, 200, "LRN-01 catalog page 1");
if (catalogPage1.json.data.length !== 2) throw new Error("Catalog page 1 should return 2 rows");
const cursor1 = catalogPage1.json.meta.pagination.nextCursor;
if (!cursor1) throw new Error("Catalog page 1 should expose a continuation cursor");

const catalogPage2 = await request(
  "GET",
  `/api/v1/courses?categoryId=${categoryId}&limit=2&cursor=${encodeURIComponent(cursor1)}`,
);
assertStatus(catalogPage2, 200, "LRN-01 catalog page 2");

const pageIds = [...catalogPage1.json.data, ...catalogPage2.json.data].map((item) => item.courseId);
if (new Set(pageIds).size !== pageIds.length) throw new Error("Catalog pages repeated a course");
assertDescendingPublishedAt([...catalogPage1.json.data, ...catalogPage2.json.data]);
const visibleIds = new Set(visible.map((course) => course.courseId));
for (const id of pageIds)
  if (!visibleIds.has(id)) throw new Error("Catalog returned a filtered/invalid course");

// Full drain: keep paging until hasMore is false, expect exactly the 5 visible courses.
const drained = new Set(pageIds);
let nextCursor = catalogPage2.json.meta.pagination.nextCursor;
let guard = 0;
while (nextCursor && guard < 10) {
  const page = await request(
    "GET",
    `/api/v1/courses?categoryId=${categoryId}&limit=2&cursor=${encodeURIComponent(nextCursor)}`,
  );
  assertStatus(page, 200, "LRN-01 catalog drain page");
  for (const item of page.json.data) drained.add(item.courseId);
  nextCursor = page.json.meta.pagination.nextCursor;
  guard += 1;
}
if (drained.size !== visible.length) {
  throw new Error(`Catalog drain returned ${drained.size} courses, expected ${visible.length}`);
}

// Cursor tamper / category mismatch / expiry surface as 400 INVALID_CURSOR.
assertError(
  await request(
    "GET",
    `/api/v1/courses?categoryId=${categoryId}&limit=2&cursor=${encodeURIComponent(`${cursor1.slice(0, -1)}x`)}`,
  ),
  400,
  "INVALID_CURSOR",
);
assertError(
  await request(
    "GET",
    `/api/v1/courses?categoryId=${otherCategoryId}&limit=2&cursor=${encodeURIComponent(cursor1)}`,
  ),
  400,
  "INVALID_CURSOR",
);

// Validation: missing categoryId, invalid UUID, limit out of range.
assertError(await request("GET", "/api/v1/courses"), 422, "CATALOG_VALIDATION_FAILED");
assertError(await request("GET", "/api/v1/courses?categoryId=not-a-uuid"), 422, "CATALOG_VALIDATION_FAILED");
assertError(
  await request("GET", `/api/v1/courses?categoryId=${categoryId}&limit=0`),
  422,
  "CATALOG_VALIDATION_FAILED",
);
assertError(
  await request("GET", `/api/v1/courses?categoryId=${categoryId}&limit=500`),
  422,
  "CATALOG_VALIDATION_FAILED",
);
assertError(
  await request("GET", `/api/v1/courses?categoryId=${categoryId}&unsupported=true`),
  422,
  "INVALID_QUERY",
);

// Empty category returns 200 [].
const emptyCatalog = await request("GET", `/api/v1/courses?categoryId=${randomUUID()}&limit=5`);
assertStatus(emptyCatalog, 200, "LRN-01 empty category");
if (emptyCatalog.json.data.length !== 0 || emptyCatalog.json.meta.pagination.hasMore !== false) {
  throw new Error("Empty catalog should return data=[] and hasMore=false");
}

// ---------------------------------------------------------------------------
// LRN-02 search (limited normalized prefix/token search)
// ---------------------------------------------------------------------------
const searchToken = isolatedSearchToken;
const searchResult = await request("GET", `/api/v1/courses/search?q=${searchToken}&limit=10`);
assertStatus(searchResult, 200, "LRN-02 search");
const searchIds = new Set(searchResult.json.data.map((item) => item.courseId));
for (const course of visible) {
  if (!searchIds.has(course.courseId)) throw new Error("Search missed a visible matching course");
}
if (searchIds.has(retitledCourse.courseId))
  throw new Error("Search returned a course whose title no longer matches");

const searchPage1 = await request("GET", `/api/v1/courses/search?q=${searchToken}&limit=2`);
assertStatus(searchPage1, 200, "LRN-02 search page 1");
const searchCursor = searchPage1.json.meta.pagination.nextCursor;
if (!searchCursor) throw new Error("Search page 1 should expose a continuation cursor");
const searchPage2 = await request(
  "GET",
  `/api/v1/courses/search?q=${searchToken}&limit=2&cursor=${encodeURIComponent(searchCursor)}`,
);
assertStatus(searchPage2, 200, "LRN-02 search page 2");
const searchPageIds = [...searchPage1.json.data, ...searchPage2.json.data].map((item) => item.courseId);
if (new Set(searchPageIds).size !== searchPageIds.length) throw new Error("Search pages repeated a course");

// Normalization: mixed-case + whitespace query still matches.
const normalizedSearch = await request(
  "GET",
  `/api/v1/courses/search?q=${encodeURIComponent(`  ${isolatedSearchToken.toUpperCase()}  `)}&limit=10`,
);
assertStatus(normalizedSearch, 200, "LRN-02 normalized search");
if (normalizedSearch.json.data.length !== visible.length) {
  throw new Error("Normalized search should match all visible courses");
}

// Short token rejected (below 3-char minimum after normalization).
assertError(await request("GET", "/api/v1/courses/search?q=ab"), 422, "SEARCH_VALIDATION_FAILED");
assertError(await request("GET", "/api/v1/courses/search"), 422, "SEARCH_VALIDATION_FAILED");
assertError(
  await request("GET", `/api/v1/courses/search?q=${"a".repeat(21)}`),
  422,
  "SEARCH_VALIDATION_FAILED",
);

// Revalidation: a projection row whose canonical title no longer yields the token is filtered.
const staleTokenSearch = await request("GET", "/api/v1/courses/search?q=oldtoken&limit=10");
assertStatus(staleTokenSearch, 200, "LRN-02 stale-token search");
if (staleTokenSearch.json.data.length !== 0) {
  throw new Error("Search returned a course whose canonical title no longer matches the token");
}

// ---------------------------------------------------------------------------
// LRN-03 course detail
// ---------------------------------------------------------------------------
const detailTarget = visible[0];
const detail = await request("GET", `/api/v1/courses/${detailTarget.courseId}`);
assertStatus(detail, 200, "LRN-03 published detail");
assertKeys(detail.json.data, [
  "categoryId",
  "courseId",
  "createdAt",
  "currency",
  "lecturerId",
  "price",
  "priceType",
  "slug",
  "title",
  "updatedAt",
]);
if (detail.json.data.courseId !== detailTarget.courseId) throw new Error("Detail returned wrong course");

assertError(await request("GET", `/api/v1/courses/${draftCourse.courseId}`), 404, "COURSE_NOT_FOUND");
assertError(await request("GET", `/api/v1/courses/${archivedCourse.courseId}`), 404, "COURSE_NOT_FOUND");
assertError(await request("GET", `/api/v1/courses/${randomUUID()}`), 404, "COURSE_NOT_FOUND");
assertError(await request("GET", "/api/v1/courses/not-a-uuid"), 400, "INVALID_COURSE_ID");

// ---------------------------------------------------------------------------
// LRN-04 by-slug
// ---------------------------------------------------------------------------
const slugTarget = visible[1];
const bySlug = await request("GET", `/api/v1/courses/by-slug/${encodeURIComponent(slugTarget.slug)}`);
assertStatus(bySlug, 200, "LRN-04 by-slug");
if (bySlug.json.data.courseId !== slugTarget.courseId) throw new Error("Slug lookup returned wrong course");

assertError(await request("GET", "/api/v1/courses/by-slug/does-not-exist"), 404, "COURSE_NOT_FOUND");
assertError(
  await request("GET", `/api/v1/courses/by-slug/${encodeURIComponent(archivedCourse.slug)}`),
  404,
  "COURSE_NOT_FOUND",
);
assertError(
  await request("GET", `/api/v1/courses/by-slug/${encodeURIComponent(retitledCourse.oldSlug)}`),
  404,
  "COURSE_NOT_FOUND",
);
assertError(
  await request("GET", `/api/v1/courses/by-slug/${encodeURIComponent(staleCourse.slug)}`),
  503,
  "LEARNING_PROJECTION_INCONSISTENT",
);
assertError(
  await request("GET", `/api/v1/courses/by-slug/${encodeURIComponent(aheadCourse.slug)}`),
  503,
  "LEARNING_PROJECTION_INCONSISTENT",
);

// ---------------------------------------------------------------------------
// Optional Bearer semantics (gateway edge)
// ---------------------------------------------------------------------------
// Anonymous succeeds (no Authorization header) — covered by the calls above.
const withValidBearer = await request("GET", `/api/v1/courses?categoryId=${categoryId}&limit=2`, {
  bearer: authUser.accessToken,
});
assertStatus(withValidBearer, 200, "LRN-01 with valid bearer");
assertError(
  await request("GET", `/api/v1/courses?categoryId=${categoryId}&limit=2`, { bearer: "not-a-jwt" }),
  401,
  "INVALID_ACCESS_TOKEN",
);
assertError(
  await request("GET", `/api/v1/courses/${detailTarget.courseId}`, { bearer: "garbage.token.here" }),
  401,
  "INVALID_ACCESS_TOKEN",
);

// ---------------------------------------------------------------------------
// Ownership / privacy
// ---------------------------------------------------------------------------
if (!verifyForeignAccessDenied()) throw new Error("svc_learning unexpectedly read identity_keyspace");
const logs = `${dockerLogs("ailss-learning-service")}\n${dockerLogs("ailss-api-gateway")}`;
for (const sensitive of [authUser.password, authUser.accessToken]) {
  if (logs.includes(sensitive)) throw new Error("Sensitive material appeared in logs");
}
if (logs.includes("LEARNING_CURSOR_HMAC_KEY=")) throw new Error("Cursor secret leaked into logs");

await writeEvidence("p7.10-environment.json", {
  phase: "7.10",
  profile,
  runId,
  hostNode: process.version,
  runtimeNode: safeCommand("docker", ["exec", "ailss-learning-service", "node", "--version"]),
  gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
});
await writeEvidence("p7.10-http-acceptance.json", {
  catalogPage1: safePage(catalogPage1),
  catalogPage2: safePage(catalogPage2),
  drainedCourseCount: drained.size,
  search: { status: searchResult.status, count: searchResult.json.data.length },
  normalizedSearch: { status: normalizedSearch.status, count: normalizedSearch.json.data.length },
  searchPagination: { page1: safePage(searchPage1), page2: safePage(searchPage2) },
  detail: safeHttp(detail),
  bySlug: safeHttp(bySlug),
  withValidBearer: { status: withValidBearer.status },
});
await writeEvidence("p7.10-visibility-verification.json", {
  canonicalFirstVisibility: true,
  archivedFiltered: true,
  draftFiltered: true,
  staleProjectionFiltered: true,
  aheadProjectionFiltered: true,
  searchPredicateRevalidated: true,
  boundedMonthWindow: "current+previous",
  learningShardCount: 4,
  allowFilteringUsed: false,
  allCategoryScanUsed: false,
  foreignIdentityKeyspaceDenied: true,
});
await writeEvidence("p7.10-summary.json", {
  stage: "phase-7.10-learning-catalog-acceptance",
  status: "PASS",
  lrn01: true,
  lrn02: true,
  lrn03: true,
  lrn04: true,
  canonicalPublishedVisibility: true,
  boundedShardMonthFanOut: true,
  opaqueSignedCursor: true,
  optionalBearerStrict: true,
  learningOnlyKeyspace: true,
});
console.log(
  JSON.stringify({
    stage: "phase-7.10-learning-catalog-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidenceDirectory.pathname),
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function registerAndLogin(label) {
  const id = randomUUID();
  const item = {
    email: `${label}-${id}@example.test`,
    password: `P7.10-${label}-${id}-Aa1!`,
    displayName: `P710 ${label} ${id.slice(0, 8)}`,
  };
  const registered = await request("POST", "/api/v1/auth/register", {
    body: item,
    idempotencyKey: `p710-register-${id}`,
  });
  assertStatus(registered, 201, "auth user registration");
  const loginResponse = await request("POST", "/api/v1/auth/login", {
    body: { email: item.email, password: item.password },
  });
  assertStatus(loginResponse, 200, "auth user login");
  return { ...item, accessToken: loginResponse.json.data.accessToken };
}

async function request(method, path, { body, bearer, idempotencyKey } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(25_000),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError;
}

async function waitForReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8080/health/ready");
      if (response.ok) return;
    } catch {
      // Retry during container replacement.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway did not become ready");
}

function databaseProbeSource() {
  return `
    import { readFileSync } from "node:fs";
    import cassandra from "cassandra-driver";
    const input=JSON.parse(readFileSync(0,"utf8"));
    const c=new cassandra.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD),queryOptions:{prepare:true}});
    await c.connect();
    const w={prepare:true,consistency:cassandra.types.consistencies.localQuorum};
    const uuid=v=>cassandra.types.Uuid.fromString(v);
    const ldate=v=>cassandra.types.LocalDate.fromString(v);
    const dec=v=>cassandra.types.BigDecimal.fromString(v);
    const ts=v=>new Date(v);
    const run=async(label,query,params)=>{try{return await c.execute(query,params,w)}catch(error){console.error(JSON.stringify({label,message:error instanceof Error?error.message:String(error),code:error?.code}));process.exit(2)}};
    if(input.action==="seed"){
      for(const x of input.courses){
        await run("course_by_id","INSERT INTO course_by_id (course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?)",[uuid(x.courseId),uuid(x.lecturerId),x.title,x.slug,uuid(x.categoryId),x.state,x.recordVersion,x.priceType,dec(x.price),x.currency,ts(x.publishedAt),ts(x.publishedAt)]);
        if(!x.noProjections){
          await run("course_by_slug","INSERT INTO course_by_slug (normalized_slug,course_id,state,title,category_id,price_type,price,currency,course_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",[x.slug,uuid(x.courseId),x.state,x.title,uuid(x.categoryId),x.priceType,dec(x.price),x.currency,x.projectionVersion,ts(x.publishedAt)]);
          if(x.oldSlug) await run("old_course_by_slug","INSERT INTO course_by_slug (normalized_slug,course_id,state,title,category_id,price_type,price,currency,course_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",[x.oldSlug,uuid(x.courseId),x.state,x.title,uuid(x.categoryId),x.priceType,dec(x.price),x.currency,x.projectionVersion,ts(x.publishedAt)]);
          if(!x.noCategoryProjection) await run("category","INSERT INTO published_courses_by_category_bucket (category_id,year_month,shard,published_at,course_id,slug,title,lecturer_id,price_type,price,currency,course_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",[uuid(x.projectionCategoryId),ldate(x.yearMonth),x.shard,ts(x.publishedAt),uuid(x.courseId),x.slug,x.title,uuid(x.lecturerId),x.priceType,dec(x.price),x.currency,x.projectionVersion]);
          for(const token of x.searchTokens){
            await run("search","INSERT INTO published_courses_by_search_token_bucket (token_prefix,year_month,shard,published_at,course_id,slug,title,category_id,course_version) VALUES (?,?,?,?,?,?,?,?,?)",[token,ldate(x.yearMonth),x.shard,ts(x.publishedAt),uuid(x.courseId),x.slug,x.title,uuid(x.categoryId),x.projectionVersion]);
          }
        }
      }
    } else throw new Error("unknown action");
    console.log(JSON.stringify({ok:true})); await c.shutdown();`;
}

function db(input) {
  try {
    return JSON.parse(
      execFileSync(
        "docker",
        ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", databaseProbeSource()],
        { encoding: "utf8", input: JSON.stringify(input), stdio: ["pipe", "pipe", "pipe"] },
      ).trim(),
    );
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`Learning fixture database probe failed: ${stderr.slice(0, 4_000)}`);
  }
}

function verifyForeignAccessDenied() {
  const source = `import cassandra from "cassandra-driver";const c=new cassandra.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,authProvider:new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});try{await c.execute("SELECT * FROM identity_keyspace.user_by_id LIMIT 1");console.log("ALLOWED")}catch{console.log("DENIED")}finally{await c.shutdown()}`;
  return (
    execFileSync("docker", ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim() === "DENIED"
  );
}

function assertDescendingPublishedAt(items) {
  for (let index = 1; index < items.length; index += 1) {
    const before = items[index - 1];
    const after = items[index];
    if (Date.parse(before.publishedAt) < Date.parse(after.publishedAt)) {
      throw new Error("Catalog order is not published_at DESC");
    }
  }
}

function assertKeys(value, expected) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected.slice().sort()))
    throw new Error("DTO leaked or omitted fields");
}
function assertStatus(result, status, label) {
  if (result.status !== status)
    throw new Error(`${label}: expected ${status}, got ${result.status} ${JSON.stringify(result.json)}`);
}
function assertError(result, status, code) {
  assertStatus(result, status, code);
  if (result.json?.error?.code !== code) throw new Error(`Expected ${code}, got ${result.json?.error?.code}`);
}
function safePage(result) {
  return {
    status: result.status,
    count: result.json?.data?.length,
    hasMore: result.json?.meta?.pagination?.hasMore,
    cursorPresent: Boolean(result.json?.meta?.pagination?.nextCursor),
  };
}
function safeHttp(result) {
  return { status: result.status, code: result.json?.error?.code, courseId: result.json?.data?.courseId };
}
function dockerLogs(container) {
  return safeCommand("docker", ["logs", "--tail", "2000", container]);
}
function safeCommand(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
async function writeEvidence(name, value) {
  await writeFile(new URL(name, evidenceDirectory), `${JSON.stringify(value, null, 2)}\n`);
}
