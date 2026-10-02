import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RevenueQuote } from "../src/lecturer/RevenueQuote";
import { CoursePricingFields } from "../src/lecturer/CoursePricingFields";

vi.mock("../src/lecturer/api", () => ({
  lecturerRequest: vi.fn(async () => ({ data: { basisPoints: 2200 } })),
}));

afterEach(cleanup);

describe("ước tính doanh thu khi nhập học phí", () => {
  it("updates from controlled modal props even without named form inputs", () => {
    const { rerender } = render(
      <RevenueQuote price="1000000" currency="VND" paid commissionBasisPoints={1500} />,
    );
    expect(screen.getByText("1.000.000 VND")).toBeTruthy();
    expect(screen.getByText("−150.000 VND")).toBeTruthy();
    expect(screen.getByText("850.000 VND")).toBeTruthy();
    rerender(<RevenueQuote price="2000000" currency="VND" paid commissionBasisPoints={1500} />);
    expect(screen.getByText("1.700.000 VND")).toBeTruthy();
    rerender(<RevenueQuote price="2000000" currency="VND" paid={false} commissionBasisPoints={1500} />);
    expect(screen.getAllByText("0 VND")).toHaveLength(2);
    expect(screen.queryByText("1.700.000 VND")).toBeNull();
  });

  it("locks a free course price and submits zero after changing from paid to free", async () => {
    render(
      <form>
        <CoursePricingFields initialPriceType="PAID" initialPrice="1000000" />
      </form>,
    );
    expect(await screen.findByText("780.000 VND")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Hình thức học phí"), { target: { value: "FREE" } });
    const price = screen.getByLabelText("Giá niêm yết") as HTMLInputElement;
    expect(price.readOnly).toBe(true);
    expect(price.value).toBe("0");
    expect(new FormData(document.querySelector("form")!).get("price")).toBe("0");
    fireEvent.change(screen.getByLabelText("Hình thức học phí"), { target: { value: "PAID" } });
    expect(price.readOnly).toBe(false);
    fireEvent.change(price, { target: { value: "2000000" } });
    expect(screen.getByText("1.560.000 VND")).toBeTruthy();
  });

  it("does not display a stale positive price from legacy free course metadata", () => {
    render(
      <form>
        <CoursePricingFields initialPriceType="FREE" initialPrice="1000000" />
      </form>,
    );
    expect((screen.getByLabelText("Giá niêm yết") as HTMLInputElement).value).toBe("0");
  });
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
