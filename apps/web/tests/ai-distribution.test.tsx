import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AiStudio } from "../src/lecturer/AiStudio";
vi.mock("../src/lecturer/api", () => ({
  useLecturer: () => ({ data: [], loading: false, reload: vi.fn(), retry: vi.fn() }),
  lecturerRequest: vi.fn(),
  lecturerError: String,
  month: () => "2026-09",
}));
vi.mock("../src/lecturer/useAiLive", () => ({ useAiLive: () => ({ connected: true, create: vi.fn() }) }));
afterEach(cleanup);
it("offers four cognitive counts, updates the total and blocks invalid distributions", () => {
  render(
    <MemoryRouter>
      <AiStudio />
    </MemoryRouter>,
  );
  expect(screen.getByRole("group", { name: "Phân bố mức độ nhận thức" })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Mức độ" })).toBeNull();
  const recognition = screen.getByRole("spinbutton", { name: /Nhận biết/ });
  expect((screen.getByRole("spinbutton", { name: "Số câu" }) as HTMLInputElement).value).toBe("10");
  fireEvent.change(recognition, { target: { value: "5" } });
  expect((screen.getByRole("spinbutton", { name: "Số câu" }) as HTMLInputElement).value).toBe("13");
  fireEvent.change(recognition, { target: { value: "50" } });
  expect(screen.getByText("Tổng phải từ 1 đến 50 câu; mỗi mức là số nguyên không âm.")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: /Gửi yêu cầu tạo câu hỏi/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Kiểm tra nâng cao · 20 câu" }));
  expect((screen.getByRole("spinbutton", { name: "Số câu" }) as HTMLInputElement).value).toBe("20");
  expect((screen.getByRole("spinbutton", { name: /Vận dụng cao/ }) as HTMLInputElement).value).toBe("6");
});
