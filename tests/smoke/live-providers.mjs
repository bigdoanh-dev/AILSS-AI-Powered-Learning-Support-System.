import { mkdir, writeFile } from "node:fs/promises";
import { readEnv } from "../../scripts/dev/env.mjs";

// Explicit opt-in: two small requests, no retries, no real course/user data.
if (!process.argv.includes("--live")) throw new Error("Pass --live to authorize paid API requests");
const env = await readEnv();
const prompt = 'Compute 1+1. Return only this JSON shape: {"answer":2}. No explanation.';
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const results = [];
for (const provider of ["openai", "gemini"]) {
  const name = provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY";
  let key = (process.env[name] || env[name] || "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))
    key = key.slice(1, -1);
  const model = provider === "openai" ? "gpt-5-mini" : "gemini-flash-latest";
  const result = { provider, model, status: "FAIL", requests: 0 };
  const started = Date.now();
  try {
    if (!key || key === "<INJECTED>" || key.startsWith("THAY_")) {
      result.reason = "MISSING_CREDENTIAL";
    } else {
      result.requests = 1;
      const response = await fetch(
        provider === "openai"
          ? "https://api.openai.com/v1/chat/completions"
          : "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
        {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            ...(provider === "openai" ? { authorization: `Bearer ${key}` } : { "x-goog-api-key": key }),
          },
          body: JSON.stringify(
            provider === "openai"
              ? {
                  model,
                  messages: [{ role: "user", content: prompt }],
                  response_format: { type: "json_object" },
                  reasoning_effort: "minimal",
                  max_completion_tokens: 2048,
                  store: false,
                }
              : {
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: { maxOutputTokens: 2048, responseMimeType: "application/json" },
                },
          ),
          signal: AbortSignal.timeout(45_000),
        },
      );
      result.httpStatus = response.status;
      const data = await response.json();
      if (!response.ok) {
        const code = data.error?.code;
        result.reason =
          code === "insufficient_quota"
            ? "INSUFFICIENT_QUOTA"
            : response.status === 401 || response.status === 403
              ? "AUTH_OR_PERMISSION_DENIED"
              : response.status === 429
                ? "RATE_OR_QUOTA_LIMIT"
                : response.status === 404
                  ? "MODEL_OR_ENDPOINT_UNAVAILABLE"
                  : "PROVIDER_REQUEST_FAILED";
        // Never log raw provider errors: they may echo the credential/request.
      } else {
        const content =
          provider === "openai"
            ? data.choices?.[0]?.message?.content
            : data.candidates?.[0]?.content?.parts
                ?.filter((part) => !part.thought)
                .map((part) => part.text || "")
                .join("");
        if (JSON.parse(content).answer !== 2) throw new Error("INVALID_OUTPUT");
        result.status = "PASS";
        result.outputValidated = true;
        result.inputTokens =
          provider === "openai" ? data.usage?.prompt_tokens : data.usageMetadata?.promptTokenCount;
        result.outputTokens =
          provider === "openai" ? data.usage?.completion_tokens : data.usageMetadata?.candidatesTokenCount;
      }
    }
  } catch (error) {
    result.reason =
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "TIMEOUT_NO_RETRY"
        : "NETWORK_OR_INVALID_RESPONSE";
  }
  result.elapsedMs = Date.now() - started;
  results.push(result);
  console.log(JSON.stringify(result));
}
const summary = {
  stage: "direct-live-provider-smoke",
  runId,
  status: results.every((result) => result.status === "PASS") ? "PASS" : "FAIL",
  TEST_PROVIDER_ONLY: false,
  scope: "Direct provider API only; not AILSS quiz generation end-to-end acceptance",
  maxRequestsPerProvider: 1,
  maxOutputTokenBudgetPerProvider: 2048,
  results,
};
const directory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("live-providers-summary.json", directory), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ status: summary.status, evidence: decodeURIComponent(directory.pathname) }));
if (summary.status !== "PASS") process.exitCode = 1;
