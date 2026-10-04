import type { LecturerRevenue, RevenueDay } from "../components/RevenuePanels";

export type OverviewStats = {
  totalAccounts: number;
  students: number;
  lecturers: number;
  admins: number;
  suspended: number;
  totalCourses?: number | null;
  completionRate: string | null;
  learningSessionsToday?: number | null;
  atRiskStudents?: number | null;
  inactiveStudents?: number | null;
  lowCompletionCourses?: number | null;
  lecturersNeedingReview?: number | null;
};
export type Monitoring = {
  sampledAt: string;
  prometheus: { available: boolean; url: string };
  grafana: { available: boolean; url: string };
  metrics: { requestRate: number | null; errorPercent: number | null; p95Ms: number | null };
  services: { job: string; instance: string; up: boolean; lastScrape: string; error: string }[];
  alerts: { name: string; severity: string; state: string; summary: string }[] | null;
  history: { time: string; requestRate: number | null }[];
};
export type Operations = {
  sampledAt: string;
  range: string;
  coverageNote: string;
  metrics: Record<string, number | null>;
  trends: Record<string, { time: string; value: number | null }[]>;
  serviceMetrics: Record<string, Record<string, number | null>>;
  dependencies: { name: string; ready: boolean }[];
};
export type OverviewRevenue = {
  dataSource: string;
  grossMinor: string;
  refundMinor: string;
  netMinor: string;
  orderCount: number;
  refundCount: number;
  dailyRevenue: RevenueDay[];
  lecturers: LecturerRevenue[];
  pendingRefunds?: number | null;
  failedPayments?: number | null;
};
export type OverviewPayouts = { month: string; instructions: { amountMinor: string; status: string }[] };
export type OverviewLogs = {
  items: { id: string; action: string; category: string; date: string; time: string; status: string }[];
};
