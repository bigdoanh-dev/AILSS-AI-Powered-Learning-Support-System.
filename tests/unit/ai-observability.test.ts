import { expect, it } from "vitest";
import { createMetrics } from "../../packages/observability/src/index.js";

it("exports bounded AI reliability metrics", async () => {
  const metrics = createMetrics(`ai-observability-${crypto.randomUUID()}`);
  metrics.aiGenerations.inc({ outcome: "success" });
  metrics.aiProviderCalls.inc({ outcome: "failure", code: "RATE_LIMITED" });
  metrics.aiGenerationRetries.inc({ reason: "RATE_LIMITED" });
  metrics.aiCircuitRejections.inc();
  metrics.aiGenerationDuration.observe(0.25);

  const output = await metrics.registry.metrics();
  for (const name of [
    "ailss_ai_generation_total",
    "ailss_ai_provider_calls_total",
    "ailss_ai_generation_retry_total",
    "ailss_ai_circuit_rejections_total",
    "ailss_ai_generation_duration_seconds",
  ])
    expect(output).toContain(name);
  expect(output).not.toContain("private");
});
