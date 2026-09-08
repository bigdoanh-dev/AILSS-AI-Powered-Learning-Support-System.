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
  it("lecturer fallback is truthful and has no submission", () => {
    show("/auth/register/lecturer");
    expect(screen.getByText("Chưa mở đăng ký giảng viên trực tuyến")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /đăng ký/i })).toBeNull();
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
  it("video remains a poster until requested and transcript is available", () => {
    render(<VideoStory />);
    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: "Tải video quy trình AI" })).toBeTruthy();
    expect(screen.getByText("Bản mô tả video")).toBeTruthy();
  });
});
