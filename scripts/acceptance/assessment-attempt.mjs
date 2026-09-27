// P8.2 is a strict superset of the real-Cassandra P8.1 fixture. The imported
// scenario creates canonical Course/Class targets, immutable quiz snapshots,
// real users and validates the shared Assessment authorization foundation.
// Attempt-specific assertions are kept in that fixture so one run has one
// evidence directory and one physical-state probe.
process.env.AILSS_ACCEPTANCE_P8_2 = "true";
await import("./assessment-quiz.mjs");
