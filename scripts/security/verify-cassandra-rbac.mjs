import { execFileSync } from "node:child_process";
import { readEnv, required } from "../dev/env.mjs";

const env = await readEnv();
const profile = process.env.AILSS_PROFILE ?? "dev-core";
const service = profile === "research" ? "cassandra-node1" : "cassandra-dev";
const compose = (...args) =>
  execFileSync(
    "docker",
    ["compose", "--env-file", ".env", "--profile", profile, "exec", "-T", service, "cqlsh", ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
function succeeds(user, password, statement) {
  compose("-u", user, `--password=${password}`, "-e", statement);
}
function denied(user, password, statement, label) {
  try {
    succeeds(user, password, statement);
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("unexpectedly succeeded")) throw error;
  }
}
succeeds(
  "svc_learning",
  required(env, "CASSANDRA_SVC_LEARNING_PASSWORD"),
  "SELECT course_id FROM learning_keyspace.course_by_id LIMIT 1;",
);
succeeds(
  "svc_assessment",
  required(env, "CASSANDRA_SVC_ASSESSMENT_PASSWORD"),
  "SELECT quiz_id FROM assessment_keyspace.quiz_by_id LIMIT 1;",
);
denied(
  "svc_learning",
  required(env, "CASSANDRA_SVC_LEARNING_PASSWORD"),
  "SELECT quiz_id FROM assessment_keyspace.quiz_by_id LIMIT 1;",
  "foreign keyspace read",
);
denied(
  "svc_assessment",
  required(env, "CASSANDRA_SVC_ASSESSMENT_PASSWORD"),
  "CREATE TABLE assessment_keyspace.phase6_forbidden (id uuid PRIMARY KEY);",
  "runtime DDL",
);
denied("svc_learning", "definitely-wrong-password", "SELECT now() FROM system.local;", "wrong credential");
console.log(
  JSON.stringify({
    stage: "cassandra-rbac",
    status: "PASS",
    ownKeyspace: 2,
    foreignDenied: true,
    runtimeDdlDenied: true,
    wrongPasswordDenied: true,
  }),
);
