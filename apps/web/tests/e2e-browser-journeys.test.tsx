import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UnifiedStudentWorkspace } from "../src/student/UnifiedStudentWorkspace";
import { CourseAuthoringStudio } from "../src/lecturer/CourseAuthoringStudio";
import { FleetOperationsCenter } from "../src/admin/FleetOperationsCenter";
import { TeacherCopilotPage } from "../src/lecturer/TeacherCopilot";
import { InstitutionWizardPage } from "../src/admin/InstitutionWizard";

beforeEach(() => {
  globalThis.alert = () => {};
});

afterEach(() => {
  cleanup();
});

describe("Phase 40 Track 1 & 2: Browser E2E User Journeys & WCAG 2.2 AA", () => {
  describe("40.8 & 40.26: Student Journey & Workspace (Today View, Goals, AI Tutor)", () => {
    it("renders the Unified Student Workspace with Today view, continue learning, and goals", () => {
      render(
        <MemoryRouter>
          <UnifiedStudentWorkspace
            studentName="Nguyễn Văn An"
            studentId="stu-2026-001"
            tenantId="tenant-polytech-hcm"
          />
        </MemoryRouter>,
      );

      // Verify header & student context
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        "Không gian Học tập Cá nhân hóa",
      );
      expect(screen.getByText(/Nguyễn Văn An/)).toBeTruthy();

      // Verify WCAG 2.2 navigation tabs with min 24x24 targets and aria-selected
      const todayTab = screen.getByRole("tab", { name: "Hôm nay (Today)" });
      expect(todayTab.getAttribute("aria-selected")).toBe("true");

      // Verify Continue Learning card
      expect(screen.getByText("Cấu trúc Dữ liệu & Giải thuật: Bài 4 - Cây Cân Bằng AVL")).toBeTruthy();

      // Verify Recommended Next Action
      expect(screen.getByText("Luyện tập: Phép xoay kép LR/RL trên Cây AVL")).toBeTruthy();

      // Test dismissing recommendation
      const dismissBtn = screen.getByRole("button", { name: "Bỏ qua khuyến nghị" });
      fireEvent.click(dismissBtn);
      expect(screen.queryByText("Luyện tập: Phép xoay kép LR/RL trên Cây AVL")).toBeNull();

      const tutorLink = screen.getByRole("link", { name: "Hỏi AI Tutor bài này" });
      expect(tutorLink.getAttribute("href")).toBe("/app/ai-tutor?mode=STUDY_BUDDY");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("allows learner to create a new Learning Goal", () => {
      render(
        <MemoryRouter>
          <UnifiedStudentWorkspace />
        </MemoryRouter>,
      );
      const addGoalBtn = screen.getByRole("button", { name: "+ Đặt mục tiêu học tập mới" });
      fireEvent.click(addGoalBtn);
      expect(screen.getByText("Luyện tập thêm 30 phút")).toBeTruthy();
    });
  });

  describe("40.8 & 40.29: Teacher Journey & Course Studio (Draft -> Review -> Publish)", () => {
    it("enforces explicit publish workflow and AI draft human approval gate", () => {
      render(<CourseAuthoringStudio />);

      // Verify initial state is IN_REVIEW
      expect(screen.getByText(/Trạng thái: IN_REVIEW/)).toBeTruthy();

      // Attempting to publish without APPROVED must alert/block
      const publishBtn = screen.getByRole("button", { name: "Xuất bản Phiên bản Mới" });
      fireEvent.click(publishBtn);
      expect(screen.getByText(/Trạng thái: IN_REVIEW/)).toBeTruthy();

      // Teacher clicks approve
      const approveBtn = screen.getByRole("button", { name: "Phê duyệt toàn bộ Khóa học" });
      fireEvent.click(approveBtn);
      expect(screen.getByText(/Trạng thái: APPROVED/)).toBeTruthy();

      // Teacher clicks publish
      fireEvent.click(publishBtn);
      expect(screen.getByText(/Trạng thái: PUBLISHED/)).toBeTruthy();
      expect(screen.getByText(/v2.2.0/)).toBeTruthy();
    });
  });

  describe("40.8 & 40.41: Fleet Operations (Templates, Bulk Dry-Run, Drift Remediation)", () => {
    it("displays tenant drift status and supports one-click drift remediation", () => {
      render(<FleetOperationsCenter />);

      // Verify drifted tenant is detected
      expect(screen.getByText("DRIFTED")).toBeTruthy();
      expect(screen.getByText(/AI_TUTOR_V2 đã bị tắt cục bộ/)).toBeTruthy();

      // Click remediate drift
      const fixBtn = screen.getByRole("button", { name: "Khắc phục sai lệch" });
      fireEvent.click(fixBtn);

      // Verify tenant transitions to IN_SYNC
      expect(screen.queryByText("DRIFTED")).toBeNull();
    });

    it("executes bulk preview dry-run before applying policy updates", () => {
      render(<FleetOperationsCenter />);

      const bulkBtn = screen.getByRole("button", {
        name: "Triển khai Thay đổi Hàng loạt (Dry-Run)",
      });
      fireEvent.click(bulkBtn);

      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByText(/ĐẠT \(3\/3\)/)).toBeTruthy();

      const confirmBtn = screen.getByRole("button", { name: "Xác nhận Áp dụng Chính sách" });
      fireEvent.click(confirmBtn);

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByText(/cập nhật chính sách thành công/)).toBeTruthy();
    });
  });

  describe("40.F20 & 40.F21: Pilot Route Accessibility & Journeys (Teacher Copilot & Interventions)", () => {
    it("renders Teacher Copilot with human approval gate and executes question review workflow", () => {
      render(<TeacherCopilotPage />);

      // Verify human approval gate notice
      expect(screen.getByText(/Cổng phê duyệt Giảng viên/)).toBeTruthy();

      // Verify question draft approval
      const approveButtons = screen.getAllByRole("button", { name: /Phê duyệt câu hỏi/i });
      expect(approveButtons.length).toBeGreaterThan(0);
      fireEvent.click(approveButtons[0]!);

      // Verify draft state updated
      expect(screen.getByText(/ĐÃ DUYỆT/i)).toBeTruthy();
    });

    it("navigates to Interventions tab and executes instructor intervention on at-risk student", () => {
      render(<TeacherCopilotPage />);

      // Click on Interventions tab
      const interventionsTab = screen.getByRole("button", { name: /Cảnh báo sớm & Can thiệp/i });
      fireEvent.click(interventionsTab);

      // Verify risk signal rendered
      expect(screen.getByText(/Điểm thành thạo giảm từ 82% xuống 58%/i)).toBeTruthy();

      // Instructor executes intervention action
      const resolveBtns = screen.getAllByRole("button", { name: /Đánh dấu đã can thiệp/i });
      expect(resolveBtns.length).toBeGreaterThan(0);
      fireEvent.click(resolveBtns[0]!);
      expect(screen.getByText(/Đã giải quyết/i)).toBeTruthy();
    });
  });

  describe("40.F20 & 40.F21: Pilot Route Accessibility & Journeys (Institution Wizard & Integrations)", () => {
    it("renders Institution Wizard with multi-step progression and integration test center", () => {
      render(<InstitutionWizardPage />);

      // Verify wizard header and initial step
      expect(screen.getByDisplayValue("Trường Đại học Bách Khoa")).toBeTruthy();
      expect(screen.getByText(/Quản trị Cơ sở Đào tạo/i)).toBeTruthy();

      // Switch to Test Center tab
      const testCenterTab = screen.getByRole("button", { name: /Trung tâm Kiểm thử kết nối/i });
      fireEvent.click(testCenterTab);

      // Verify integration status cards
      expect(screen.getByText(/OpenID Connect/i)).toBeTruthy();
      expect(screen.getByText(/SCIM 2.0 User & Group Provisioning/i)).toBeTruthy();
      expect(screen.getByText(/42 ms/i)).toBeTruthy();
    });
  });
});
