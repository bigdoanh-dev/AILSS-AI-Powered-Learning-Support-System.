import { readEnv, required } from "./env.mjs";
const env = await readEnv();
const auth = `Basic ${Buffer.from(`${required(env, "RABBITMQ_ADMIN_USERNAME")}:${required(env, "RABBITMQ_ADMIN_PASSWORD")}`).toString("base64")}`;
async function list(path) {
  const response = await fetch(`http://127.0.0.1:15672/api${path}`, { headers: { authorization: auth } });
  if (!response.ok) throw new Error(`${path}:${response.status}`);
  return response.json();
}
const exchanges = (await list("/exchanges/%2Failss")).filter((value) => value.name.startsWith("ailss."));
const queues = await list("/queues/%2Failss");
const exactExchanges = [
  "ailss.domain.events",
  "ailss.ai.jobs",
  "ailss.notifications",
  "ailss.system.jobs",
  "ailss.dlx",
];
const workQueues = [
  "identity.user.status_changed.q",
  "ai.quiz.generate.q",
  "ai.document.extract.q",
  "notification.q",
  "audit.q",
  "projection.reconcile.q",
  "learning.entitlement.fulfill.q",
  "learning.course.enrolled.q",
  "learning.progress.updated.q",
  "interaction.review.created.q",
  "interaction.report.created.q",
  "interaction.content.moderated.q",
  "classroom.class.created.q",
  "classroom.student.joined.q",
  "assessment.quiz.submitted.q",
];
const dlqs = workQueues.map((name) => name.replace(/\.q$/, ".dlq"));
for (const name of [...exactExchanges, ...workQueues, ...dlqs]) {
  const found = (name.includes(".q") || name.endsWith(".dlq") ? queues : exchanges).some(
    (item) => item.name === name,
  );
  if (!found) throw new Error(`Missing RabbitMQ resource: ${name}`);
}
if (exchanges.length !== 5) throw new Error(`Unexpected AILSS exchange count: ${exchanges.length}`);
console.log(
  JSON.stringify({
    stage: "rabbitmq-verify",
    status: "PASS",
    exchanges: 5,
    workQueues: workQueues.length,
    dlqs: dlqs.length,
    totalQueues: queues.length,
  }),
);
