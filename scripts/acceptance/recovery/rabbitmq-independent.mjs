import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { readEnv, required } from "../../dev/env.mjs";

const env = await readEnv();
const names = [
  "ailss-document-worker",
  "ailss-ai-worker",
  "ailss-notification-worker",
  "ailss-learning-service",
  "ailss-reconciliation-worker",
];
const inspect = () =>
  Object.fromEntries(
    names.map((name) => {
      const value = JSON.parse(
        execFileSync("docker", ["inspect", name, "--format", "{{json .}}"], { encoding: "utf8" }),
      );
      return [
        name,
        {
          id: value.Id,
          startedAt: value.State.StartedAt,
          restartCount: value.RestartCount,
          pid: value.State.Pid,
        },
      ];
    }),
  );
const auth = `Basic ${Buffer.from(`${required(env, "RABBITMQ_ADMIN_USERNAME")}:${required(env, "RABBITMQ_ADMIN_PASSWORD")}`).toString("base64")}`;
async function queues() {
  const response = await fetch("http://127.0.0.1:15672/api/queues/%2Failss", {
    headers: { authorization: auth },
  });
  assert.equal(response.status, 200);
  const rows = await response.json();
  return Object.fromEntries(rows.map((row) => [row.name, row.consumers]));
}
async function healthy() {
  for (let i = 0; i < 120; i++) {
    try {
      const state = execFileSync(
        "docker",
        ["inspect", "ailss-rabbitmq", "--format", "{{.State.Health.Status}}"],
        {
          encoding: "utf8",
        },
      ).trim();
      if (state === "healthy") return;
    } catch {
      // RabbitMQ is restarting.
    }
    await delay(500);
  }
  throw new Error("RabbitMQ health timeout");
}
const requiredQueues = [
  "ai.document.extract.q",
  "ai.quiz.generate.q",
  "notification.q",
  "learning.entitlement.fulfill.q",
];
const before = inspect();
const consumersBefore = await queues();
for (const queue of requiredQueues) assert.ok(consumersBefore[queue] > 0, `${queue} missing before restart`);
const brokerBefore = JSON.parse(
  execFileSync("docker", ["inspect", "ailss-rabbitmq", "--format", "{{json .}}"], { encoding: "utf8" }),
);
const restartRequestedAt = new Date();
execFileSync("docker", ["restart", "ailss-rabbitmq"], { stdio: "ignore" });
await healthy();
let consumersAfter;
let returnedAt;
for (let i = 0; i < 120; i++) {
  consumersAfter = await queues();
  if (requiredQueues.every((queue) => consumersAfter[queue] > 0)) {
    returnedAt = new Date();
    break;
  }
  await delay(500);
}
assert.ok(returnedAt, "required consumers did not reconnect");
const after = inspect();
for (const name of names) assert.deepEqual(after[name], before[name], `${name} identity changed`);
const result = {
  gate: "rabbitmq-independent-reconnect",
  status: "PASS",
  restartRequestedAt: restartRequestedAt.toISOString(),
  consumersReturnedAt: returnedAt.toISOString(),
  consumerReturnLatencyMs: returnedAt.getTime() - restartRequestedAt.getTime(),
  broker: {
    beforeId: brokerBefore.Id,
    beforeStartedAt: brokerBefore.State.StartedAt,
  },
  workers: before,
  consumersBefore: Object.fromEntries(requiredQueues.map((queue) => [queue, consumersBefore[queue]])),
  consumersAfter: Object.fromEntries(requiredQueues.map((queue) => [queue, consumersAfter[queue]])),
  freshWorkPending: ["Document", "AI", "Notification", "Commerce"],
};
await writeFile(
  "evidence/p12-9rc/process-crash/rabbitmq-independent.json",
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    gate: result.gate,
    status: result.status,
    consumerReturnLatencyMs: result.consumerReturnLatencyMs,
  }),
);
