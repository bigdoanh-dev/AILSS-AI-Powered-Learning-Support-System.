import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { loadAssignedQuizzes } from "../src/assigned-quizzes";

// Use the same AbortController polyfill installed by React Native, rather than
// assuming the native runtime implements every AbortSignal method available in Node.
const localRequire = createRequire(import.meta.url);
const nativeRequire = createRequire(localRequire.resolve("react-native/package.json"));
const { AbortController: NativeAbortController } = nativeRequire(
  "abort-controller/dist/abort-controller",
) as { AbortController: typeof AbortController };

describe.each([
  { runtime: "Node", Controller: AbortController },
  { runtime: "React Native", Controller: NativeAbortController },
])("assigned quizzes belong to current enrolments ($runtime)", ({ Controller }) => {
  it("loads only the student's courses and classes and excludes drafts and foreign targets", async () => {
    const quiz = (quizId: string, targetType: string, targetId: string, state = "PUBLISHED") => ({
      quizId,
      targetType,
      targetId,
      state,
      title: "Quiz",
      currentVersion: 1,
      questionCount: 2,
    });
    const request = vi.fn(async (path: string): Promise<unknown> => {
      if (path === "/api/v1/me/courses") return [{ courseId: "course-1", title: "My course" }];
      if (path === "/api/v1/me/classes") return [{ classId: "class-1", name: "My class" }];
      if (path === "/api/v1/targets/COURSE/course-1/quizzes")
        return [
          quiz("published", "COURSE", "course-1"),
          quiz("draft", "COURSE", "course-1", "DRAFT"),
          quiz("foreign", "COURSE", "course-2"),
        ];
      if (path === "/api/v1/targets/CLASS/class-1/quizzes") return [quiz("class-quiz", "CLASS", "class-1")];
      throw new Error("Unexpected unscoped request");
    });
    const quizzes = await loadAssignedQuizzes(request, new Controller().signal);
    expect(quizzes.map((quiz) => quiz.quizId).sort()).toEqual(["class-quiz", "published"]);
    expect(quizzes.find((quiz) => quiz.quizId === "class-quiz")?.targetName).toBe("My class");
    expect(request.mock.calls.some(([path]) => path === "/api/v1/classes")).toBe(false);
  });

  it("returns a real empty state for a new account without querying any sample quiz", async () => {
    const request = vi.fn(async () => []);
    expect(await loadAssignedQuizzes(request, new Controller().signal)).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects a previous account's response after its load is cancelled", async () => {
    const abort = new Controller();
    const request = vi.fn(async () => {
      abort.abort();
      return [];
    });
    await expect(loadAssignedQuizzes(request, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not request another account's enrolments when the load was already cancelled", async () => {
    const abort = new Controller();
    abort.abort();
    const request = vi.fn(async () => []);
    await expect(loadAssignedQuizzes(request, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });

  it("propagates a failed enrolment query so outages cannot masquerade as an empty account", async () => {
    const request = vi.fn(async () => {
      throw new Error("service unavailable");
    });
    await expect(loadAssignedQuizzes(request, new Controller().signal)).rejects.toThrow(
      "service unavailable",
    );
  });
});
