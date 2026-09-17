export interface LessonProgressState {
  readonly lessonId: string;
  readonly completed: boolean;
  readonly progressPercent: number; // 0 to 100
  readonly timeSpentSeconds: number;
  readonly lastWatchedPositionSeconds?: number;
  readonly updatedAt: string;
}

export interface CourseProgressSnapshot {
  readonly courseId: string;
  readonly studentId: string;
  readonly completedLessonIds: readonly string[];
  readonly lessonProgress: Record<string, LessonProgressState>;
  readonly lastActiveLessonId?: string;
  readonly overallProgressPercent: number;
  readonly updatedAt: string;
}

export interface QueuedOfflineProgressUpdate {
  readonly updateId: string;
  readonly courseId: string;
  readonly lessonId: string;
  readonly completed?: boolean;
  readonly progressPercent?: number;
  readonly timeSpentDeltaSeconds?: number;
  readonly watchedPositionSeconds?: number;
  readonly timestamp: string;
}

export interface SyncResult {
  readonly synced: boolean;
  readonly mergedSnapshot: CourseProgressSnapshot;
  readonly pendingQueueSize: number;
}

/**
 * CRDT Union Merge Algorithm for Course Learning Progress.
 * Properties:
 * 1. Monotonicity: Completed status is grow-only (completed once = completed forever).
 * 2. Max-register: Progress percentage and watch positions take the supremum (max).
 * 3. Additive delta: Time spent is accumulated.
 * 4. Commutative & Associative: merge(A, B) == merge(B, A).
 */
export function mergeCourseProgressCrdt(
  local: CourseProgressSnapshot,
  remote: CourseProgressSnapshot,
): CourseProgressSnapshot {
  if (local.courseId !== remote.courseId) {
    throw new Error(`Cannot merge progress for mismatched courses: ${local.courseId} vs ${remote.courseId}`);
  }

  // 1. Grow-Only Set Union of completedLessonIds
  const completedSet = new Set<string>([
    ...local.completedLessonIds,
    ...remote.completedLessonIds,
  ]);

  // 2. Union and max-register reconciliation of individual lessons
  const mergedLessons: Record<string, LessonProgressState> = {};
  const allLessonIds = new Set<string>([
    ...Object.keys(local.lessonProgress),
    ...Object.keys(remote.lessonProgress),
  ]);

  for (const lessonId of allLessonIds) {
    const loc = local.lessonProgress[lessonId];
    const rem = remote.lessonProgress[lessonId];

    if (loc && rem) {
      const isCompleted = loc.completed || rem.completed || completedSet.has(lessonId);
      const maxProgress = Math.max(loc.progressPercent, rem.progressPercent, isCompleted ? 100 : 0);
      const totalTime = Math.max(loc.timeSpentSeconds, rem.timeSpentSeconds);
      const maxPosition = Math.max(
        loc.lastWatchedPositionSeconds ?? 0,
        rem.lastWatchedPositionSeconds ?? 0,
      );
      const latestUpdated = loc.updatedAt > rem.updatedAt ? loc.updatedAt : rem.updatedAt;

      mergedLessons[lessonId] = {
        lessonId,
        completed: isCompleted,
        progressPercent: maxProgress,
        timeSpentSeconds: totalTime,
        ...(maxPosition > 0 ? { lastWatchedPositionSeconds: maxPosition } : {}),
        updatedAt: latestUpdated,
      };

      if (isCompleted) {
        completedSet.add(lessonId);
      }
    } else if (loc) {
      mergedLessons[lessonId] = loc;
      if (loc.completed) {
        completedSet.add(lessonId);
      }
    } else if (rem) {
      mergedLessons[lessonId] = rem;
      if (rem.completed) {
        completedSet.add(lessonId);
      }
    }
  }

  // 3. Compute overall progress percent
  const totalLessons = allLessonIds.size;
  const overallPercent =
    totalLessons === 0
      ? 0
      : Math.round(
          (Object.values(mergedLessons).reduce((acc, l) => acc + l.progressPercent, 0) /
            (totalLessons * 100)) *
            100,
        );

  const latestOverallTime = local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt;
  const activeLesson =
    local.updatedAt > remote.updatedAt
      ? (local.lastActiveLessonId ?? remote.lastActiveLessonId)
      : (remote.lastActiveLessonId ?? local.lastActiveLessonId);

  return {
    courseId: local.courseId,
    studentId: local.studentId,
    completedLessonIds: Array.from(completedSet).sort(),
    lessonProgress: mergedLessons,
    ...(activeLesson !== undefined ? { lastActiveLessonId: activeLesson } : {}),
    overallProgressPercent: overallPercent,
    updatedAt: latestOverallTime,
  };
}

/**
 * Mobile Offline Progress Sync Queue
 */
export class OfflineProgressSyncQueue {
  readonly #queue: QueuedOfflineProgressUpdate[] = [];
  #currentSnapshot: CourseProgressSnapshot;

  public constructor(initialSnapshot: CourseProgressSnapshot) {
    this.#currentSnapshot = initialSnapshot;
  }

  public get snapshot(): CourseProgressSnapshot {
    return this.#currentSnapshot;
  }

  public get pendingQueue(): readonly QueuedOfflineProgressUpdate[] {
    return this.#queue;
  }

  /**
   * Records progress offline, immediately applying it locally via CRDT rules
   * and enqueuing it for remote server synchronization.
   */
  public recordOfflineUpdate(update: QueuedOfflineProgressUpdate): CourseProgressSnapshot {
    this.#queue.push(update);

    const existing = this.#currentSnapshot.lessonProgress[update.lessonId];
    const isCompleted = Boolean(update.completed) || Boolean(existing?.completed);
    const progressPercent = Math.max(
      existing?.progressPercent ?? 0,
      update.progressPercent ?? 0,
      isCompleted ? 100 : 0,
    );
    const timeSpent = (existing?.timeSpentSeconds ?? 0) + (update.timeSpentDeltaSeconds ?? 0);
    const watchedPos = Math.max(
      existing?.lastWatchedPositionSeconds ?? 0,
      update.watchedPositionSeconds ?? 0,
    );

    const updatedLesson: LessonProgressState = {
      lessonId: update.lessonId,
      completed: isCompleted,
      progressPercent,
      timeSpentSeconds: timeSpent,
      ...(watchedPos > 0 ? { lastWatchedPositionSeconds: watchedPos } : {}),
      updatedAt: update.timestamp,
    };

    const completedSet = new Set(this.#currentSnapshot.completedLessonIds);
    if (isCompleted) {
      completedSet.add(update.lessonId);
    }

    const newLessonProgress = {
      ...this.#currentSnapshot.lessonProgress,
      [update.lessonId]: updatedLesson,
    };

    const totalCount = Object.keys(newLessonProgress).length;
    const totalPercentSum = Object.values(newLessonProgress).reduce(
      (acc, l) => acc + l.progressPercent,
      0,
    );
    const overallProgressPercent =
      totalCount === 0 ? 0 : Math.round((totalPercentSum / (totalCount * 100)) * 100);

    this.#currentSnapshot = {
      ...this.#currentSnapshot,
      completedLessonIds: Array.from(completedSet).sort(),
      lessonProgress: newLessonProgress,
      lastActiveLessonId: update.lessonId,
      overallProgressPercent,
      updatedAt: update.timestamp,
    };

    return this.#currentSnapshot;
  }

  /**
   * Flushes queue against remote server API and performs 2-way CRDT reconciliation.
   */
  public async flush(
    apiSync: (
      updates: readonly QueuedOfflineProgressUpdate[],
    ) => Promise<{ serverSnapshot: CourseProgressSnapshot }>,
  ): Promise<SyncResult> {
    if (this.#queue.length === 0) {
      return {
        synced: true,
        mergedSnapshot: this.#currentSnapshot,
        pendingQueueSize: 0,
      };
    }

    const inFlightUpdates = [...this.#queue];
    const { serverSnapshot } = await apiSync(inFlightUpdates);

    // Merge server response with current local state
    this.#currentSnapshot = mergeCourseProgressCrdt(this.#currentSnapshot, serverSnapshot);

    // Evict successfully synced mutations
    this.#queue.splice(0, inFlightUpdates.length);

    return {
      synced: true,
      mergedSnapshot: this.#currentSnapshot,
      pendingQueueSize: this.#queue.length,
    };
  }
}
