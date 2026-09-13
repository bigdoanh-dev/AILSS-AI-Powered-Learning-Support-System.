const allowed = new Set([
  "A_CANDIDATE",
  "B_TRANSACTION",
  "C1_OUTBOX_DUE_PREPARED",
  "C2_OUTBOX_ID_PREPARED",
  "D_ORDER_PAID",
  "E1_OUTBOX_DUE_READY",
  "E2_OUTBOX_ID_READY",
  "F_READY_BEFORE_PUBLISH",
  "G_PUBLISHED_BEFORE_ACK",
  "H_ENTITLEMENT_SCHEDULED",
]);

/** Test-only process-death hook. It is inert unless all dev-async guards match. */
export function crashAfter(boundary: string, identity: Record<string, unknown>): void {
  const selected = process.env.AILSS_TEST_CRASH_BOUNDARY;
  const runId = process.env.AILSS_TEST_CRASH_RUN_ID;
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.AILSS_PROFILE !== "dev-async" ||
    !runId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(runId) ||
    selected !== boundary ||
    !allowed.has(boundary)
  )
    return;
  // Deliberately exclude callback payloads and credentials from evidence.
  console.log(JSON.stringify({ event: "ailss.test.process-crash", runId, boundary, ...identity }));
  process.exit(86);
}
