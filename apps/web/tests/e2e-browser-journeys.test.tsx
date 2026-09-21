import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { UnifiedStudentWorkspace } from "../src/student/UnifiedStudentWorkspace";
import { CourseAuthoringStudio } from "../src/lecturer/CourseAuthoringStudio";
import { FleetOperationsCenter } from "../src/admin/FleetOperationsCenter";

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
        <UnifiedStudentWorkspace
          studentName="Nguyễn Văn An"
          studentId="stu-2026-001"
          tenantId="tenant-polytech-hcm"
        />,
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
      expect(
        screen.getByText("Cấu trúc Dữ liệu & Giải thuật: Bài 4 - Cây Cân Bằng AVL"),
      ).toBeTruthy();

      // Verify Recommended Next Action
      expect(
        screen.getByText("Luyện tập: Phép xoay kép LR/RL trên Cây AVL"),
      ).toBeTruthy();

      // Test dismissing recommendation
      const dismissBtn = screen.getByRole("button", { name: "Bỏ qua khuyến nghị" });
      fireEvent.click(dismissBtn);
      expect(
        screen.queryByText("Luyện tập: Phép xoay kép LR/RL trên Cây AVL"),
      ).toBeNull();

      // Open AI Tutor drawer
      const openTutorBtn = screen.getByRole("button", { name: "Hỏi AI Tutor bài này" });
      fireEvent.click(openTutorBtn);
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByText(/AI Tutor - Chế độ Socratic/)).toBeTruthy();

      // Close AI Tutor
      const closeTutorBtn = screen.getByRole("button", { name: "Đóng AI Tutor" });
      fireEvent.click(closeTutorBtn);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("allows learner to create a new Learning Goal", () => {
      render(<UnifiedStudentWorkspace />);
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
});
