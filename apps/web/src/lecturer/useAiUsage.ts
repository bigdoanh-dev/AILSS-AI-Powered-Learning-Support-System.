import { useEffect, useRef } from "react";
import { useLecturer } from "./api";
export type AiUsage = {
  day: string;
  limit: number;
  reserved: number;
  consumed: number;
  remaining: number;
  timeZone: string;
  resetsAt: string;
};
/** Refresh authoritative usage at midnight, after job changes and on returning to the page. */
export function useAiUsage(jobId?: string, jobState?: string) {
  const query = useLecturer<AiUsage>("/ai/usage");
  const retry = useRef(query.retry);
  retry.current = query.retry;
  useEffect(() => {
    if (jobId) retry.current();
  }, [jobId, jobState]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") retry.current();
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    if (!query.data?.resetsAt) return;
    const delay = Date.parse(query.data.resetsAt) - Date.now();
    if (!Number.isFinite(delay)) return;
    const timer = window.setTimeout(() => retry.current(), Math.max(1000, delay + 250));
    return () => window.clearTimeout(timer);
  }, [query.data?.resetsAt]);
  return query;
}
