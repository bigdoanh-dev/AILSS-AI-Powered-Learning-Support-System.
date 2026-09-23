import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";
import { masteryRecords, studyPlan, type MasteryRecord, type StudyPlan } from "./adaptive";
import { courses as decodeCourses, type Course } from "./learning";
import type { Session, Startup } from "./session";
import { offlineStore } from "./runtime";
import { subscribeLessonSync } from "./lesson-sync";

export type DataSource = "LIVE" | "OFFLINE_CACHE";
export interface CourseLearningData {
  course: Course;
  mastery: MasteryRecord[] | null;
  masteryError?: string;
  masterySource: DataSource;
  masterySyncedAt?: string;
  studyPlan: StudyPlan | null;
  studyPlanError?: string;
  studyPlanSource: DataSource;
  studyPlanSyncedAt?: string;
}
function canUseCache(error: unknown): boolean {
  return error instanceof ApiError && ["network", "timeout", "server", "429"].includes(error.kind);
}
function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useStudentLearning(session: Session, userId?: string, authState: Startup = "AUTHENTICATED") {
  const [courses, setCourses] = useState<CourseLearningData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>("LIVE");
  const [courseSyncedAt, setCourseSyncedAt] = useState<string | undefined>();
  const [loadedFor, setLoadedFor] = useState<string | undefined>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(
    () =>
      subscribeLessonSync((syncedUserId) => {
        if (syncedUserId === userId) refresh();
      }),
    [refresh, userId],
  );

  useEffect(() => {
    const abort = new AbortController();
    const store = offlineStore;
    if (!userId || !store) {
      setCourses([]);
      setError(null);
      setDataSource("LIVE");
      setCourseSyncedAt(undefined);
      setLoadedFor(undefined);
      setLoading(false);
      return () => abort.abort();
    }
    // Do not paint the preceding account's cached rows while the next account loads.
    setLoadedFor(userId);
    setCourses([]);
    setDataSource("LIVE");
    setCourseSyncedAt(undefined);
    setLoading(true);
    setError(null);
    void (async () => {
      let enrolled: Course[];
      let courseSource: DataSource = authState === "OFFLINE_CACHE" ? "OFFLINE_CACHE" : "LIVE";
      let courseSyncedAt: string | undefined;
      try {
        if (authState === "OFFLINE_CACHE") throw new ApiError("network");
        enrolled = decodeCourses(await session.request("/api/v1/me/courses", { signal: abort.signal }));
        courseSyncedAt = await store.writeCache(userId, "COURSES", "__all__", enrolled).catch(() => undefined);
      } catch (reason) {
        if (authState !== "OFFLINE_CACHE" && !canUseCache(reason)) {
          if (!abort.signal.aborted) setError(errorText(reason, "Không tải được không gian học tập."));
          return;
        }
        const cached = await store.readCache<unknown>(userId, "COURSES", "__all__");
        if (!cached) {
          if (!abort.signal.aborted)
            setError(authState === "OFFLINE_CACHE" ? "Chưa có khóa học được đồng bộ trên thiết bị này." : errorText(reason, "Không tải được không gian học tập."));
          return;
        }
        enrolled = decodeCourses(cached.value);
        courseSource = "OFFLINE_CACHE";
        courseSyncedAt = cached.syncedAt;
      }
      const data = await Promise.all(
        enrolled.map(async (course): Promise<CourseLearningData> => {
          const [masteryResult, planResult] = await Promise.allSettled([
            (async () => {
              if (authState === "OFFLINE_CACHE") throw new ApiError("network");
              const value = masteryRecords(
                await session.request(`/api/v1/mastery/courses/${encodeURIComponent(course.courseId)}`, {
                  signal: abort.signal,
                }),
              );
              const syncedAt = await store.writeCache(userId, "MASTERY", course.courseId, value).catch(() => "");
              return { value, source: "LIVE" as const, syncedAt };
            })(),
            (async () => {
              if (authState === "OFFLINE_CACHE") throw new ApiError("network");
              const value = studyPlan(
                await session.request(`/api/v1/study-plan/current?courseId=${encodeURIComponent(course.courseId)}`, {
                  signal: abort.signal,
                }),
              );
              const syncedAt = await store.writeCache(userId, "STUDY_PLAN", course.courseId, value).catch(() => "");
              return { value, source: "LIVE" as const, syncedAt };
            })(),
          ]);
          let mastery: MasteryRecord[] | null = null;
          let masterySource: DataSource = "LIVE";
          let masterySyncedAt: string | undefined;
          let masteryError: string | undefined;
          if (masteryResult.status === "fulfilled") {
            ({ value: mastery, source: masterySource, syncedAt: masterySyncedAt } = masteryResult.value);
          } else if (authState === "OFFLINE_CACHE" || canUseCache(masteryResult.reason)) {
            const cached = await store.readCache<unknown>(userId, "MASTERY", course.courseId);
            if (cached) {
              mastery = masteryRecords(cached.value);
              masterySource = "OFFLINE_CACHE";
              masterySyncedAt = cached.syncedAt;
            } else {
              masteryError = authState === "OFFLINE_CACHE"
                ? "Chưa có Mastery snapshot được đồng bộ trên thiết bị này."
                : errorText(masteryResult.reason, "Không tải được Mastery.");
            }
          } else {
            masteryError = errorText(masteryResult.reason, "Không tải được Mastery.");
          }
          let currentPlan: StudyPlan | null = null;
          let studyPlanSource: DataSource = "LIVE";
          let studyPlanSyncedAt: string | undefined;
          let studyPlanError: string | undefined;
          const missingPlan =
            planResult.status === "rejected" && planResult.reason instanceof ApiError && planResult.reason.status === 404;
          if (planResult.status === "fulfilled") {
            ({ value: currentPlan, source: studyPlanSource, syncedAt: studyPlanSyncedAt } = planResult.value);
          } else if (missingPlan && authState !== "OFFLINE_CACHE") {
            await store.deleteCache(userId, "STUDY_PLAN", course.courseId);
          } else if (authState === "OFFLINE_CACHE" || canUseCache(planResult.reason)) {
            const cached = await store.readCache<unknown>(userId, "STUDY_PLAN", course.courseId);
            if (cached) {
              currentPlan = studyPlan(cached.value);
              studyPlanSource = "OFFLINE_CACHE";
              studyPlanSyncedAt = cached.syncedAt;
            } else {
              studyPlanError = authState === "OFFLINE_CACHE"
                ? "Chưa có Study Plan snapshot được đồng bộ trên thiết bị này."
                : errorText(planResult.reason, "Không tải được Study Plan.");
            }
          } else {
            studyPlanError = errorText(planResult.reason, "Không tải được Study Plan.");
          }
          return {
            course,
            mastery,
            ...(masteryError ? { masteryError } : {}),
            masterySource,
            ...(masterySyncedAt ? { masterySyncedAt } : {}),
            studyPlan: currentPlan,
            ...(studyPlanError ? { studyPlanError } : {}),
            studyPlanSource,
            ...(studyPlanSyncedAt ? { studyPlanSyncedAt } : {}),
          };
        }),
      );
      if (!abort.signal.aborted) {
        setCourses(data);
        setDataSource(courseSource);
        setCourseSyncedAt(courseSyncedAt);
        // Preserve aggregate metadata without pretending cached rows are live.
        if (courseSource === "OFFLINE_CACHE" && data.length === 0 && !courseSyncedAt) {
          setError("Chưa có khóa học được đồng bộ trên thiết bị này.");
        }
      }
    })()
      .catch((reason: unknown) => {
        if (!abort.signal.aborted) setError(errorText(reason, "Không tải được không gian học tập."));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [authState, session, userId, revision]);

  const scopedCourses = loadedFor === userId ? courses : [];
  const scopedSource: DataSource = loadedFor === userId ? dataSource : "LIVE";
  const source: DataSource = scopedCourses.some(
    (item) => item.masterySource === "OFFLINE_CACHE" || item.studyPlanSource === "OFFLINE_CACHE",
  )
    ? "OFFLINE_CACHE"
    : authState === "OFFLINE_CACHE"
      ? "OFFLINE_CACHE"
      : "LIVE";
  return {
    courses: scopedCourses,
    loading: loadedFor === userId ? loading : Boolean(userId),
    error: loadedFor === userId ? error : null,
    refresh,
    source: scopedSource === "OFFLINE_CACHE" ? "OFFLINE_CACHE" : source,
    courseSource: scopedSource,
    courseSyncedAt: loadedFor === userId ? courseSyncedAt : undefined,
  };
}
