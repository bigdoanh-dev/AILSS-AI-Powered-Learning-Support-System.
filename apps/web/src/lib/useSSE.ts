import { useEffect, useRef } from "react";

export interface SSEEvent {
  type: string;
  data?: unknown;
}

/**
 * Hook quản lý Server-Sent Events.
 * Auto-reconnect với exponential backoff (tối đa 60s).
 */
export function useSSE(url: string | null, onEvent: (event: SSEEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!url || typeof EventSource === "undefined") return;
    const targetUrl = url;

    let es: EventSource | null = null;
    let retryDelay = 2000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      try {
        es = new EventSource(targetUrl);
        es.onopen = () => {
          retryDelay = 2000;
        };
        es.onmessage = (e) => {
          try {
            onEventRef.current(JSON.parse(e.data) as SSEEvent);
          } catch {
            onEventRef.current({ type: "raw", data: e.data });
          }
        };
        for (const eventType of ["notification", "ping", "update"]) {
          es.addEventListener(eventType, (e) => {
            try {
              const parsed = JSON.parse((e as MessageEvent).data) as Record<string, unknown>;
              onEventRef.current({ ...parsed, type: eventType });
            } catch {
              onEventRef.current({ type: eventType });
            }
          });
        }
        es.onerror = () => {
          es?.close();
          es = null;
          if (!destroyed) {
            retryTimer = setTimeout(() => {
              retryDelay = Math.min(retryDelay * 2, 60_000);
              connect();
            }, retryDelay);
          }
        };
      } catch {
        /* invalid url */
      }
    }

    connect();
    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [url]);
}
