/**
 * Manual Grading Store for AILSS Mobile.
 * Manages grading states:
 * - AUTO_GRADED: for multiple-choice/objective questions (graded immediately by system).
 * - PENDING_MANUAL_GRADING: for essays and project file submissions (awaiting lecturer review).
 * - MANUALLY_GRADED: once lecturer provides score and feedback.
 */

export type AssessmentFormat = "OBJECTIVE_QUIZ" | "ESSAY" | "PROJECT_FILE";
export type GradingStatus = "AUTO_GRADED" | "PENDING_MANUAL_GRADING" | "MANUALLY_GRADED";

export interface StudentSubmissionData {
  attemptId: string;
  studentId: string;
  studentName?: string;
  quizId: string;
  format: AssessmentFormat;
  status: GradingStatus;
  submittedAt: string;
  essayContent?: string;
  fileAttachment?: {
    fileName: string;
    fileSize: string;
    fileType: string;
    repoUrl?: string;
    notes?: string;
  };
  autoScore?: string;
  manualScore?: string;
  maxScore: string;
  lecturerFeedback?: string;
  gradedAt?: string;
  gradedBy?: string;
}

// In-memory persistent grading state for demo/hybrid backend synchronization
const submissionsStore = new Map<string, StudentSubmissionData>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function registerSubmission(data: StudentSubmissionData): void {
  submissionsStore.set(data.attemptId, { ...data });
  notify();
}

export function getSubmissionByAttemptId(attemptId: string): StudentSubmissionData | undefined {
  return submissionsStore.get(attemptId);
}

export function listSubmissionsByQuiz(quizId: string): StudentSubmissionData[] {
  return Array.from(submissionsStore.values()).filter((s) => s.quizId === quizId);
}

export function gradeSubmission(
  attemptId: string,
  score: string,
  feedback: string,
  lecturerName = "Giảng viên AILSS"
): StudentSubmissionData | null {
  const existing = submissionsStore.get(attemptId);
  if (!existing) {
    const created: StudentSubmissionData = {
      attemptId,
      studentId: "SV-CURRENT",
      studentName: "Học viên AILSS",
      quizId: "",
      format: "ESSAY",
      status: "MANUALLY_GRADED",
      submittedAt: new Date().toISOString(),
      manualScore: score,
      maxScore: "10.0",
      lecturerFeedback: feedback,
      gradedAt: new Date().toISOString(),
      gradedBy: lecturerName,
    };
    submissionsStore.set(attemptId, created);
    notify();
    return created;
  }

  const updated: StudentSubmissionData = {
    ...existing,
    status: "MANUALLY_GRADED",
    manualScore: score,
    lecturerFeedback: feedback,
    gradedAt: new Date().toISOString(),
    gradedBy: lecturerName,
  };
  submissionsStore.set(attemptId, updated);
  notify();
  return updated;
}

export function subscribeGradingStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function syncSubmissionsFromApi(
  items: Array<{
    attemptId: string;
    studentId: string;
    score: string;
    maxScore: string;
    submittedAt: string;
    manualScore?: string;
    teacherFeedback?: string;
    gradingStatus?: string;
    gradedBy?: string;
    gradedAt?: string;
  }>,
  quizId: string,
): void {
  for (const item of items) {
    const existing = submissionsStore.get(item.attemptId);
    submissionsStore.set(item.attemptId, {
      attemptId: item.attemptId,
      studentId: item.studentId,
      studentName: existing?.studentName ?? `Học viên ${item.studentId.slice(0, 8)}`,
      quizId,
      format: existing?.format ?? "OBJECTIVE_QUIZ",
      status:
        (item.gradingStatus as GradingStatus) ||
        (item.manualScore ? "MANUALLY_GRADED" : "AUTO_GRADED"),
      submittedAt: item.submittedAt,
      autoScore: item.score,
      manualScore: item.manualScore ?? existing?.manualScore,
      maxScore: item.maxScore,
      lecturerFeedback: item.teacherFeedback ?? existing?.lecturerFeedback,
      gradedBy: item.gradedBy ?? existing?.gradedBy,
      gradedAt: item.gradedAt ?? existing?.gradedAt,
    });
  }
  notify();
}

export function resetGradingStoreForTesting(): void {
  submissionsStore.clear();
  listeners.clear();
}
