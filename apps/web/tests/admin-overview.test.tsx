import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminHome from "../src/admin/AdminHome";

vi.mock("../src/auth/session", () => ({
  useSession: () => ({ profile: { userId: "admin-1", role: "ADMIN", displayName: "Demo Admin" } }),
}));
// jsdom has no layout; rendered charts are covered separately in a real browser.
vi.mock("recharts", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Shape = () => null;
  return {
    ResponsiveContainer: Container,
    AreaChart: Container,
    BarChart: Container,
    PieChart: Container,
    Area: Shape,
    Bar: Shape,
    Pie: Shape,
    Cell: Shape,
    CartesianGrid: Shape,
    XAxis: Shape,
    YAxis: Shape,
    Tooltip: Shape,
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const mon = {
  sampledAt: new Date().toISOString(),
  prometheus: { available: true, url: "http://localhost:9090" },
  grafana: { available: true, url: "http://localhost:3000" },
  metrics: { requestRate: 9, errorPercent: 0, p95Ms: 160.5 },
  services: [
    "ailss-api-gateway",
    "ailss-identity",
    "ailss-learning",
    "ailss-ai",
    "ailss-ai-worker",
    "ailss-media-worker",
    "ailss-media-delivery",
  ].map((job) => ({ job, instance: job, up: true, lastScrape: new Date().toISOString(), error: "" })),
  alerts: [],
  history: [{ time: new Date().toISOString(), requestRate: 9 }],
};
function sources(failed: string[] = [], monitoring = mon) {
  const data: Record<string, unknown> = {
    "/dashboard/stats": {
      totalAccounts: 12480,
      students: 8920,
      lecturers: 642,
      admins: 8,
      suspended: 2910,
      completionRate: null,
    },
    "/monitoring": monitoring,
    "/dashboard/operations": {
      sampledAt: new Date().toISOString(),
      range: "30d",
      coverageNote: "Counter estimates",
      metrics: {
        aiRequests: 24820,
        aiRequestsToday: 248,
        aiLatencyMs: 1800,
        assistantRequests: 200,
        quizRequests: 48,
        aiFailed: null,
      },
      trends: {
        registrations: [{ time: new Date().toISOString(), value: 12 }],
        aiRequests: [{ time: new Date().toISOString(), value: 248 }],
      },
      serviceMetrics: {},
      dependencies: [
        { name: "cassandra", ready: true },
        { name: "rabbitmq", ready: true },
      ],
    },
    "/dashboard/revenue": {
      dataSource: "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION",
      grossMinor: "425000000",
      refundMinor: "1000000",
      netMinor: "424000000",
      orderCount: 5,
      refundCount: 1,
      dailyRevenue: [],
      lecturers: [{ lecturerId: "lecturer-1", estimatedPlatformMinor: "63000000", courses: [] }],
    },
    "/payouts": {
      month: "2026-09",
      instructions: [
        { amountMinor: "82000000", status: "PENDING_TRANSFER" },
        { amountMinor: "10000000", status: "PAID" },
      ],
    },
    "/audit-logs": { items: [] },
  };
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const path = String(input).replace("/web-session/admin", "").split("?")[0]!;
    return failed.includes(path)
      ? Response.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503 })
      : Response.json({ data: data[path] });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function wrap() {
  return render(
    <MemoryRouter>
      <AdminHome />
    </MemoryRouter>,
  );
}
describe("Admin Control Center overview", () => {
  it("does not label a target critical before its first scrape", async () => {
    sources([], {
      ...mon,
      services: mon.services.map((target, index) =>
        index ? target : { ...target, up: false, lastScrape: "0001-01-01T00:00:00Z" },
      ),
    });
    wrap();
    await screen.findByText("12.480");
    await waitFor(() =>
      expect(screen.getByText("API Gateway").closest("tr")?.textContent).toContain("Không rõ"),
    );
    expect(screen.queryByText("API Gateway · Cần xử lý")).toBeNull();
  });
  it("surfaces stale service warnings in the alerts panel", async () => {
    sources([], {
      ...mon,
      services: mon.services.map((target, index) =>
        index ? target : { ...target, lastScrape: new Date(Date.now() - 120000).toISOString() },
      ),
    });
    wrap();
    expect(await screen.findByText("API Gateway · Cần theo dõi")).toBeTruthy();
  });
  it("renders eight KPIs and preserves the reference Prometheus/Grafana panel", async () => {
    sources();
    wrap();
    const kpis = screen.getByRole("region", { name: "KPI tổng quan hệ thống" });
    expect(await within(kpis).findByText("12.480")).toBeTruthy();
    expect(kpis.querySelectorAll(".aoc-metric")).toHaveLength(8);
    expect(within(kpis).getByText("8.920")).toBeTruthy();
    expect(within(kpis).getByText("642")).toBeTruthy();
    expect(within(kpis).getAllByText("—")).toHaveLength(4);
    const monitoring = screen.getByRole("region", { name: "Giám sát Prometheus và Grafana" });
    expect(within(monitoring).getByRole("heading", { name: "Prometheus & Grafana" })).toBeTruthy();
    expect(await within(monitoring).findByText(/Prometheus: Đã kết nối · Grafana: Đã kết nối/)).toBeTruthy();
    expect(within(monitoring).getByText("9.00")).toBeTruthy();
    expect(within(monitoring).getByText("160.5 ms")).toBeTruthy();
    expect(within(monitoring).getByRole("link", { name: "Xem giám sát" }).getAttribute("href")).toBe(
      "/app/admin/monitoring",
    );
    expect(
      within(monitoring).getByRole("img", { name: "Lưu lượng yêu cầu trong giờ gần nhất" }),
    ).toBeTruthy();
  });
  it("refetches the selected period and labels missing aggregations honestly", async () => {
    const fetcher = sources();
    wrap();
    await screen.findByText("12.480");
    fireEvent.click(screen.getByRole("button", { name: "90 ngày" }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([url]) => String(url).includes("operations?range=90d"))).toBe(true),
    );
    expect(screen.getByRole("button", { name: "90 ngày" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Người dùng hoạt động" }));
    expect(screen.getByText("Chưa có tổng hợp người dùng hoạt động theo ngày.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mức sử dụng AI" }));
    expect(await screen.findByRole("img", { name: "AI requests mỗi ngày" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Quản lý người dùng$/ }).getAttribute("href")).toBe(
      "/app/admin/users",
    );
    expect(screen.getByRole("button", { name: /Tạo quản trị viên/ }).hasAttribute("disabled")).toBe(true);
  });
  it("keeps monitoring and account data when independent finance sources fail", async () => {
    sources(["/dashboard/revenue", "/payouts"]);
    wrap();
    expect(await screen.findByText("12.480")).toBeTruthy();
    expect(await screen.findByText("9.00")).toBeTruthy();
    expect(screen.queryByText("425.000.000 ₫")).toBeNull();
    expect(screen.queryByText("82.000.000 ₫")).toBeNull();
    expect(screen.getByText("Chưa có báo cáo doanh thu đã đối soát.")).toBeTruthy();
  });
  it("shows authoritative finance and only pending transfer amounts", async () => {
    sources();
    wrap();
    const finance = screen.getByRole("region", { name: "Tài chính / Marketplace" });
    expect(await within(finance).findByText("425.000.000 ₫")).toBeTruthy();
    expect(await within(finance).findByText("63.000.000 ₫")).toBeTruthy();
    expect(await within(finance).findByText("82.000.000 ₫")).toBeTruthy();
    expect(within(finance).queryByText("92.000.000 ₫")).toBeNull();
    expect(within(finance).getAllByText("—")).toHaveLength(2);
  });
  it("never replaces a complete telemetry outage with example numbers or healthy statuses", async () => {
    sources([
      "/dashboard/stats",
      "/monitoring",
      "/dashboard/operations",
      "/dashboard/revenue",
      "/payouts",
      "/audit-logs",
    ]);
    wrap();
    await waitFor(() => expect(screen.queryByText("Đang cập nhật…")).toBeNull());
    expect(screen.queryByText("12.480")).toBeNull();
    expect(screen.queryByText("9.00")).toBeNull();
    expect(screen.queryByText("24.820")).toBeNull();
    expect(screen.getAllByText("Không rõ").length).toBeGreaterThanOrEqual(7);
  });
});
