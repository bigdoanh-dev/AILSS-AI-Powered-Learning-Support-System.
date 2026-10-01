import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Purchase from "../src/student/Commerce";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/student/api", () => ({
  useStudent: (path: string) => ({
    data: path === "/me/courses" ? [] : path.endsWith("/offerings") ? [] : { title: "Backend course" },
    pending: false,
    error: null,
    retry: vi.fn(),
  }),
  studentRequest: mocks.request,
}));
const pendingOrder = (paymentMode?: string) => ({
  orderId: "order-1",
  courseId: "course-1",
  offeringId: "offering-1",
  offeringType: "SELF_PACED",
  state: "PENDING",
  fulfillmentState: "NONE",
  price: "150000",
  currency: "VND",
  paymentMode,
  payment: {
    accountNumber: "000000000",
    accountName: "Test receiver",
    bank: "MB",
    content: "TEST-ORDER",
    qrUrl: "https://example.com/test-qr.png",
  },
});
beforeEach(() => mocks.request.mockReset());
afterEach(cleanup);
function renderCheckout() {
  return render(
    <MemoryRouter initialEntries={["/purchase/course-1?order=order-1"]}>
      <Routes>
        <Route path="/purchase/:courseId" element={<Purchase />} />
      </Routes>
    </MemoryRouter>,
  );
}
describe("checkout uses the backend payment mode", () => {
  it.each(["sepay", undefined])("only reads bank confirmation for mode %s", async (mode) => {
    mocks.request.mockResolvedValue({ data: pendingOrder(mode) });
    renderCheckout();
    const button = await screen.findByRole("button", { name: "Kiểm tra thanh toán" });
    expect(screen.queryByRole("button", { name: /mô phỏng/i })).toBeNull();
    expect(screen.queryByText(/Hết hạn sau/)).toBeNull();
    fireEvent.click(button);
    await screen.findByText(/Chưa nhận được xác nhận thanh toán từ ngân hàng/);
    expect(mocks.request.mock.calls.every(([path]) => path === "/orders/order-1")).toBe(true);
  });
  it("offers simulation only when the backend explicitly declares simulation", async () => {
    mocks.request.mockResolvedValue({ data: pendingOrder("simulation") });
    renderCheckout();
    const button = await screen.findByRole("button", { name: /mô phỏng/i });
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "/orders/order-1/simulate-payment",
        expect.any(AbortSignal),
        "POST",
        { outcome: "SUCCESS" },
      ),
    );
  });
});
