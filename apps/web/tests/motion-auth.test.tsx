import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Auth } from "../src/pages/Support";
import { SessionProvider } from "../src/auth/session";
import { advanceScroll } from "../src/motion/scroll";
import { VideoStory } from "../src/components/VideoStory";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const show = (path: string) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "SESSION_EXPIRED" } }),
    }),
  );
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
};
describe("premium auth and motion", () => {
  it("register chooser links to explicit roles without submitting role", () => {
    show("/auth/register");
    expect(screen.getByRole("link", { name: /Học viên/ }).getAttribute("href")).toBe(
      "/auth/register/student",
    );
    expect(screen.getByRole("link", { name: /Giảng viên/ }).getAttribute("href")).toBe(
      "/auth/register/lecturer",
    );
    expect(screen.queryByLabelText("Mật khẩu")).toBeNull();
  });
  it("lecturer has a direct registration form and explains verification", () => {
    show("/auth/register/lecturer");
    expect(screen.getByText(/Đăng ký trực tiếp tài khoản giảng viên/)).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tạo tài khoản" })).toBeTruthy();
  });
  it("student uses existing required fields", () => {
    show("/auth/register/student");
    expect(screen.getByLabelText("Mật khẩu").getAttribute("minlength")).toBe("12");
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Họ và tên")).toBeTruthy();
  });
  it("scroll controller bounds speed/progress and settles without moving target", () => {
    let s = { position: 0, velocity: 0, direction: 0, progress: 0 };
    s = advanceScroll(s, 1200, 16, 1000);
    expect(s.position).toBeGreaterThan(0);
    expect(s.position).toBeLessThan(1200);
    expect(s.progress).toBe(1);
    expect(s.direction).toBe(1);
    for (let i = 0; i < 180; i++) s = advanceScroll(s, 1200, 16, 1000);
    expect(s.position).toBeCloseTo(1200);
    expect(s.velocity).toBeCloseTo(0);
    expect(advanceScroll(s, 0, 16, 1000).direction).toBe(-1);
  });
  it("login screen offers Google and Apple SSO buttons along with demo chips", () => {
    show("/auth/login");
    expect(screen.getByRole("button", { name: "Đăng nhập với Google" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Đăng nhập với Apple" })).toBeTruthy();
    expect(screen.getByText("hoặc tiếp tục với email")).toBeTruthy();
    expect(screen.getByText(/Tài khoản thử nghiệm nhanh/)).toBeTruthy();
  });
  it("password field provides eye icon toggle for visibility with symmetric accessibility", async () => {
    const { fireEvent } = await import("@testing-library/react");
    show("/auth/login");
    const pwdInput = screen.getByLabelText("Mật khẩu") as HTMLInputElement;
    expect(pwdInput.type).toBe("password");

    const toggleBtn = screen.getByRole("button", { name: "Hiện mật khẩu" });
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.getAttribute("title")).toBe("Hiện mật khẩu");
    expect(toggleBtn.querySelector(".password-eye-svg")).toBeTruthy();

    fireEvent.click(toggleBtn);
    expect(pwdInput.type).toBe("text");
    expect(toggleBtn.getAttribute("title")).toBe("Ẩn mật khẩu");

    fireEvent.click(toggleBtn);
    expect(pwdInput.type).toBe("password");
    expect(toggleBtn.getAttribute("title")).toBe("Hiện mật khẩu");
  });
  it("video remains a poster until requested and transcript is available", () => {
    render(<VideoStory />);
    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: "Tải video quy trình AI" })).toBeTruthy();
    expect(screen.getByText("Bản mô tả video")).toBeTruthy();
  });
});

