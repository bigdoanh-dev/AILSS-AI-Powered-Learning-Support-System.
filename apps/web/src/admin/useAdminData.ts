import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../auth/session";
import { adminRequest, adminError } from "./api";
export interface AdminDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isLive: boolean;
  refresh: () => void;
  lastUpdated: Date | null;
}
export function useAdminData<T>(
  path: string,
  options: { intervalMs?: number; fallback?: T | null; enabled?: boolean } = {},
): AdminDataState<T> {
  const { profile } = useSession();
  const identity = profile?.role === "ADMIN" ? profile.userId : "";
  const scope = `${identity}|${path}`;
  const enabled = options.enabled !== false && !!identity;
  const intervalMs = options.intervalMs ?? 30_000;
  const [result, setResult] = useState<{
    scope: string;
    data: T | null;
    loading: boolean;
    error: string | null;
    lastUpdated: Date | null;
  }>({ scope: "", data: null, loading: enabled, error: null, lastUpdated: null });
  const active = useRef<AbortController | null>(null);
  const doFetch = useCallback(async () => {
    active.current?.abort();
    if (!enabled) return;
    const controller = new AbortController();
    active.current = controller;
    setResult((previous) =>
      previous.scope === scope
        ? { ...previous, loading: true }
        : { scope, data: null, loading: true, error: null, lastUpdated: null },
    );
    try {
      const result = await adminRequest<T>(path, "GET", undefined, {}, controller.signal);
      if (!controller.signal.aborted)
        setResult({ scope, data: result.data, loading: false, error: null, lastUpdated: new Date() });
    } catch (error) {
      if (!controller.signal.aborted)
        setResult({ scope, data: null, loading: false, error: adminError(error), lastUpdated: null });
    }
  }, [scope, path, enabled]);
  useEffect(() => {
    void doFetch();
    const timer = enabled && intervalMs ? setInterval(() => void doFetch(), intervalMs) : null;
    return () => {
      active.current?.abort();
      if (timer) clearInterval(timer);
    };
  }, [doFetch, intervalMs, enabled]);
  const current = result.scope === scope && enabled ? result : undefined;
  return {
    data: current?.data ?? null,
    loading: current?.loading ?? enabled,
    error: current?.error ?? null,
    isLive: !!current?.data,
    lastUpdated: current?.lastUpdated ?? null,
    refresh: () => void doFetch(),
  };
}
