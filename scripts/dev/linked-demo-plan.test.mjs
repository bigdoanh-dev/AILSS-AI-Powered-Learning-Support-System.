import test from "node:test";
import assert from "node:assert/strict";
import { demoAnswers, selectClass, sessionPlan, pythonQuiz } from "./linked-demo-plan.mjs";

test("reuse only the unique published class joined by the student and owned by the lecturer", () => {
  const base = {
    classId: "joined",
    ownerLecturerId: "teacher",
    linkedCourseId: "course",
    name: "Demo",
    state: "ACTIVE",
    scheduleState: "PUBLISHED",
  };
  const other = { ...base, classId: "other", ownerLecturerId: "another-teacher" };
  assert.equal(selectClass([base, other], new Set(["joined", "other"]), "teacher", "course", "Demo"), base);
  assert.throws(() => selectClass([other], new Set(["other"]), "teacher", "course", "Demo"));
  assert.throws(() => selectClass([base, base], new Set(["joined"]), "teacher", "course", "Demo"));
  assert.throws(() =>
    selectClass([{ ...base, scheduleState: "DRAFT" }], new Set(["joined"]), "teacher", "course", "Demo"),
  );
});

test("submit answers rather than fabricated scores; intentionally change exactly one answer", () => {
  const questions = pythonQuiz.questions.map((question, i) => ({ ...question, questionId: String(i) }));
  const correct = demoAnswers(questions);
  const practice = demoAnswers(questions, true);
  assert.notDeepEqual(practice[0], correct[0]);
  assert.deepEqual(practice.slice(1), correct.slice(1));
  assert.equal(practice[0].selectedOptionId, "sum");
  assert.equal(practice[1].value, true);
  assert.ok(practice.every((answer) => !("score" in answer)));
  assert.throws(() => demoAnswers([{ questionId: "q", questionType: "TRUE_FALSE" }]));
  assert.throws(() => demoAnswers([]));
});

test("future local sessions skip both students' conflicting schedules and contain no fake meeting URLs", () => {
  const createdAt = "2026-10-02T18:30:00Z"; // October 3 in Vietnam.
  const conflict = { startAt: "2026-10-06T02:30:00Z", endAt: "2026-10-06T04:00:00Z" };
  const sessions = sessionPlan(createdAt, [conflict]);
  assert.equal(sessions.length, 3);
  assert.equal(sessions[0].startAt, "2026-10-07T02:00:00.000Z");
  for (const session of sessions) {
    assert.ok(Date.parse(session.startAt) > Date.parse(createdAt));
    assert.ok(
      !(
        Date.parse(session.startAt) < Date.parse(conflict.endAt) &&
        Date.parse(session.endAt) > Date.parse(conflict.startAt)
      ),
    );
    assert.equal(session.timezone, "Asia/Ho_Chi_Minh");
    assert.equal(session.mode, "OFFLINE");
    assert.ok(!("meetingUrl" in session));
  }
  assert.throws(() => sessionPlan("invalid"));
  assert.throws(() =>
    sessionPlan(createdAt, [{ startAt: "2026-01-01T00:00:00Z", endAt: "2027-01-01T00:00:00Z" }]),
  );
});
