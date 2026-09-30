import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RevenueQuote } from "../src/lecturer/RevenueQuote";

vi.mock("../src/lecturer/api", () => ({
  lecturerRequest: vi.fn(async () => ({ data: { basisPoints: 2200 } })),
}));

afterEach(cleanup);

describe("ước tính doanh thu khi nhập học phí", () => {
  it("loads the admin-adjusted commission rate", async () => {
    render(
      <form>
        <input name="price" defaultValue="100000" />
        <RevenueQuote initialPrice="100000" />
      </form>,
    );
    expect(await screen.findByText("Phí nền tảng (22%)")).toBeTruthy();
    expect(screen.getByText("−22.000 VND")).toBeTruthy();
    expect(screen.getByText("78.000 VND")).toBeTruthy();
  });
  it("updates the 15% fee and 85% lecturer amount as the price changes", () => {
    render(
      <form>
        <input name="price" defaultValue="100000" />
        <input name="currency" defaultValue="VND" />
        <RevenueQuote initialPrice="100000" commissionBasisPoints={1500} />
      </form>,
    );
    expect(screen.getByText("85.000 VND")).toBeTruthy();
    fireEvent.input(document.querySelector('input[name="price"]')!, { target: { value: "200000" } });
    expect(screen.getByText("−30.000 VND")).toBeTruthy();
    expect(screen.getByText("170.000 VND")).toBeTruthy();
  });

  it("shows zero income for a free course", () => {
    render(
      <form>
        <select name="priceType" defaultValue="FREE">
          <option value="FREE">Miễn phí</option>
          <option value="PAID">Có phí</option>
        </select>
        <input name="price" defaultValue="100000" />
        <RevenueQuote initialPrice="100000" initialPaid={false} commissionBasisPoints={1500} />
      </form>,
    );
    expect(screen.getAllByText("0 VND").length).toBeGreaterThan(0);
  });

  it("calculates fractional foreign-currency prices in minor units", () => {
    render(
      <form>
        <input name="price" defaultValue="10.01" />
        <input name="currency" defaultValue="USD" />
        <RevenueQuote initialPrice="10.01" initialCurrency="USD" commissionBasisPoints={1500} />
      </form>,
    );
    expect(screen.getByText("−1,50 USD")).toBeTruthy();
    expect(screen.getByText("8,51 USD")).toBeTruthy();
  });
});
