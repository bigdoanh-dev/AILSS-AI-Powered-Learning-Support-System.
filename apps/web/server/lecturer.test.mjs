import assert from "node:assert/strict";
import test from "node:test";
import { lecturerEnvelope, lecturerOperation } from "./lecturer.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const command = { "idempotency-key": "logical-command-1" };

test("Lecturer allowlist accepts documented reads and commands", () => {
  assert.equal(
    lecturerOperation("/web-session/lecturer/me/owned-courses", "GET", undefined, {}).path,
    "/me/owned-courses",
  );
  assert.equal(
    lecturerOperation(`/web-session/lecturer/me/courses/${id}`, "GET", undefined, {}).path,
    `/me/courses/${id}`,
  );
  assert.equal(
    lecturerOperation(`/web-session/lecturer/courses/${id}/retire`, "POST", { mode: "LOCK" }, command).path,
    `/courses/${id}/retire`,
  );
  assert.throws(() =>
    lecturerOperation(
      `/web-session/lecturer/courses/${id}/retire`,
      "POST",
      { mode: "DELETE", studentId: id },
      command,
    ),
  );
  assert.equal(
    lecturerOperation("/web-session/lecturer/me/owned-classes", "GET", undefined, {}).path,
    "/me/owned-classes",
  );
  assert.equal(
    lecturerOperation(
      `/web-session/lecturer/classes/${id}/announcements?month=2026-09-01`,
      "GET",
      undefined,
      {},
    ).path,
    `/classes/${id}/announcements?month=2026-09-01`,
  );
  assert.equal(
    lecturerOperation(`/web-session/lecturer/courses/${id}/reviews`, "GET", undefined, {}).path,
    `/courses/${id}/reviews`,
  );
  assert.equal(
    lecturerOperation(`/web-session/lecturer/classes/${id}/join-code/reset`, "POST", {}, command).path,
    `/classes/${id}/join-code/reset`,
  );
  assert.equal(
    lecturerOperation(
      `/web-session/lecturer/classes/${id}/members/${id}/warnings`,
      "POST",
      { reason: "Đi học đúng giờ" },
      command,
    ).path,
    `/classes/${id}/members/${id}/warnings`,
  );
  assert.equal(
    lecturerOperation(`/web-session/lecturer/classes/${id}/members/${id}`, "DELETE", {}, command).path,
    `/classes/${id}/members/${id}`,
  );
  assert.throws(() =>
    lecturerOperation(
      `/web-session/lecturer/classes/${id}/members/${id}/warnings`,
      "POST",
      { reason: "x" },
      command,
    ),
  );
});

test("Lecturer allowlist rejects undocumented routes, duplicate query and missing command key", () => {
  assert.throws(() => lecturerOperation("/web-session/lecturer/me/courses", "GET", undefined, {}));
  assert.throws(() =>
    lecturerOperation(
      `/web-session/lecturer/quizzes/${id}/results?month=2026-09&month=2026-08`,
      "GET",
      undefined,
      {},
    ),
  );
  assert.throws(() => lecturerOperation(`/web-session/lecturer/quizzes/${id}/publish`, "POST", {}, {}));
});

test("Lecturer payout account route accepts bank details and rejects card data", () => {
  const path = "/web-session/lecturer/me/payout-account";
  assert.equal(lecturerOperation(path, "GET", undefined, {}).path, "/me/payout-account");
  const bank = { bankName: "Ngân hàng A", accountNumber: "1234567890", accountHolder: "NGUYEN VAN A" };
  assert.equal(lecturerOperation(path, "POST", bank, command).path, "/me/payout-account");
  assert.throws(() => lecturerOperation(path, "POST", { ...bank, cardNumber: "4111111111111111" }, command));
});

test("manual attendance forwards only a validated optimistic version", () => {
  const operation = lecturerOperation(
    `/web-session/lecturer/class-sessions/${id}/attendance/${id}`,
    "PUT",
    { attendanceStatus: "EXCUSED", note: "Có phép" },
    { ...command, "if-match": '"v3"' },
  );
  assert.deepEqual(operation.headers, { "If-Match": '"v3"' });
  assert.throws(() =>
    lecturerOperation(
      `/web-session/lecturer/class-sessions/${id}/attendance/${id}`,
      "PUT",
      { attendanceStatus: "PRESENT" },
      { ...command, "if-match": "3" },
    ),
  );
});

test("Lecturer envelope preserves pagination and fails closed on credentials", () => {
  assert.deepEqual(
    lecturerEnvelope({ data: [{ classId: id }], meta: { page: { nextCursor: "next" }, ignored: true } }),
    {
      data: [{ classId: id }],
      meta: { page: { nextCursor: "next" } },
    },
  );
  assert.throws(
    () => lecturerEnvelope({ data: { nested: { serviceToken: "secret" } } }),
    /UNSAFE_LECTURER_RESPONSE/,
  );
  for (const key of ["rawProviderResponse", "providerCredential", "secretAccessKey", "actorContext"])
    assert.throws(() => lecturerEnvelope({ data: { [key]: "secret" } }), /UNSAFE_LECTURER_RESPONSE/);
});

test("AI distribution survives the BFF and rejects mismatched totals", () => {
  const cognitiveDistribution = { RECOGNITION: 2, UNDERSTANDING: 3, APPLICATION: 3, ADVANCED_APPLICATION: 2 };
  const body = {
    documentId: id,
    targetId: id,
    targetType: "COURSE",
    questionCount: 10,
    questionTypes: ["SINGLE_CHOICE"],
    difficulty: "MEDIUM",
    cognitiveDistribution,
  };
  const operation = lecturerOperation("/web-session/lecturer/ai/quiz-jobs", "POST", body, command);
  assert.equal(operation.path, "/ai/quiz-jobs");
  assert.throws(() =>
    lecturerOperation("/web-session/lecturer/ai/quiz-jobs", "POST", { ...body, questionCount: 9 }, command),
  );
});

test("course authoring accepts lecturer-entered category names", () => {
  const body = {
    title: "Thiết kế đồ họa",
    slug: "thiet-ke-do-hoa",
    categoryName: "Thiết kế",
    priceType: "FREE",
    price: "0",
    currency: "VND",
  };
  const created = lecturerOperation("/web-session/lecturer/courses", "POST", body, command);
  assert.equal(created.path, "/courses");
  const patched = lecturerOperation(
    `/web-session/lecturer/courses/${id}`,
    "PATCH",
    { categoryName: "Hội họa" },
    { ...command, "if-match": '"v1"' },
  );
  assert.equal(patched.path, `/courses/${id}`);
  const missingCategory = { ...body };
  delete missingCategory.categoryName;
  assert.throws(() => lecturerOperation("/web-session/lecturer/courses", "POST", missingCategory, command));
});

test("class management permits image updates and an idempotent delete", () => {
  const path = `/web-session/lecturer/classes/${id}`;
  assert.equal(lecturerOperation(path, "PATCH", { photoDataUrl: null }, command).path, `/classes/${id}`);
  assert.equal(lecturerOperation(path, "PATCH", { coverDataUrl: null }, command).path, `/classes/${id}`);
  assert.equal(lecturerOperation(path, "DELETE", {}, command).path, `/classes/${id}`);
  assert.throws(() => lecturerOperation(path, "DELETE", {}, {}));
});

test("manual grades persist only a validated score and result version", () => {
  const path = `/web-session/lecturer/quizzes/${id}/grades/${id}`;
  const body = { score: "8.5", feedback: "Nhận xét", expectedResultVersion: 3 };
  assert.equal(lecturerOperation(path, "POST", body, command).path, `/quizzes/${id}/grades/${id}`);
  assert.throws(() => lecturerOperation(path, "POST", { ...body, studentId: id }, command));
  assert.throws(() => lecturerOperation(path, "POST", { ...body, score: "101" }, command));
});
test("quiz deadline can be persisted or cleared without browser storage", () => {
  const path = `/web-session/lecturer/quizzes/${id}`;
  assert.equal(lecturerOperation(path, "PATCH", { closesAt: null }, command).path, `/quizzes/${id}`);
});
