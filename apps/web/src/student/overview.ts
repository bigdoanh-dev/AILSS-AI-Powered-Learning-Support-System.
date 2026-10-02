import { useEffect, useState } from "react";
import { useSession } from "../auth/session";
import {
  studentRequest,
  useStudent,
  type ClassItem,
  type LearningCourse,
  type Progress,
  type Quiz,
} from "./api";

export type AssignedQuiz = Quiz & { targetType: "COURSE" | "CLASS"; targetId: string; targetTitle: string };

// Each batch is bound to the account and its exact resource list. An old response
// must never paint another account's screen, even before effect cleanup runs.
export function useStudentBatch<T>(paths: string[] | null) {
  const { profile } = useSession();
  const identity = profile?.role === "STUDENT" ? profile.userId : "";
  const pathKey = JSON.stringify(paths);
  const scope = `${identity}|${pathKey}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; data?: T[]; error?: unknown }>({ scope: "" });
  useEffect(() => {
    const controller = new AbortController();
    setResult({ scope });
    if (!identity || paths === null) return () => controller.abort();
    void (async () => {
      try {
        const data: T[] = [];
        for (let i = 0; i < paths.length; i += 3) {
          const values = await Promise.all(
            paths
              .slice(i, i + 3)
              .map(async (path) => (await studentRequest<T>(path, controller.signal)).data),
          );
          data.push(...values);
        }
        if (!controller.signal.aborted) setResult({ scope, data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ scope, error });
      }
    })();
    return () => controller.abort();
  }, [scope, revision]);
  const current = result.scope === scope ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    pending: paths === null || (!current?.data && !current?.error),
    retry: () => setRevision((value) => value + 1),
  };
}

export function useLearningOverview() {
  const courses = useStudent<LearningCourse[]>("/me/courses");
  const classes = useStudent<ClassItem[]>("/me/classes");
  const progress = useStudentBatch<Progress>(
    courses.data?.map((c) => `/courses/${c.courseId}/progress`) ?? null,
  );
  return { courses, classes, progress };
}

export function useAssignedQuizzes() {
  const courses = useStudent<LearningCourse[]>("/me/courses");
  const classes = useStudent<ClassItem[]>("/me/classes");
  const targets = [
    ...(courses.data ?? []).map((c) => ({ type: "COURSE" as const, id: c.courseId, title: c.title })),
    ...(classes.data ?? []).map((c) => ({ type: "CLASS" as const, id: c.classId, title: c.name })),
  ];
  const query = useStudentBatch<Quiz[]>(
    courses.data && classes.data
      ? targets.map((target) => `/targets/${target.type}/${target.id}/quizzes`)
      : null,
  );
  const data = query.data?.flatMap((quizzes, index) =>
    quizzes.map((quiz) => ({
      ...quiz,
      targetType: targets[index].type,
      targetId: targets[index].id,
      targetTitle: targets[index].title,
    })),
  );
  return {
    data,
    pending: courses.pending || classes.pending || query.pending,
    error: courses.error || classes.error || query.error,
    retry: () => {
      courses.retry();
      classes.retry();
      query.retry();
    },
  };
}

export function useClassAssignedQuizzes() {
  const classes = useStudent<ClassItem[]>("/me/classes");
  const targets = (classes.data ?? []).map((c) => ({
    type: "CLASS" as const,
    id: c.classId,
    title: c.name,
  }));
  const query = useStudentBatch<Quiz[]>(
    classes.data
      ? targets.map((target) => `/targets/${target.type}/${target.id}/quizzes`)
      : null,
  );
  const data = query.data?.flatMap((quizzes, index) =>
    quizzes.map((quiz) => ({
      ...quiz,
      targetType: targets[index].type,
      targetId: targets[index].id,
      targetTitle: targets[index].title,
    })),
  );
  return {
    data,
    pending: classes.pending || query.pending,
    error: classes.error || query.error,
    retry: () => {
      classes.retry();
      query.retry();
    },
  };
}
