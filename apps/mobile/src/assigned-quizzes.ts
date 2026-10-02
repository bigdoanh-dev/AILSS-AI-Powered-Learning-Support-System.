import type { RequestOptions } from "./api";
import { quizSummaries, type QuizSummary } from "./assessment";
import { studentClasses } from "./classroom";
import { courses } from "./learning";

export type AssignedQuiz = QuizSummary & { targetName?: string };

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    // Check the flag directly; React Native does not implement throwIfAborted.
    const error = new Error("Request aborted");
    error.name = "AbortError";
    throw error;
  }
}

export async function loadAssignedQuizzes(
  request: (path: string, options?: RequestOptions) => Promise<unknown>,
  signal: AbortSignal,
): Promise<AssignedQuiz[]> {
  checkCancelled(signal);
  const [courseResponse, classResponse] = await Promise.all([
    request("/api/v1/me/courses", { signal }),
    request("/api/v1/me/classes", { signal }),
  ]);
  checkCancelled(signal);
  const targets = [
    ...courses(courseResponse).map((course) => ({ type: "COURSE", id: course.courseId, name: course.title })),
    ...studentClasses(classResponse).map((group) => ({ type: "CLASS", id: group.classId, name: group.name })),
  ];
  const assigned = new Map<string, AssignedQuiz>();
  for (let offset = 0; offset < targets.length; offset += 3) {
    checkCancelled(signal);
    await Promise.all(
      targets.slice(offset, offset + 3).map(async (target) => {
        const decoded = quizSummaries(
          await request(`/api/v1/targets/${target.type}/${target.id}/quizzes`, { signal }),
        );
        for (const quiz of decoded) {
          if (quiz.state === "PUBLISHED" && quiz.targetType === target.type && quiz.targetId === target.id)
            assigned.set(quiz.quizId, { ...quiz, targetName: target.name });
        }
      }),
    );
  }
  checkCancelled(signal);
  return [...assigned.values()];
}
