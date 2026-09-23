import { ApiError } from "./api";
import type { LessonCompletionOperation, OfflineStore } from "./offline-store";
import type { Session } from "./session";

type ChangedListener = (userId: string, courseId: string) => void;
const listeners = new Set<ChangedListener>();
const activeSyncs = new Map<string, Promise<void>>();

export function subscribeLessonSync(listener: ChangedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyLessonCompletionChanged(userId: string, courseId: string): void {
  listeners.forEach((listener) => listener(userId, courseId));
}

function retryable(error: unknown): boolean {
  return error instanceof ApiError && ["network", "timeout", "server", "429", "cancelled"].includes(error.kind);
}

export async function syncPendingLessonCompletions(
  session: Session,
  userId: string,
  store: OfflineStore | null,
): Promise<void> {
  if (!store || session.snapshot.state !== "AUTHENTICATED" || session.snapshot.user?.userId !== userId) return;
  const running = activeSyncs.get(userId);
  if (running) return running;
  const work = syncForUser(session, userId, store).finally(() => activeSyncs.delete(userId));
  activeSyncs.set(userId, work);
  return work;
}

async function syncForUser(session: Session, userId: string, store: OfflineStore): Promise<void> {
  const operations = await store.listQueueableCompletions(userId);
  for (const operation of operations) {
    await store.setCompletionState(userId, operation.operationId, "SYNCING", { incrementAttempt: true });
    try {
      await session.request(`/api/v1/lessons/${encodeURIComponent(operation.resourceId)}/completion`, {
        method: "PUT",
        body: { completed: true },
        idempotencyKey: operation.idempotencyKey,
      });
      await store.setCompletionState(userId, operation.operationId, "SYNCED");
      notifyLessonCompletionChanged(userId, operation.courseId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          // Re-read the current server projection; a conflict is never overwritten by a generic local write.
          await session.request(`/api/v1/courses/${encodeURIComponent(operation.courseId)}/progress`);
          await store.setCompletionState(userId, operation.operationId, "CONFLICT", {
            errorCode: "SERVER_STATE_CHANGED",
          });
          notifyLessonCompletionChanged(userId, operation.courseId);
        } catch (readError) {
          await store.setCompletionState(
            userId,
            operation.operationId,
            retryable(readError) ? "FAILED_RETRYABLE" : "FAILED_FINAL",
            { errorCode: retryable(readError) ? "CONFLICT_READ_UNAVAILABLE" : "CONFLICT_READ_REJECTED" },
          );
        }
      } else if (retryable(error)) {
        await store.setCompletionState(userId, operation.operationId, "FAILED_RETRYABLE", {
          errorCode: error instanceof ApiError ? error.kind.toUpperCase() : "RETRYABLE",
        });
      } else {
        await store.setCompletionState(userId, operation.operationId, "FAILED_FINAL", {
          errorCode: error instanceof ApiError ? `HTTP_${error.status}` : "REJECTED",
        });
      }
    }
  }
}

export function queueOperationInput(
  operation: Pick<LessonCompletionOperation, "operationId" | "userId" | "courseId" | "resourceId" | "idempotencyKey">,
) {
  return { ...operation, createdAt: new Date().toISOString() };
}
