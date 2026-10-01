import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AdminAi from "../src/admin/AdminAi";

const request = vi.hoisted(() => vi.fn());
vi.mock("../src/admin/api", () => ({
  adminRequest: request,
  adminError: () => "Không thể kết nối",
}));

afterEach(() => {
  cleanup();
  request.mockReset();
});

describe("AI quản trị", () => {
  it("sends admin support mode without learner course context", async () => {
    request.mockImplementation((path: string) =>
      Promise.resolve({
        data:
          path === "/assistant/conversations"
            ? []
            : {
                conversationId: "00000000-0000-4000-8000-000000000001",
                messageId: "00000000-0000-4000-8000-000000000002",
                content: "Mở mục Thống kê học tập và AI.",
              },
      }),
    );
    render(
      <MemoryRouter>
        <AdminAi />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText("Câu hỏi cho AI quản trị"), "Xem thống kê ở đâu?");
    await userEvent.click(screen.getByRole("button", { name: "Gửi câu hỏi" }));

    expect(await screen.findByText("Mở mục Thống kê học tập và AI.")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("/assistant/chat", "POST", {
      mode: "ADMIN_SUPPORT",
      message: "Xem thống kê ở đâu?",
    });
    expect(screen.getByRole("link", { name: "Thống kê học tập và AI" }).getAttribute("href")).toBe(
      "/app/admin/stats",
    );
  });
});

describe("Admin local configuration display", () => {
  it("shows the local guide mode from the backend and displays its real response", async () => {
    request.mockImplementation((path: string) =>
      Promise.resolve({
        data:
          path === "/assistant/admin-status"
            ? { mode: "local-guide" }
            : path === "/assistant/conversations"
              ? []
              : {
                  conversationId: "local-chat",
                  messageId: "local-message",
                  content: "Hướng dẫn local — không gọi mô hình AI trực tuyến. Mở /app/admin/moderation.",
                },
      }),
    );
    render(
      <MemoryRouter>
        <AdminAi />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Hướng dẫn quản trị local" })).toBeTruthy();
    expect(screen.getByText("Hướng dẫn local")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Câu hỏi cho AI quản trị"), "Xem báo cáo kiểm duyệt ở đâu?");
    await userEvent.click(screen.getByRole("button", { name: "Gửi câu hỏi" }));
    expect(
      await screen.findByText("Hướng dẫn local — không gọi mô hình AI trực tuyến. Mở /app/admin/moderation."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows the external provider mode when the backend is configured for VPS", async () => {
    request.mockImplementation((path: string) =>
      Promise.resolve({ data: path === "/assistant/admin-status" ? { mode: "external" } : [] }),
    );
    render(
      <MemoryRouter>
        <AdminAi />
      </MemoryRouter>,
    );
    expect(await screen.findByText("AI trực tuyến")).toBeTruthy();
    expect(screen.queryByText("Hướng dẫn local")).toBeNull();
  });
});
