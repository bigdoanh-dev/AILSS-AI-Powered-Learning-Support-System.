import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ApiError as MobileApiError, Transport } from "../src/api";
import { ApiError as WebApiError, errorMessage, request as webRequest } from "../../web/src/lib/api";

const features = [
  { feature: "Mastery", path: "/mastery/courses/00000000-0000-4000-8000-000000000041", method: "GET" },
  { feature: "Study Plan", path: "/study-plan/current?courseId=00000000-0000-4000-8000-000000000041", method: "GET" },
  { feature: "Assessment", path: "/assessments/attempts/00000000-0000-4000-8000-000000000041/submit", method: "POST" },
  { feature: "Tutor", path: "/assistant/chat", method: "POST" },
] as const;

const contractCases = [
  { scenario: "401 authentication required", status: 401, category: "AUTHENTICATION_FAILURE" },
  { scenario: "403 forbidden", status: 403, category: "FORBIDDEN" },
  { scenario: "404 resource missing", status: 404, category: "NOT_FOUND" },
  { scenario: "409 domain conflict", status: 409, category: "CONFLICT" },
  { scenario: "429 rate limited", status: 429, category: "RATE_LIMITED" },
  { scenario: "500 service failure", status: 500, category: "SERVICE_UNAVAILABLE" },
] as const;

type Classification = { category: string; message: string; status: number | null };
type ParityRow = {
  feature: string;
  scenario: string;
  backendStatus: number | null;
  webInterpretation: string;
  mobileInterpretation: string;
  semanticParity: boolean;
  semanticCategory: string;
};

function categoryForStatus(status: number): string {
  if (status === 401) return "AUTHENTICATION_FAILURE";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVICE_UNAVAILABLE";
  return "UNEXPECTED_STATUS";
}

function classifyWeb(error: unknown): Classification {
  if (error instanceof WebApiError)
    return { category: categoryForStatus(error.status), message: errorMessage(error), status: error.status };
  if (error instanceof DOMException && error.name === "AbortError")
    return { category: "CANCELLED", message: errorMessage(error), status: null };
  if (error instanceof DOMException && error.name === "TimeoutError")
    return { category: "TRANSIENT_TIMEOUT", message: errorMessage(error), status: null };
  return { category: "UNEXPECTED_CLIENT_ERROR", message: errorMessage(error), status: null };
}

function classifyMobile(error: unknown): Classification {
  if (!(error instanceof MobileApiError))
    return { category: "UNEXPECTED_CLIENT_ERROR", message: "unexpected client error", status: null };
  if (error.kind === "cancelled") return { category: "CANCELLED", message: error.message, status: null };
  if (error.kind === "timeout") return { category: "TRANSIENT_TIMEOUT", message: error.message, status: null };
  return {
    category: error.status ? categoryForStatus(error.status) : "UNEXPECTED_CLIENT_ERROR",
    message: error.message,
    status: error.status || null,
  };
}

async function main() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const status = Number(url.searchParams.get("injectStatus"));
    const scenario = url.searchParams.get("scenario");
    if (scenario === "timeout") {
      setTimeout(() => {
        response.writeHead(504, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "UPSTREAM_TIMEOUT" } }));
      }, 250);
      return;
    }
    response.writeHead(status, {
      "content-type": "application/json",
      "x-request-id": "phase41-error-parity-fixture",
    });
    response.end(JSON.stringify({ error: { code: `INJECTED_${status}` } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const nativeFetch = globalThis.fetch;
  const nativeTimeout = AbortSignal.timeout;
  let webTimeoutMilliseconds = 15_000;
  const navigatorOnlineDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine");
  const rows: ParityRow[] = [];

  try {
    Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const webAbortSignal = AbortSignal as unknown as { timeout: (milliseconds: number) => AbortSignal };
    webAbortSignal.timeout = (milliseconds) => nativeTimeout(Math.min(milliseconds, webTimeoutMilliseconds));
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), origin);
      return nativeFetch(url, init);
    }) as typeof fetch;

    const mobileTransport = new Transport(origin);
    for (const feature of features) {
      for (const testCase of contractCases) {
        const mobilePath = `/api/v1${feature.path}${feature.path.includes("?") ? "&" : "?"}injectStatus=${testCase.status}`;
        const webPath = `${feature.path}${feature.path.includes("?") ? "&" : "?"}injectStatus=${testCase.status}`;
        let mobileError: unknown;
        let webError: unknown;
        try {
          await mobileTransport.request(mobilePath, {
            method: feature.method,
            ...(feature.method === "POST" ? { body: { fixture: true } } : {}),
          });
        } catch (error) {
          mobileError = error;
        }
        try {
          webTimeoutMilliseconds = 15_000;
          await webRequest(webPath, {
            method: feature.method,
            ...(feature.method === "POST" ? { body: JSON.stringify({ fixture: true }) } : {}),
          });
        } catch (error) {
          webError = error;
        }
        assert.ok(mobileError, `${feature.feature} Mobile unexpectedly accepted HTTP ${testCase.status}`);
        assert.ok(webError, `${feature.feature} Web unexpectedly accepted HTTP ${testCase.status}`);
        const mobile = classifyMobile(mobileError);
        const web = classifyWeb(webError);
        const semanticParity =
          mobile.category === testCase.category && web.category === testCase.category &&
          mobile.status === testCase.status && web.status === testCase.status;
        assert.equal(
          semanticParity,
          true,
          `${feature.feature} did not preserve HTTP ${testCase.status} semantics: ` +
            `web=${web.category}/${web.status}, mobile=${mobile.category}/${mobile.status}`,
        );
        rows.push({
          feature: feature.feature,
          scenario: testCase.scenario,
          backendStatus: testCase.status,
          webInterpretation: web.message,
          mobileInterpretation: mobile.message,
          semanticParity,
          semanticCategory: testCase.category,
        });
      }

      const timeoutPath = `/api/v1${feature.path}${feature.path.includes("?") ? "&" : "?"}scenario=timeout`;
      const webTimeoutPath = `${feature.path}${feature.path.includes("?") ? "&" : "?"}scenario=timeout`;
      let mobileTimeout: unknown;
      let webTimeout: unknown;
      try {
        await mobileTransport.request(timeoutPath, {
          method: feature.method,
          timeoutMs: 40,
          ...(feature.method === "POST" ? { body: { fixture: true } } : {}),
        });
      } catch (error) {
        mobileTimeout = error;
      }
      try {
        webTimeoutMilliseconds = 40;
        await webRequest(webTimeoutPath, {
          method: feature.method,
          ...(feature.method === "POST" ? { body: JSON.stringify({ fixture: true }) } : {}),
        });
      } catch (error) {
        webTimeout = error;
      }
      assert.ok(mobileTimeout, `${feature.feature} Mobile unexpectedly accepted a delayed response`);
      assert.ok(webTimeout, `${feature.feature} Web unexpectedly accepted a delayed response`);
      const mobileTimeoutResult = classifyMobile(mobileTimeout);
      const webTimeoutResult = classifyWeb(webTimeout);
      const timeoutParity = mobileTimeoutResult.category === "TRANSIENT_TIMEOUT" &&
        webTimeoutResult.category === "TRANSIENT_TIMEOUT";
      assert.equal(timeoutParity, true, `${feature.feature} timeout became an unexpected success/error`);
      rows.push({
        feature: feature.feature,
        scenario: "client/upstream timeout",
        backendStatus: 504,
        webInterpretation: webTimeoutResult.message,
        mobileInterpretation: mobileTimeoutResult.message,
        semanticParity: timeoutParity,
        semanticCategory: "TRANSIENT_TIMEOUT",
      });

      const mobileAbort = new AbortController();
      const webAbort = new AbortController();
      mobileAbort.abort();
      webAbort.abort();
      let mobileCancelled: unknown;
      let webCancelled: unknown;
      try {
        await mobileTransport.request(`/api/v1${feature.path}`, {
          method: feature.method,
          signal: mobileAbort.signal,
          ...(feature.method === "POST" ? { body: { fixture: true } } : {}),
        });
      } catch (error) {
        mobileCancelled = error;
      }
      try {
        await webRequest(feature.path, {
          method: feature.method,
          signal: webAbort.signal,
          ...(feature.method === "POST" ? { body: JSON.stringify({ fixture: true }) } : {}),
        });
      } catch (error) {
        webCancelled = error;
      }
      assert.ok(mobileCancelled, `${feature.feature} Mobile unexpectedly accepted a cancelled request`);
      assert.ok(webCancelled, `${feature.feature} Web unexpectedly accepted a cancelled request`);
      const mobileCancelledResult = classifyMobile(mobileCancelled);
      const webCancelledResult = classifyWeb(webCancelled);
      const cancelParity = mobileCancelledResult.category === "CANCELLED" &&
        webCancelledResult.category === "CANCELLED";
      assert.equal(cancelParity, true, `${feature.feature} cancellation was not preserved`);
      rows.push({
        feature: feature.feature,
        scenario: "request cancellation",
        backendStatus: null,
        webInterpretation: webCancelledResult.message,
        mobileInterpretation: mobileCancelledResult.message,
        semanticParity: cancelParity,
        semanticCategory: "CANCELLED",
      });
    }

    const evidence = {
      generatedAt: new Date().toISOString(),
      backend: "local HTTP error-injection fixture; no production or staging endpoint",
      clientCoverage: ["Web request/error mapping", "Mobile Transport"],
      caseCount: rows.length,
      allSemanticParity: rows.every((row) => row.semanticParity),
      cases: rows,
    };
    assert.equal(evidence.caseCount, 32);
    assert.equal(evidence.allSemanticParity, true);
    const output = fileURLToPath(new URL("../docs/phase41/cross-platform-error-parity.json", import.meta.url));
    let previousEvidence: typeof evidence | null = null;
    try {
      previousEvidence = JSON.parse(await readFile(output, "utf8")) as typeof evidence;
    } catch {
      // Missing or invalid evidence is regenerated from the current run.
    }
    if (previousEvidence) {
      if (
        JSON.stringify({ ...previousEvidence, generatedAt: undefined }) ===
        JSON.stringify({ ...evidence, generatedAt: undefined })
      ) {
        evidence.generatedAt = previousEvidence.generatedAt;
      }
    }
    const content = `${JSON.stringify(evidence, null, 2)}\n`;
    if ((await readFile(output, "utf8").catch(() => null)) !== content) {
      await writeFile(output, content, { mode: 0o600 });
    }
    console.log(JSON.stringify({ status: "PASS", caseCount: evidence.caseCount, output }));
  } finally {
    globalThis.fetch = nativeFetch;
    const webAbortSignal = AbortSignal as unknown as { timeout: (milliseconds: number) => AbortSignal };
    webAbortSignal.timeout = nativeTimeout;
    if (navigatorOnlineDescriptor)
      Object.defineProperty(globalThis.navigator, "onLine", navigatorOnlineDescriptor);
    else Reflect.deleteProperty(globalThis.navigator, "onLine");
    server.closeAllConnections();
    server.close();
  }
}

void main().catch((error) => {
  console.error("Phase 41 error parity failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
