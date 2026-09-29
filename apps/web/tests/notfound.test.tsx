import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotFound from "../src/pages/NotFound";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderNotFound = (initialPath = "/unknown-path") =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <NotFound />
    </MemoryRouter>,
  );

describe("Minimalist 3D 404 Not Found Page", () => {
  it("renders the 3D scene stage with accessibility region", () => {
    renderNotFound();

    const sceneRegion = screen.getByRole("region", { name: "Mô hình 3D 404 tương tác" });
    expect(sceneRegion).toBeTruthy();
  });

  it("renders the exact heading required by system audit", () => {
    renderNotFound();

    expect(screen.getByRole("heading", { name: "Trang này chưa có ở đây." })).toBeTruthy();
    expect(screen.getByText("Đường dẫn có thể đã thay đổi hoặc không tồn tại.")).toBeTruthy();
  });

  it("renders the primary action button to navigate back home", () => {
    renderNotFound();

    const homeLink = screen.getByRole("link", { name: /Về trang chủ/ });
    expect(homeLink).toBeTruthy();
    expect(homeLink.getAttribute("href")).toBe("/");
  });
});
