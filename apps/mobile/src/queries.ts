import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { runtime } from "./runtime";
import { ApiError, type RequestOptions } from "./api";

export function useMobileQuery<T>(path: string | null, decode: (value: unknown) => T, includeMeta = false) {
  const session = runtime!;
  const auth = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const scope = `${auth.user?.userId ?? ""}:${path}`;
  const [result, setResult] = useState<{ scope: string; data?: T; error?: string }>({ scope: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ scope });
    if (path && auth.state === "AUTHENTICATED") {
      void session
        .request(path, { signal: controller.signal, includeMeta })
        .then(decode)
        .then((data) => {
          if (!controller.signal.aborted) setResult({ scope, data });
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setResult({ scope, error: cause instanceof ApiError ? cause.message : "Không thể đọc dữ liệu." });
        });
    }
    return () => controller.abort();
  }, [path, scope, revision, decode, session, auth.state, includeMeta]);
  const current = result.scope === scope ? result : { scope };
  return {
    data: current.data,
    error: current.error,
    loading: !!path && current.data === undefined && !current.error,
    retry: () => setRevision((v) => v + 1),
  };
}

/** Preserve a command key on ambiguous failure; a new body has its own key. */
export function useMobileCommand() {
  const keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const flight = useRef(false);
  async function run(path: string, body: unknown, options: RequestOptions = {}) {
    if (flight.current) return false;
    flight.current = true;
    setBusy(true);
    setMessage("");
    const fingerprint = JSON.stringify([path, options.method ?? "POST", options.headers, body]);
    const key = keys.current.get(fingerprint) ?? Crypto.randomUUID();
    keys.current.set(fingerprint, key);
    try {
      await runtime!.request(path, {
        ...options,
        method: options.method ?? "POST",
        body,
        idempotencyKey: key,
      });
      keys.current.delete(fingerprint);
      setMessage("Đã lưu trên hệ thống.");
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Không thể lưu.");
      return false;
    } finally {
      setBusy(false);
      flight.current = false;
    }
  }
  return { run, busy, message };
}
