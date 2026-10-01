import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UnifiedStudentWorkspace } from "../src/student/UnifiedStudentWorkspace";
import { CourseAuthoringStudio } from "../src/lecturer/CourseAuthoringStudio";
import { FleetOperationsCenter } from "../src/admin/FleetOperationsCenter";
import { TeacherCopilotPage } from "../src/lecturer/TeacherCopilot";
import { InstitutionWizardPage } from "../src/admin/InstitutionWizard";
const empty = vi.hoisted(() => []);
vi.mock("../src/auth/session", () => ({
  useSession: () => ({ profile: { userId: "new-student", displayName: "New account", role: "STUDENT" } }),
}));
vi.mock("../src/student/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/student/api")>()),
  useStudent: () => ({ data: empty, pending: false, error: null, retry: vi.fn() }),
}));
vi.mock("../src/lecturer/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lecturer/api")>()),
  useLecturer: () => ({ data: empty, pending: false, error: null, retry: vi.fn() }),
}));
vi.mock("../src/lib/course-categories", () => ({ useCourseCategories: () => empty }));
afterEach(cleanup);
const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);
describe("Workspace routes do not substitute prototype data", () => {
  it("uses the signed-in student instead of a seeded name, course or goal", () => {
    wrap(<UnifiedStudentWorkspace />);
    expect(screen.getByText(/New account/)).toBeTruthy();
    expect(screen.queryByText(/Nguyễn Văn An|Cây Cân Bằng AVL|Luyện tập thêm 30 phút/)).toBeNull();
  });
  it("shows the actual owned-course page rather than a locally published CS101", () => {
    wrap(<CourseAuthoringStudio />);
    expect(screen.queryByText(/CS101|v2.2.0|IN_REVIEW/)).toBeNull();
    expect(screen.getByText(/Khóa học phụ trách/)).toBeTruthy();
  });
  it("does not fabricate tenants or successful policy deployment", () => {
    wrap(<FleetOperationsCenter />);
    expect(screen.queryByText("DRIFTED")).toBeNull();
    expect(screen.queryByRole("button", { name: /Triển khai/ })).toBeNull();
  });
  it("does not fabricate risk signals or approval actions", () => {
    wrap(<TeacherCopilotPage />);
    expect(screen.getByText(/Chưa có dữ liệu cảnh báo sớm/)).toBeTruthy();
    expect(screen.queryByText(/82% xuống 58%/)).toBeNull();
  });
  it("does not fabricate an institution or connection latency", () => {
    wrap(<InstitutionWizardPage />);
    expect(screen.getByText(/Chưa có API quản lý tổ chức/)).toBeTruthy();
    expect(screen.queryByDisplayValue("Trường Đại học Bách Khoa")).toBeNull();
    expect(screen.queryByText(/42 ms/)).toBeNull();
  });
});
