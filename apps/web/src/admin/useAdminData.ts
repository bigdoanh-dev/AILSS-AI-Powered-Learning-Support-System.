import { useCallback, useEffect, useRef, useState } from "react";
import { adminRequest } from "./api";

export interface AdminDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isLive: boolean;
  refresh: () => void;
  lastUpdated: Date | null;
}

/**
 * Hook polling dữ liệu từ Admin BFF API.
 * - Tự động refresh theo `intervalMs` (mặc định 30s).
 * - Khi backend trả 404/503 → giữ fallback data, isLive=false.
 * - AbortController cleanup khi unmount.
 */
export function useAdminData<T>(
  path: string,
  options: {
    intervalMs?: number;
    fallback?: T | null;
    enabled?: boolean;
  } = {},
): AdminDataState<T> {
  const { intervalMs = 30_000, fallback = null, enabled = true } = options;

  const [data, setData] = useState<T | null>(fallback);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const rev = useRef(0);

  const doFetch = useCallback(async () => {
    if (!enabled) return;
    const epoch = ++rev.current;
    setLoading(true);
    try {
      const result = await adminRequest<T>(path);
      if (epoch !== rev.current) return;
      setData(result.data);
      setIsLive(true);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      if (epoch !== rev.current) return;
      setError(e instanceof Error ? e.message : "Không thể tải dữ liệu từ máy chủ");
      setIsLive(false);
    } finally {
      if (epoch === rev.current) setLoading(false);
    }
  }, [path, enabled]);

  const refresh = useCallback(() => void doFetch(), [doFetch]);

  useEffect(() => {
    void doFetch();
    if (!intervalMs) return;
    const timer = setInterval(() => void doFetch(), intervalMs);
    return () => clearInterval(timer);
  }, [doFetch, intervalMs]);

  return { data, loading, error, isLive, refresh, lastUpdated };
}
