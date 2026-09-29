import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RoleAiExperience } from "../src/components/RoleAiExperience";

const session = vi.hoisted(() => ({
  state: "AUTHENTICATED",
  profile: { role: "STUDENT", userId: "student-1", lecturerVerified: false },
}));

vi.mock("../src/auth/session", () => ({ useSession: () => session }));
vi.mock("../src/student/aiTutorConversation", () => ({
  AiTutorConversationProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../src/components/FloatingAiTutor", () => ({
  FloatingAiTutor: () => <div data-testid="student-tutor" />,
}));
vi.mock("../src/components/SafeMascot", () => ({ SafeMascot: () => <span /> }));

beforeEach(() => {
  session.state = "AUTHENTICATED";
  session.profile.role = "STUDENT";
  session.profile.lecturerVerified = false;
});
afterEach(cleanup);

const show = () =>
  render(
    <MemoryRouter>
      <RoleAiExperience>
        <main>Nội dung</main>
      </RoleAiExperience>
    </MemoryRouter>,
  );

describe("AI theo vai trò", () => {
  it("shows the tutor only to students", () => {
    show();
    expect(screen.getByTestId("student-tutor")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /AI/ })).toBeNull();
  });

  it("sends verified lecturers to the authoring studio", () => {
    session.profile.role = "LECTURER";
    session.profile.lecturerVerified = true;
    show();
    expect(screen.queryByTestId("student-tutor")).toBeNull();
    expect(screen.getByRole("link", { name: "Mở trợ lý soạn bài AI" }).getAttribute("href")).toBe(
      "/app/teaching/ai",
    );
  });

  it("sends admins to their own AI workspace", () => {
    session.profile.role = "ADMIN";
    show();
    expect(screen.queryByTestId("student-tutor")).toBeNull();
    expect(screen.getByRole("link", { name: "Mở AI quản trị" }).getAttribute("href")).toBe("/app/admin/ai");
  });

  it("hides AI shortcuts before sign-in and lecturer verification", () => {
    session.profile.role = "LECTURER";
    session.profile.lecturerVerified = false;
    show();
    expect(screen.queryByRole("link", { name: /AI/ })).toBeNull();
    cleanup();
    session.state = "UNAUTHENTICATED";
    show();
    expect(screen.queryByTestId("student-tutor")).toBeNull();
    expect(screen.queryByRole("link", { name: /AI/ })).toBeNull();
  });
});
