import { describe, expect, it, beforeEach } from "vitest";
import {
  registerSubmission,
  getSubmissionByAttemptId,
  gradeSubmission,
  resetGradingStoreForTesting,
  subscribeGradingStore,
} from "../src/grading-store";

describe("Grading Store: Auto-Grading & Manual Grading", () => {
  beforeEach(() => {
    resetGradingStoreForTesting();
  });

  it("registers essay submission as PENDING_MANUAL_GRADING", () => {
    registerSubmission({
      attemptId: "att-essay-01",
      studentId: "sv-01",
      studentName: "Nguyễn Văn A",
      quizId: "quiz-essay-101",
      format: "ESSAY",
      status: "PENDING_MANUAL_GRADING",
      submittedAt: new Date().toISOString(),
      essayContent: "Phân tích mô hình ACID trong hệ quản trị cơ sở dữ liệu...",
      maxScore: "10.0",
    });

    const sub = getSubmissionByAttemptId("att-essay-01");
    expect(sub).toBeDefined();
    expect(sub?.format).toBe("ESSAY");
    expect(sub?.status).toBe("PENDING_MANUAL_GRADING");
    expect(sub?.essayContent).toContain("ACID");
    expect(sub?.manualScore).toBeUndefined();
  });

  it("registers project submission with file attachment details", () => {
    registerSubmission({
      attemptId: "att-project-02",
      studentId: "sv-02",
      studentName: "Trần Thị B",
      quizId: "quiz-project-201",
      format: "PROJECT_FILE",
      status: "PENDING_MANUAL_GRADING",
      submittedAt: new Date().toISOString(),
      fileAttachment: {
        fileName: "DoAn_BaoCao_CSDL.pdf",
        fileSize: "4.2 MB",
        fileType: "application/pdf",
        repoUrl: "https://github.com/student/ailss-project",
      },
      maxScore: "10.0",
    });

    const sub = getSubmissionByAttemptId("att-project-02");
    expect(sub).toBeDefined();
    expect(sub?.format).toBe("PROJECT_FILE");
    expect(sub?.fileAttachment?.fileName).toBe("DoAn_BaoCao_CSDL.pdf");
    expect(sub?.fileAttachment?.repoUrl).toBe("https://github.com/student/ailss-project");
  });

  it("allows lecturer to manually grade and submit feedback", () => {
    registerSubmission({
      attemptId: "att-03",
      studentId: "sv-03",
      studentName: "Lê Văn C",
      quizId: "quiz-essay-101",
      format: "ESSAY",
      status: "PENDING_MANUAL_GRADING",
      submittedAt: new Date().toISOString(),
      essayContent: "Giải thuật tối ưu hóa câu lệnh SQL...",
      maxScore: "10.0",
    });

    let notified = false;
    const unsub = subscribeGradingStore(() => {
      notified = true;
    });

    const graded = gradeSubmission("att-03", "9.5", "Lập luận xuất sắc, code demo chi tiết!");
    expect(notified).toBe(true);
    expect(graded?.status).toBe("MANUALLY_GRADED");
    expect(graded?.manualScore).toBe("9.5");
    expect(graded?.lecturerFeedback).toBe("Lập luận xuất sắc, code demo chi tiết!");
    expect(graded?.gradedAt).toBeDefined();

    const verified = getSubmissionByAttemptId("att-03");
    expect(verified?.status).toBe("MANUALLY_GRADED");
    expect(verified?.manualScore).toBe("9.5");

    unsub();
  });
});
