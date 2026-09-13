import { useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { lecturerRequest } from "./api";

export function useAiLive<T>(jobId: string) {
  const [connected, setConnected] = useState(false),
    [job, setJob] = useState<T>();
  const socket = useRef<WebSocket | null>(null),
    selected = useRef(jobId);
  const pending = useRef(
    new Map<string, (v: { status: number; data?: T; error?: { code: string } }) => void>(),
  );
  useEffect(() => {
    selected.current = jobId;
    setJob(undefined);
    if (jobId && socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify({ type: "subscribe", jobId }));
  }, [jobId]);
  useEffect(() => {
    let closed = false,
      timer = 0,
      attempt = 0;
    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/web-session/ai-live`,
      );
      socket.current = ws;
      ws.onmessage = (event) => {
        if (closed) return;
        try {
          const value = JSON.parse(String(event.data));
          if (value.type === "ready") {
            setConnected(true);
            attempt = 0;
            if (selected.current) ws.send(JSON.stringify({ type: "subscribe", jobId: selected.current }));
          }
          if (value.type === "created") pending.current.get(value.key)?.(value);
          if (value.type === "unavailable" || (value.type === "job" && value.status !== 200)) ws.close();
          if (value.type === "job" && value.status === 200 && value.data?.jobId === selected.current)
            setJob(value.data);
          if (value.type === "notifications")
            window.dispatchEvent(new CustomEvent("ailss-notifications-updated", { detail: value.data }));
        } catch {
          /* Keep the HTTP fallback available for an invalid frame. */
        }
      };
      ws.onclose = (event) => {
        if (closed) return;
        setConnected(false);
        if (event.code !== 1008) timer = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** attempt++));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, []);
  async function create(body: unknown) {
    const key = crypto.randomUUID();
    if (socket.current?.readyState === WebSocket.OPEN && connected) {
      const result = await new Promise<{ status: number; data?: T; error?: { code: string } } | undefined>(
        (resolve) => {
          const timer = window.setTimeout(() => {
            pending.current.delete(key);
            resolve(undefined);
          }, 18000);
          pending.current.set(key, (value) => {
            clearTimeout(timer);
            pending.current.delete(key);
            resolve(value);
          });
          socket.current!.send(JSON.stringify({ type: "create", key, body }));
        },
      );
      if (result) {
        if (result.status >= 400) throw new ApiError(result.status, result.error?.code || "UNAVAILABLE");
        return { data: result.data! };
      }
    }
    // A lost socket acknowledgement must replay the same logical command.
    return lecturerRequest<T>("/ai/quiz-jobs", "POST", body, { "Idempotency-Key": key });
  }
  return { connected, job, create };
}
