import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { importPKCS8, SignJWT } from "jose";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P7.15B requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();
const admin = await register("admin"),
  lecturer = await register("lecturer"),
  lecturer2 = await register("lecturer2"),
  student = await register("student"),
  outsider = await register("outsider");
identity({ action: "promote", userId: admin.userId, role: "ADMIN" });
identity({ action: "promote", userId: lecturer.userId, role: "LECTURER" });
identity({ action: "promote", userId: lecturer2.userId, role: "LECTURER" });
const adminToken = (await login(admin)).accessToken;
for (const target of [lecturer, lecturer2])
  expectStatus(
    await http("POST", `/api/v1/admin/lecturers/${target.userId}/verify`, {
      bearer: adminToken,
      key: `verify-${target.userId}-${runId}`,
      body: { currentPassword: admin.password },
    }),
    200,
    "verify Lecturer",
  );
const lecturerToken = (await login(lecturer)).accessToken,
  lecturer2Token = (await login(lecturer2)).accessToken,
  studentToken = (await login(student)).accessToken,
  outsiderToken = (await login(outsider)).accessToken;
const course = await createPublishedCourse(lecturerToken, adminToken, admin.password);

const hourMs = 3_600_000,
  base = Math.ceil((Date.now() + 48 * hourMs) / hourMs) * hourMs,
  at = (offsetDays, offsetHours = 0, offsetMs = 0) =>
    new Date(base + offsetDays * 86_400_000 + offsetHours * hourMs + offsetMs).toISOString(),
  calendarDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// --- Fixtures: one class per kind, owned by the eligible lecturer -------------------------------
const privateClass = await createClass(lecturerToken, "PRIVATE", course.courseId),
  institutionalClass = await createClass(lecturerToken, "INSTITUTIONAL"),
  liveClass = await createClass(lecturerToken, "LIVE_COHORT", course.courseId),
  liveClass2 = await createClass(lecturerToken, "LIVE_COHORT", course.courseId),
  emptyClass = await createClass(lecturerToken, "PRIVATE"),
  capClass = await createClass(lecturerToken, "PRIVATE"),
  dateCapClass = await createClass(lecturerToken, "PRIVATE");
expectStatus(
  await http("POST", "/api/v1/classes/join", {
    bearer: studentToken,
    key: `join-private-${runId}`,
    body: { code: privateClass.joinCode },
  }),
  201,
  "PRIVATE DRAFT join",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: studentToken,
    key: `student-write-${runId}`,
    body: offlineSession(at(0), at(0, 1)),
  }),
  403,
  "Student session write denied",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturer2Token,
    key: `nonowner-write-${runId}`,
    body: offlineSession(at(0), at(0, 1)),
  }),
  403,
  "non-owner Lecturer session write denied",
);

// --- CLS-11 validation gates ----------------------------------------------------------------------
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `dto-online-${runId}`,
    body: {
      title: "Missing Link Session",
      startAt: at(0),
      endAt: at(0, 1),
      timezone: "Asia/Ho_Chi_Minh",
      mode: "ONLINE",
    },
  }),
  422,
  "ONLINE without meeting fields denied",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `dto-offline-${runId}`,
    body: {
      title: "Missing Location Session",
      startAt: at(0),
      endAt: at(0, 1),
      timezone: "Asia/Ho_Chi_Minh",
      mode: "OFFLINE",
    },
  }),
  422,
  "OFFLINE without location denied",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `dto-tz-${runId}`,
    body: offlineSession(at(0), at(0, 1), "+07:00"),
  }),
  422,
  "offset timezone denied",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `dto-order-${runId}`,
    body: offlineSession(at(0, 2), at(0, 1)),
  }),
  422,
  "reversed timestamps denied",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `dto-duration-${runId}`,
    body: offlineSession(at(0), at(0, 13)),
  }),
  422,
  "duration above 12h denied",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `dto-recurrence-${runId}`,
    body: {
      ...offlineSession(at(1), at(1, 2)),
      recurrence: { frequency: "WEEKLY", interval: 5, until: calendarDay(base + 60 * 86_400_000) },
    },
  }),
  422,
  "recurrence interval above 4 denied",
);

// --- CLS-11 authoring on the PRIVATE class ---------------------------------------------------------
expectStatus(
  await http("POST", `/api/v1/classes/${emptyClass.classId}/schedule/publish`, {
    bearer: lecturerToken,
    key: `publish-empty-${runId}`,
  }),
  422,
  "empty schedule publish denied",
);
const windowSession = await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
  bearer: lecturerToken,
  key: `window-${runId}`,
  body: {
    title: "Open Window Session",
    startAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    endAt: new Date(Date.now() + 2 * hourMs).toISOString(),
    timezone: "Asia/Ho_Chi_Minh",
    mode: "ONLINE",
    meetingProvider: "meet",
    meetingUrl: "https://meet.example.test/window",
  },
});
expectStatus(windowSession, 201, "meeting-window session create");
const first = await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
  bearer: lecturerToken,
  key: `sessions-first-${runId}`,
  body: {
    title: "Anchor Session",
    startAt: at(0),
    endAt: at(0, 2),
    timezone: "Asia/Ho_Chi_Minh",
    mode: "ONLINE",
    meetingProvider: "meet",
    meetingUrl: "https://meet.example.test/anchor",
  },
});
expectStatus(first, 201, "single ONLINE session create");
const anchorSessionId = first.json.data.sessions[0].sessionId;
if (first.json.data.sessionCount !== 1 || !first.json.data.sessions[0].meetingProvider)
  throw new Error("session create DTO mismatch");
if (JSON.stringify(first.json).includes("meetingUrl")) throw new Error("meetingUrl leaked into create DTO");
const replay = await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
  bearer: lecturerToken,
  key: `sessions-first-${runId}`,
  body: {
    title: "Anchor Session",
    startAt: at(0),
    endAt: at(0, 2),
    timezone: "Asia/Ho_Chi_Minh",
    mode: "ONLINE",
    meetingProvider: "meet",
    meetingUrl: "https://meet.example.test/anchor",
  },
});
expectStatus(replay, 201, "session create replay");
if (!replay.json.meta.replayed || replay.json.data.sessions[0].sessionId !== anchorSessionId)
  throw new Error("session replay mismatch");
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `sessions-first-${runId}`,
    body: { ...offlineSession(at(9), at(9, 1)), title: "Conflicting Body" },
  }),
  409,
  "idempotency conflict on reused key",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `overlap-day-${runId}`,
    body: onlineSession(at(0, 1), at(0, 3)),
  }),
  409,
  "same-day overlap denied",
);
const touching = await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
  bearer: lecturerToken,
  key: `touching-${runId}`,
  body: offlineSession(at(0, 2), at(0, 3)),
});
expectStatus(touching, 201, "touching endpoints allowed");
const recurring = await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
  bearer: lecturerToken,
  key: `recurring-${runId}`,
  body: {
    ...offlineSession(at(1), at(1, 2)),
    title: "Weekly Series",
    recurrence: { frequency: "WEEKLY", interval: 1, until: calendarDay(base + 22 * 86_400_000) },
  },
});
expectStatus(recurring, 201, "weekly recurrence materialization");
if (recurring.json.data.sessionCount !== 4) throw new Error("weekly recurrence count mismatch");
const recurringDates = recurring.json.data.sessions.map((s) => s.startAt.slice(0, 10));
if (recurringDates.join(",") !== [1, 8, 15, 22].map((d) => calendarDay(base + d * 86_400_000)).join(","))
  throw new Error(`weekly recurrence instants mismatch ${recurringDates.join(",")}`);
const overnight = await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
  bearer: lecturerToken,
  key: `overnight-${runId}`,
  body: onlineSession(at(3, 22), at(4, 2)),
});
expectStatus(overnight, 201, "cross-midnight session create");
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `overnight-overlap-${runId}`,
    body: onlineSession(at(3, 23), at(4, 1)),
  }),
  409,
  "cross-midnight overlap denied",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `tz-boundary-${runId}`,
    body: { ...offlineSession(at(5, 16), at(5, 18)), timezone: "Asia/Ho_Chi_Minh" },
  }),
  201,
  "timezone-boundary session create",
);
const cancellable = await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
  bearer: lecturerToken,
  key: `cancellable-${runId}`,
  body: offlineSession(at(6), at(6, 1)),
});
expectStatus(cancellable, 201, "cancellable session create");

// --- CLS-12 session patch -------------------------------------------------------------------------
const patched = await http("PATCH", `/api/v1/classes/${privateClass.classId}/sessions/${anchorSessionId}`, {
  bearer: lecturerToken,
  key: `patch-${runId}`,
  body: { title: "Anchor Session Revised" },
});
expectStatus(patched, 200, "DRAFT session patch");
if (patched.json.data.recordVersion !== 2 || patched.json.data.title !== "Anchor Session Revised")
  throw new Error("session patch mismatch");
const patchReplay = await http(
  "PATCH",
  `/api/v1/classes/${privateClass.classId}/sessions/${anchorSessionId}`,
  {
    bearer: lecturerToken,
    key: `patch-${runId}`,
    body: { title: "Anchor Session Revised" },
  },
);
expectStatus(patchReplay, 200, "session patch replay");
if (!patchReplay.json.meta.replayed || patchReplay.json.data.recordVersion !== 2)
  throw new Error("session patch replay mismatch");
expectStatus(
  await http("PATCH", `/api/v1/classes/${privateClass.classId}/sessions/${randomUUID()}`, {
    bearer: lecturerToken,
    key: `patch-missing-${runId}`,
    body: { title: "Nowhere Session" },
  }),
  404,
  "missing session patch denied",
);
const cancelled = await http(
  "PATCH",
  `/api/v1/classes/${privateClass.classId}/sessions/${cancellable.json.data.sessions[0].sessionId}`,
  { bearer: lecturerToken, key: `cancel-${runId}`, body: { status: "CANCELLED" } },
);
expectStatus(cancelled, 200, "DRAFT session cancellation");
if (cancelled.json.data.status !== "CANCELLED") throw new Error("session cancel mismatch");
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `overlap-cancelled-${runId}`,
    body: offlineSession(at(6), at(6, 1)),
  }),
  201,
  "cancelled slot freed",
);

// --- CLS-13/CLS-14 read paths and meetingUrl privacy ----------------------------------------------
expectStatus(
  await http("GET", `/api/v1/classes/${privateClass.classId}/sessions?from=bad&to=${calendarDay(base)}`, {
    bearer: lecturerToken,
  }),
  400,
  "invalid date param denied",
);
expectStatus(
  await http(
    "GET",
    `/api/v1/classes/${privateClass.classId}/sessions?from=${calendarDay(base + 20 * 86_400_000)}&to=${calendarDay(base)}`,
    { bearer: lecturerToken },
  ),
  400,
  "reversed date range denied",
);
expectStatus(
  await http(
    "GET",
    `/api/v1/classes/${privateClass.classId}/sessions?from=${calendarDay(Date.now())}&to=${calendarDay(base + 40 * 86_400_000)}`,
    { bearer: lecturerToken },
  ),
  400,
  "range above 31 days denied",
);
expectStatus(
  await http(
    "GET",
    `/api/v1/classes/${privateClass.classId}/sessions?from=${calendarDay(Date.now())}&to=${calendarDay(base + 25 * 86_400_000)}`,
    {
      bearer: outsiderToken,
    },
  ),
  403,
  "outsider schedule list denied",
);
expectStatus(
  await http("GET", `/api/v1/class-sessions/${anchorSessionId}`, { bearer: outsiderToken }),
  403,
  "outsider session detail denied",
);
const memberList = await http(
  "GET",
  `/api/v1/classes/${privateClass.classId}/sessions?from=${calendarDay(Date.now())}&to=${calendarDay(base + 25 * 86_400_000)}`,
  { bearer: studentToken },
);
expectStatus(memberList, 200, "member schedule list");
if (!Array.isArray(memberList.json.data) || memberList.json.data.length < 10)
  throw new Error(`member schedule list too small ${memberList.json.data?.length}`);
if (JSON.stringify(memberList.json).includes("meetingUrl"))
  throw new Error("meetingUrl leaked into schedule list");
const ownerList = await http(
  "GET",
  `/api/v1/classes/${privateClass.classId}/sessions?from=${calendarDay(Date.now())}&to=${calendarDay(base + 25 * 86_400_000)}`,
  { bearer: lecturerToken },
);
expectStatus(ownerList, 200, "owner schedule list");
const windowSessionId = windowSession.json.data.sessions[0].sessionId;
const ownerWindow = await http("GET", `/api/v1/class-sessions/${windowSessionId}`, { bearer: lecturerToken });
expectStatus(ownerWindow, 200, "owner in-window detail");
if (ownerWindow.json.data.meetingUrl !== "https://meet.example.test/window")
  throw new Error("owner in-window meetingUrl missing");
const memberWindow = await http("GET", `/api/v1/class-sessions/${windowSessionId}`, { bearer: studentToken });
expectStatus(memberWindow, 200, "member in-window detail");
if (memberWindow.json.data.meetingUrl !== "https://meet.example.test/window")
  throw new Error("member in-window meetingUrl missing");
const farDetail = await http("GET", `/api/v1/class-sessions/${anchorSessionId}`, { bearer: lecturerToken });
expectStatus(farDetail, 200, "out-of-window detail");
if (farDetail.json.data.meetingUrl !== undefined) throw new Error("meetingUrl leaked outside window");

// --- CLS-20 schedule publication --------------------------------------------------------------------
removeFixtureMembership(privateClass.classId, student.userId);
const published = await http("POST", `/api/v1/classes/${privateClass.classId}/schedule/publish`, {
  bearer: lecturerToken,
  key: `publish-private-${runId}`,
});
expectStatus(published, 200, "PRIVATE schedule publish");
if (
  published.json.data.scheduleState !== "PUBLISHED" ||
  published.json.data.scheduleVersion !== 2 ||
  published.json.data.sessionCount !== 10
)
  throw new Error(`PRIVATE publish mismatch ${JSON.stringify(published.json.data)}`);
const manifest = classroom({ action: "manifest", classId: privateClass.classId });
if (manifest.sessionCount !== 10 || manifest.scheduleVersion !== 2 || !manifest.checksum)
  throw new Error(`manifest mismatch ${JSON.stringify(manifest)}`);
const publishReplay = await http("POST", `/api/v1/classes/${privateClass.classId}/schedule/publish`, {
  bearer: lecturerToken,
  key: `publish-private-${runId}`,
});
expectStatus(publishReplay, 200, "schedule publish replay");
if (!publishReplay.json.meta.replayed || publishReplay.json.data.scheduleVersion !== 2)
  throw new Error("schedule replay bumped scheduleVersion");
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/schedule/publish`, {
    bearer: lecturerToken,
    key: `publish-private-again-${runId}`,
  }),
  409,
  "published schedule immutable",
);
expectStatus(
  await http("POST", `/api/v1/classes/${privateClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `frozen-create-${runId}`,
    body: offlineSession(at(8), at(8, 1)),
  }),
  409,
  "session create on published schedule denied",
);
expectStatus(
  await http("PATCH", `/api/v1/classes/${privateClass.classId}/sessions/${anchorSessionId}`, {
    bearer: lecturerToken,
    key: `frozen-patch-${runId}`,
    body: { title: "Frozen Edit" },
  }),
  409,
  "session edit on published schedule denied",
);
expectStatus(
  await http("PATCH", `/api/v1/classes/${privateClass.classId}/sessions/${anchorSessionId}`, {
    bearer: lecturerToken,
    key: `frozen-cancel-${runId}`,
    body: { status: "CANCELLED" },
  }),
  409,
  "SCHEDULED cancellation deferred",
);
expectStatus(
  await http("POST", "/api/v1/classes/join", {
    bearer: studentToken,
    key: `published-member-rejoin-${runId}`,
    body: { code: privateClass.joinCode },
  }),
  201,
  "P7.16 schedule-aware member rejoin",
);
const scheduledList = await http(
  "GET",
  `/api/v1/classes/${privateClass.classId}/sessions?from=${calendarDay(base)}&to=${calendarDay(base + 7 * 86_400_000)}`,
  { bearer: studentToken },
);
expectStatus(scheduledList, 200, "scheduled list read");
if (!scheduledList.json.data.every((s) => ["SCHEDULED", "CANCELLED"].includes(s.status)))
  throw new Error("published sessions did not converge to SCHEDULED");
expectStatus(
  await http("POST", "/api/v1/classes/join", {
    bearer: outsiderToken,
    key: `published-join-${runId}`,
    body: { code: privateClass.joinCode },
  }),
  201,
  "PUBLISHED schedule join uses P7.16 reservation",
);

// --- INSTITUTIONAL concurrent publish ----------------------------------------------------------------
expectStatus(
  await http("POST", `/api/v1/classes/${institutionalClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `inst-session-${runId}`,
    body: offlineSession(at(2), at(2, 2)),
  }),
  201,
  "INSTITUTIONAL session create",
);
const concurrent = await Promise.all([
  http("POST", `/api/v1/classes/${institutionalClass.classId}/schedule/publish`, {
    bearer: lecturerToken,
    key: `inst-publish-a-${runId}`,
  }),
  http("POST", `/api/v1/classes/${institutionalClass.classId}/schedule/publish`, {
    bearer: lecturerToken,
    key: `inst-publish-b-${runId}`,
  }),
]);
const wins = concurrent.filter((r) => r.status === 200),
  losses = concurrent.filter((r) => r.status === 409);
if (wins.length === 0 || wins.length + losses.length !== 2)
  throw new Error(`concurrent publish produced ${concurrent.map((r) => r.status).join(",")}`);
if (wins.length === 2 && wins[0].json.data.scheduleVersion !== wins[1].json.data.scheduleVersion)
  throw new Error("concurrent publish produced two schedule versions");
if (wins[0].json.data.scheduleVersion !== 2) throw new Error("INSTITUTIONAL scheduleVersion mismatch");

// --- Cardinality caps ----------------------------------------------------------------------------------
classroom({ action: "seed", classId: capClass.classId, count: 199, mode: "class" });
expectStatus(
  await http("POST", `/api/v1/classes/${capClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `cap-create-${runId}`,
    body: {
      ...offlineSession("2027-03-01T02:00:00.000Z", "2027-03-01T04:00:00.000Z"),
      recurrence: { frequency: "WEEKLY", interval: 1, until: "2027-03-08" },
    },
  }),
  409,
  "class above 200 sessions denied",
);
classroom({ action: "seed", classId: dateCapClass.classId, count: 100, mode: "date", date: "2026-03-01" });
expectStatus(
  await http("POST", `/api/v1/classes/${dateCapClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `date-cap-${runId}`,
    body: offlineSession("2026-03-01T05:00:00.000Z", "2026-03-01T06:00:00.000Z"),
  }),
  409,
  "date above 100 sessions denied",
);

// --- INT-CLS-08 contract -------------------------------------------------------------------------------
const liveOffering = await createOffering(lecturerToken, course.courseId, "LIVE_COHORT", liveClass.classId);
expectStatus(
  await http("POST", `/api/v1/offerings/${liveOffering.offeringId}/publish`, {
    bearer: lecturerToken,
    key: `live-publish-early-${runId}`,
  }),
  409,
  "LIVE_COHORT publish denied before published schedule",
);
const beforeContext = await directClassroom(
  `/internal/v1/classes/${liveClass.classId}/offering-context`,
  await learningServiceToken("classroom.offering-context.read"),
);
expectStatus(beforeContext, 200, "INT-CLS-08 DRAFT context");
if (
  beforeContext.json.data.scheduleState !== "DRAFT" ||
  beforeContext.json.data.sessionCount !== 0 ||
  beforeContext.json.data.classKind !== "LIVE_COHORT"
)
  throw new Error(`INT-CLS-08 DRAFT facts mismatch ${JSON.stringify(beforeContext.json.data)}`);
expectStatus(
  await http("POST", `/api/v1/classes/${liveClass.classId}/sessions`, {
    bearer: lecturerToken,
    key: `live-session-${runId}`,
    body: onlineSession(at(10), at(10, 2)),
  }),
  201,
  "LIVE_COHORT session create",
);
expectStatus(
  await http("POST", `/api/v1/classes/${liveClass.classId}/schedule/publish`, {
    bearer: lecturerToken,
    key: `live-publish-schedule-${runId}`,
  }),
  200,
  "LIVE_COHORT schedule publish",
);
expectStatus(
  await http("PATCH", `/api/v1/classes/${liveClass.classId}`, {
    bearer: lecturerToken,
    key: `link-freeze-${runId}`,
    body: { linkedCourseId: randomUUID() },
  }),
  409,
  "linkedCourseId frozen after schedule publication",
);
const afterContext = await directClassroom(
  `/internal/v1/classes/${liveClass.classId}/offering-context`,
  await learningServiceToken("classroom.offering-context.read"),
);
expectStatus(afterContext, 200, "INT-CLS-08 PUBLISHED context");
const facts = afterContext.json.data;
if (
  facts.classId !== liveClass.classId ||
  facts.linkedCourseId !== course.courseId ||
  facts.ownerLecturerId !== lecturer.userId ||
  facts.classKind !== "LIVE_COHORT" ||
  facts.classState !== "ACTIVE" ||
  facts.scheduleState !== "PUBLISHED" ||
  facts.scheduleVersion !== 2 ||
  facts.sessionCount !== 1
)
  throw new Error(`INT-CLS-08 facts mismatch ${JSON.stringify(facts)}`);
if (JSON.stringify(afterContext.json).includes("meetingUrl")) throw new Error("INT-CLS-08 leaked meetingUrl");
expectStatus(
  await directClassroom(`/internal/v1/classes/${liveClass.classId}/offering-context`),
  401,
  "INT-CLS-08 token required",
);
expectStatus(
  await directClassroom(
    `/internal/v1/classes/${liveClass.classId}/offering-context`,
    await learningServiceToken("classroom.quiz-eligibility.read"),
  ),
  401,
  "INT-CLS-08 exact purpose required",
);
expectStatus(
  await directClassroom(
    `/internal/v1/classes/${liveClass.classId}/offering-context`,
    await signedServiceToken(
      "learning",
      "dev-learning-2026-01",
      "rogue-service",
      "classroom.offering-context.read",
    ),
  ),
  403,
  "INT-CLS-08 exact caller allowlist",
);
expectStatus(
  await directClassroom(
    `/internal/v1/classes/${liveClass.classId}/offering-context`,
    await signedServiceToken(
      "assessment",
      "dev-assessment-2026-01",
      "assessment-service",
      "classroom.offering-context.read",
    ),
  ),
  401,
  "INT-CLS-08 foreign service credentials rejected",
);
expectStatus(
  await directClassroom(
    `/internal/v1/classes/${randomUUID()}/offering-context`,
    await learningServiceToken("classroom.offering-context.read"),
  ),
  404,
  "INT-CLS-08 unknown class concealed",
);

// --- LRN-26 LIVE_COHORT activation ---------------------------------------------------------------------
const activated = await http("POST", `/api/v1/offerings/${liveOffering.offeringId}/publish`, {
  bearer: lecturerToken,
  key: `live-publish-${runId}`,
});
expectStatus(activated, 200, "LIVE_COHORT offering publish");
if (activated.json.data.state !== "PUBLISHED" || activated.json.data.recordVersion !== 2)
  throw new Error("LIVE_COHORT activation mismatch");
const activatedReplay = await http("POST", `/api/v1/offerings/${liveOffering.offeringId}/publish`, {
  bearer: lecturerToken,
  key: `live-publish-${runId}`,
});
expectStatus(activatedReplay, 200, "LIVE_COHORT publish replay");
if (!activatedReplay.json.meta.replayed || activatedReplay.json.data.recordVersion !== 2)
  throw new Error("LIVE_COHORT replay bumped recordVersion");
const claim = learning({ action: "claim", classId: liveClass.classId });
if (claim.state !== "PUBLISHED" || claim.offeringId !== liveOffering.offeringId)
  throw new Error(`class claim mismatch ${JSON.stringify(claim)}`);
const secondOffering = await createOffering(lecturerToken, course.courseId, "LIVE_COHORT", liveClass.classId);
expectStatus(
  await http("POST", `/api/v1/offerings/${secondOffering.offeringId}/publish`, {
    bearer: lecturerToken,
    key: `live-publish-second-${runId}`,
  }),
  409,
  "second Offering for one Class denied",
);
expectStatus(
  await http("POST", `/api/v1/classes/${liveClass2.classId}/sessions`, {
    bearer: lecturerToken,
    key: `live2-session-${runId}`,
    body: onlineSession(at(11), at(11, 2)),
  }),
  201,
  "second LIVE_COHORT session create",
);
expectStatus(
  await http("POST", `/api/v1/classes/${liveClass2.classId}/schedule/publish`, {
    bearer: lecturerToken,
    key: `live2-schedule-${runId}`,
  }),
  200,
  "second LIVE_COHORT schedule publish",
);
const recoveryOffering = await createOffering(
  lecturerToken,
  course.courseId,
  "LIVE_COHORT",
  liveClass2.classId,
);
learning({
  action: "seedClaim",
  classId: liveClass2.classId,
  offeringId: recoveryOffering.offeringId,
  courseId: course.courseId,
});
const recovered = await http("POST", `/api/v1/offerings/${recoveryOffering.offeringId}/publish`, {
  bearer: lecturerToken,
  key: `live-publish-recovery-${runId}`,
});
expectStatus(recovered, 200, "tentative claim recovery");
const recoveryClaim = learning({ action: "claim", classId: liveClass2.classId });
if (recoveryClaim.state !== "PUBLISHED" || recoveryClaim.offeringId !== recoveryOffering.offeringId)
  throw new Error(`recovery claim mismatch ${JSON.stringify(recoveryClaim)}`);
const selfPaced = await createOffering(lecturerToken, course.courseId, "SELF_PACED");
const selfPublished = await http("POST", `/api/v1/offerings/${selfPaced.offeringId}/publish`, {
  bearer: lecturerToken,
  key: `self-publish-${runId}`,
});
expectStatus(selfPublished, 200, "SELF_PACED regression publish");
if (selfPublished.json.data.state !== "PUBLISHED") throw new Error("SELF_PACED regression mismatch");

// --- Foreign keyspace isolation --------------------------------------------------------------------------
if (!classroom({ action: "deny" }).denied)
  throw new Error("svc_classroom foreign keyspace access was not denied");
if (!learning({ action: "deny" }).denied)
  throw new Error("svc_learning foreign keyspace access was not denied");
const summary = {
  stage: "phase-7.15b-class-sessions-acceptance",
  status: "PASS",
  runId,
  privateSchedule: { classId: privateClass.classId, scheduleVersion: 2, sessionCount: 10 },
  institutionalConcurrentPublish: wins.length,
  liveCohortSchedule: { classId: liveClass.classId, scheduleVersion: 2, sessionCount: 1 },
  emptyScheduleRejected: true,
  recurrenceWeekly: 4,
  caps: { classLimit: 200, dateLimit: 100, enforced: true },
  overlap: { sameDay: true, crossMidnight: true, touchingAllowed: true },
  meetingUrlPrivacy: {
    listLeak: false,
    inWindowOwner: true,
    inWindowMember: true,
    outOfWindow: false,
    internalLeak: false,
  },
  immutablePublishedSchedule: true,
  linkedCourseFrozen: true,
  publishedJoinConflictSafe: true,
  tentativeClaimRecovery: true,
  classAlreadyOffered: true,
  selfPacedRegression: true,
  foreignKeyspaceDenied: true,
  counts: { publicApis: 98, internalApis: 15, queryIds: 74, events: 22, redis: false },
};
await writeFile(new URL("p7.15b-summary.json", evidence), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p715b-${label}-${id}@example.test`,
      password: `P7.15B-${label}-${id}-Aa1!`,
      displayName: `P715B ${label}`,
    };
  const response = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: user });
  expectStatus(response, 201, "register");
  return { ...user, userId: response.json.data.userId };
}
async function createPublishedCourse(lecturerToken, adminToken, adminPassword) {
  const created = await http("POST", "/api/v1/courses", {
    bearer: lecturerToken,
    key: `course-${runId}`,
    body: {
      title: "P715B Cohort Course",
      slug: `p715b-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "PAID",
      price: "49",
      currency: "USD",
    },
  });
  expectStatus(created, 201, "create cohort Course");
  expectStatus(
    await http("POST", `/api/v1/courses/${created.json.data.courseId}/lessons`, {
      bearer: lecturerToken,
      key: `lesson-${runId}`,
      body: {
        title: "Cohort Foundation",
        sectionTitle: "Foundation",
        position: { sectionOrder: 1, lessonOrder: 1 },
        preview: true,
      },
    }),
    201,
    "create Course lesson",
  );
  expectStatus(
    await http("POST", `/api/v1/courses/${created.json.data.courseId}/submit-review`, {
      bearer: lecturerToken,
      key: `review-${runId}`,
    }),
    202,
    "submit Course review",
  );
  expectStatus(
    await http("POST", `/api/v1/admin/courses/${created.json.data.courseId}/publish`, {
      bearer: adminToken,
      key: `publish-course-${runId}`,
      body: { currentPassword: adminPassword },
    }),
    200,
    "publish cohort Course",
  );
  return created.json.data;
}
async function createClass(token, classKind, linkedCourseId) {
  const response = await http("POST", "/api/v1/classes", {
    bearer: token,
    key: `class-${randomUUID()}`,
    body: {
      name: `P715B ${classKind} ${randomUUID().slice(0, 8)}`,
      classKind,
      ...(linkedCourseId ? { linkedCourseId } : {}),
      maxMembers: 50,
    },
  });
  expectStatus(response, 201, `create ${classKind} Class`);
  return response.json.data;
}
async function createOffering(token, courseId, offeringType, classId) {
  const response = await http("POST", `/api/v1/courses/${courseId}/offerings`, {
    bearer: token,
    key: `offering-${randomUUID()}`,
    body: {
      offeringType,
      ...(classId ? { classId } : {}),
      title: `P715B ${offeringType} Access`,
      price: "49.00",
      currency: "USD",
    },
  });
  expectStatus(response, 201, `create ${offeringType} Offering`);
  return response.json.data;
}
function onlineSession(startAt, endAt) {
  return {
    title: "Online Session",
    startAt,
    endAt,
    timezone: "UTC",
    mode: "ONLINE",
    meetingProvider: "meet",
    meetingUrl: "https://meet.example.test/room",
  };
}
function offlineSession(startAt, endAt, timezone = "UTC") {
  return { title: "Offline Session", startAt, endAt, timezone, mode: "OFFLINE", location: "Hall A" };
}
async function login(user) {
  const response = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  expectStatus(response, 200, "login");
  return response.json.data;
}
async function http(method, path, { body, bearer, key } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1)
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  throw last;
}
function expectStatus(value, status, label) {
  if (value.status !== status) throw new Error(`${label}: ${value.status} ${JSON.stringify(value.json)}`);
}
async function ready() {
  for (let index = 0; index < 120; index += 1) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // transient while the stack starts
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway unavailable");
}
function identity(input) {
  return runDb("ailss-identity-service", identityProbe(), input);
}
function classroom(input) {
  return runDb("ailss-classroom-service", classroomProbe(), input);
}
function removeFixtureMembership(classId, studentId) {
  const program = `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const r=(await x.execute("SELECT joined_at FROM membership_by_class_student WHERE class_id=? AND student_id=?",[u(i.classId),u(i.studentId)],q)).rows[0],s=(createHash("sha256").update(i.studentId).digest()[0]??0)%16;if(r){await x.execute("DELETE FROM classes_by_student WHERE student_id=? AND joined_at=? AND class_id=?",[u(i.studentId),r.get("joined_at"),u(i.classId)],q);await x.execute("DELETE FROM students_by_class WHERE class_id=? AND state='ACTIVE' AND shard=? AND joined_at=? AND student_id=?",[u(i.classId),s,r.get("joined_at"),u(i.studentId)],q);await x.execute("DELETE FROM membership_by_class_student WHERE class_id=? AND student_id=?",[u(i.classId),u(i.studentId)],q);}await x.shutdown();console.log('{"ok":true}');`;
  return runDb("ailss-classroom-service", program, { classId, studentId });
}
function learning(input) {
  return runDb("ailss-learning-service", learningProbe(), input);
}
async function learningServiceToken(purpose) {
  return signedServiceToken("learning", "dev-learning-2026-01", "learning-service", purpose);
}
async function signedServiceToken(keyName, kid, subject, purpose) {
  const pem = await readFile(
    new URL(`../../infrastructure/tls/generated/services/${keyName}-private.pem`, import.meta.url),
    "utf8",
  );
  const key = await importPKCS8(pem, "EdDSA");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "service+jwt" })
    .setIssuer("ailss-internal")
    .setAudience("classroom-service")
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(randomUUID())
    .sign(key);
}
function directClassroom(path, token) {
  const source = `const r=await fetch(${JSON.stringify(`http://127.0.0.1:8103${path}`)},{headers:${JSON.stringify(
    token
      ? { authorization: `Service ${token}`, "x-correlation-id": randomUUID() }
      : { "x-correlation-id": randomUUID() },
  )}});const t=await r.text();console.log(JSON.stringify({status:r.status,json:t?JSON.parse(t):undefined}));`;
  return JSON.parse(
    execFileSync("docker", ["exec", "ailss-classroom-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim(),
  );
}
function runDb(container, program, input) {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", program], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function identityProbe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="promote"){const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);o={ok:true};}await x.shutdown();console.log(JSON.stringify(o));`;
}
function classroomProbe() {
  return `import{readFileSync}from"node:fs";import{randomUUID}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="seed"){const now=new Date();for(let k=0;k<i.count;k++){const sid=u(randomUUID()),start=new Date(i.mode==="date"?Date.parse(i.date+"T00:00:00Z")+k*60000:Date.parse("2026-01-03T00:00:00Z")+k*3600000),end=new Date(start.getTime()+1800000);await x.execute("INSERT INTO session_by_id (session_id,class_id,title,start_at,end_at,mode,status,timezone,schedule_version,record_version,created_at,updated_at) VALUES (?,?,?,?,?,'OFFLINE','DRAFT','UTC',0,1,?,?)",[sid,u(i.classId),"Seeded",start,end,now,now],q);await x.execute("INSERT INTO sessions_by_class (class_id,start_at,session_id,end_at,status,session_version) VALUES (?,?,?,?,?,?)",[u(i.classId),start,sid,end,"DRAFT",1],q);if(i.mode==="date")await x.execute("INSERT INTO sessions_by_class_date (class_id,session_date,start_at,session_id,end_at,title,mode,status,timezone,session_version) VALUES (?,?,?,?,?,?,?,?,?,?)",[u(i.classId),c.types.LocalDate.fromString(i.date),start,sid,end,"Seeded","OFFLINE","DRAFT","UTC",1],q);}o={seeded:i.count};}else if(i.action==="manifest"){const r=(await x.execute("SELECT schedule_version,session_count,manifest_checksum FROM schedule_manifest_by_class WHERE class_id=?",[u(i.classId)],q)).rows[0];o=r?{scheduleVersion:Number(r.get("schedule_version").toString()),sessionCount:r.get("session_count"),checksum:r.get("manifest_checksum")}:null;}else if(i.action==="deny"){try{await x.execute("SELECT offering_id FROM learning_keyspace.offering_by_class LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}await x.shutdown();console.log(JSON.stringify(o));`;
}
function learningProbe() {
  return `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="seedClaim"){await x.execute("INSERT INTO offering_by_class (class_id,offering_id,course_id,state,offering_version,claimed_at) VALUES (?,?,?,'CLAIMED',?,?)",[u(i.classId),u(i.offeringId),u(i.courseId),1,new Date()],q);o={ok:true};}else if(i.action==="claim"){const r=(await x.execute("SELECT offering_id,state FROM offering_by_class WHERE class_id=?",[u(i.classId)],q)).rows[0];o=r?{offeringId:String(r.get("offering_id")),state:r.get("state")}:null;}else if(i.action==="deny"){try{await x.execute("SELECT class_id FROM classroom_keyspace.class_by_id LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}await x.shutdown();console.log(JSON.stringify(o));`;
}
