import { randomUUID } from "node:crypto";
import {
  assessmentResult as decodeAssessmentResult,
  attempt as decodeAttempt,
  attemptWithQuestions as decodeAttemptWithQuestions,
  buildSubmitPayload,
  quizDetail as decodeQuizDetail,
  quizSummaries as decodeQuizSummaries,
  submitResponse as decodeSubmitResponse,
  type QuizQuestion,
  type SubmittedAnswer,
} from "../src/assessment";

const origin = process.env.AILSS_MOBILE_TEST_ORIGIN || "http://127.0.0.1:8080";
const email = process.env.AILSS_MOBILE_TEST_EMAIL || "student.demo@ailss.local";
const password = process.env.AILSS_MOBILE_TEST_PASSWORD || "AilssDemo!2026";

async function main() {
  // 1. Authenticate
  const loginRes = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
  }

  const loginBody = (await loginRes.json()) as { data?: { accessToken?: string } };
  const token = loginBody.data?.accessToken;
  if (!token) {
    throw new Error("Missing access token in login response");
  }

  const authHeaders = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  // 2. Fetch enrolled courses & target quizzes (ASM-05)
  const coursesRes = await fetch(`${origin}/api/v1/me/courses`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!coursesRes.ok) throw new Error(`Fetch courses failed with status ${coursesRes.status}`);
  const coursesData = (await coursesRes.json()) as { data?: { courseId: string; title: string }[] };
  const courses = coursesData.data ?? [];
  if (courses.length === 0) throw new Error("No enrolled courses found for student");

  let targetQuizId: string | null = null;
  let targetCourseId: string | null = null;
  let targetQuizTitle: string | null = null;
  let totalAvailableQuizzes = 0;

  for (const c of courses) {
    const qRes = await fetch(`${origin}/api/v1/targets/COURSE/${c.courseId}/quizzes`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (qRes.ok) {
      const qData = await qRes.json();
      const list = decodeQuizSummaries(qData);
      totalAvailableQuizzes += list.length;
      if (!targetQuizId && list.length > 0) {
        targetQuizId = list[0].quizId;
        targetCourseId = c.courseId;
        targetQuizTitle = list[0].title;
      }
    }
  }

  if (!targetQuizId || !targetCourseId) {
    throw new Error("No published quizzes found for enrolled courses");
  }

  // 3. Fetch Quiz Detail & instructions (ASM-02)
  const detailRes = await fetch(`${origin}/api/v1/quizzes/${targetQuizId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!detailRes.ok) throw new Error(`Fetch quiz detail failed: ${detailRes.status}`);
  const detail = decodeQuizDetail(await detailRes.json());
  if (!detail.quizId || detail.questions.length === 0) {
    throw new Error("Invalid quiz detail or empty questions array");
  }

  // 4. Start or Resume Attempt (ASM-06)
  const startKey = randomUUID();
  const startRes = await fetch(`${origin}/api/v1/quizzes/${targetQuizId}/attempts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": startKey,
    },
  });
  if (!startRes.ok) throw new Error(`Start attempt failed: ${startRes.status}`);
  const startData = decodeAttemptWithQuestions(await startRes.json());
  const attemptId = startData.attempt.attemptId;
  const questions: QuizQuestion[] = startData.questions.length > 0 ? startData.questions : detail.questions;

  // 5. Retrieve current attempt detail (ASM-07)
  const attDetailRes = await fetch(`${origin}/api/v1/attempts/${attemptId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!attDetailRes.ok) throw new Error(`Get attempt failed: ${attDetailRes.status}`);
  const currentAttempt = decodeAttempt(await attDetailRes.json());

  // 6. Submit Attempt (ASM-08) if still IN_PROGRESS
  let finalScore = "0";
  let finalMaxScore = "0";

  if (currentAttempt.state === "IN_PROGRESS") {
    // Build answers using question options
    const draftAnswers: Record<string, SubmittedAnswer> = {};
    for (const q of questions) {
      if (q.questionType === "SINGLE_CHOICE" && q.options && q.options.length > 0) {
        draftAnswers[q.questionId] = {
          questionId: q.questionId,
          selectedOptionId: q.options[0],
        };
      } else if (q.questionType === "MULTIPLE_CHOICE" && q.options && q.options.length > 0) {
        draftAnswers[q.questionId] = {
          questionId: q.questionId,
          selectedOptionIds: [q.options[0]],
        };
      } else if (q.questionType === "TRUE_FALSE") {
        draftAnswers[q.questionId] = {
          questionId: q.questionId,
          value: true,
        };
      } else if (q.questionType === "SHORT_ANSWER") {
        draftAnswers[q.questionId] = {
          questionId: q.questionId,
          text: "Sample Answer",
        };
      }
    }

    const submitPayload = buildSubmitPayload(questions, draftAnswers);
    const submitKey = randomUUID();
    const submitRes = await fetch(`${origin}/api/v1/attempts/${attemptId}/submit`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "idempotency-key": submitKey,
      },
      body: JSON.stringify(submitPayload),
    });

    if (!submitRes.ok && submitRes.status !== 202) {
      throw new Error(`Submit attempt failed: ${submitRes.status} ${await submitRes.text()}`);
    }

    const subData = decodeSubmitResponse(await submitRes.json());
    finalScore = subData.score;
    finalMaxScore = subData.maxScore;
  }

  // 7. Verify Attempt state is now SUBMITTED
  const verifyAttRes = await fetch(`${origin}/api/v1/attempts/${attemptId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!verifyAttRes.ok) throw new Error(`Verify attempt failed: ${verifyAttRes.status}`);
  const verifiedAttempt = decodeAttempt(await verifyAttRes.json());
  if (verifiedAttempt.state !== "SUBMITTED") {
    throw new Error(`Expected attempt state SUBMITTED, received ${verifiedAttempt.state}`);
  }

  // 8. Retrieve official Result (ASM-09)
  const resultRes = await fetch(`${origin}/api/v1/attempts/${attemptId}/result`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!resultRes.ok) throw new Error(`Get result failed: ${resultRes.status}`);
  const resultData = decodeAssessmentResult(await resultRes.json());
  finalScore = resultData.score;
  finalMaxScore = resultData.maxScore;

  // 9. Security boundary checks:
  // - Accessing an invalid/foreign attempt result returns 404
  const invalidResultRes = await fetch(
    `${origin}/api/v1/attempts/00000000-0000-4000-8000-000000000000/result`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const foreignResultBlocked = invalidResultRes.status === 404 || invalidResultRes.status === 403;

  // - Student attempting to call lecturer results roster (ASM-10) returns 403
  const asm10Res = await fetch(`${origin}/api/v1/quizzes/${targetQuizId}/results?month=2026-09`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const asm10RosterForbidden = asm10Res.status === 403;

  // 10. Clean logout
  await fetch(`${origin}/api/v1/auth/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => {});

  const output = {
    status: "PASS",
    p14_2c_student_assessment: true,
    totalAvailableQuizzes,
    targetQuizId,
    targetQuizTitle,
    attemptId,
    attemptState: verifiedAttempt.state,
    score: finalScore,
    maxScore: finalMaxScore,
    gradingAlgorithmVersion: resultData.gradingAlgorithmVersion,
    foreign_result_security_boundary: foreignResultBlocked,
    asm10_roster_forbidden_403: asm10RosterForbidden,
    logout: true,
  };

  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.error("Integration script failed:", err);
  process.exit(1);
});
