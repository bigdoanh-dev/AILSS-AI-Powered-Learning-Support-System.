import { readEnv, required } from "./env.mjs";

const env = await readEnv();
const adminUser = required(env, "RABBITMQ_ADMIN_USERNAME");
const adminPassword = required(env, "RABBITMQ_ADMIN_PASSWORD");
const base = "http://127.0.0.1:15672/api";
const auth = `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString("base64")}`;
async function api(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: auth, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`RabbitMQ API ${method} ${path} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined : response.json().catch(() => undefined);
}

await api("/vhosts/%2Failss", "PUT", {});
const users = [
  ["mq_identity", "RABBITMQ_MQ_IDENTITY_PASSWORD", "^ailss\\.domain\\.events$", "^$"],
  [
    "mq_learning",
    "RABBITMQ_MQ_LEARNING_PASSWORD",
    "^ailss\\.(domain\\.events|system\\.jobs|dlx)$",
    "^(learning\\.entitlement\\.fulfill|assessment\\.quiz\\.(submitted|graded)\\.mastery|learning\\.lesson\\.completed\\.mastery)\\..*$",
  ],
  ["mq_classroom", "RABBITMQ_MQ_CLASSROOM_PASSWORD", "^ailss\\.(domain\\.events|notifications)$", "^$"],
  ["mq_assessment", "RABBITMQ_MQ_ASSESSMENT_PASSWORD", "^ailss\\.(domain\\.events|notifications)$", "^$"],
  ["mq_interaction", "RABBITMQ_MQ_INTERACTION_PASSWORD", "^ailss\\.domain\\.events$", "^$"],
  ["mq_ai_service", "RABBITMQ_MQ_AI_SERVICE_PASSWORD", "^ailss\\.(ai\\.jobs|domain\\.events)$", "^$"],
  [
    "mq_ai_worker",
    "RABBITMQ_MQ_AI_WORKER_PASSWORD",
    "^ailss\\.(ai\\.jobs|domain\\.events|dlx)$",
    "^ai\\.quiz\\.generate\\..*$",
  ],
  [
    "mq_document_worker",
    "RABBITMQ_MQ_DOCUMENT_WORKER_PASSWORD",
    "^ailss\\.(ai\\.jobs|domain\\.events|dlx)$",
    "^ai\\.document\\.extract\\..*$",
  ],
  [
    "mq_notification_worker",
    "RABBITMQ_MQ_NOTIFICATION_WORKER_PASSWORD",
    "^ailss\\.(notifications|domain\\.events|dlx)$",
    "^notification\\..*$",
  ],
  ["mq_audit_worker", "RABBITMQ_MQ_AUDIT_WORKER_PASSWORD", "^ailss\\.(domain\\.events|dlx)$", "^audit\\..*$"],
  [
    "mq_reconcile_worker",
    "RABBITMQ_MQ_RECONCILE_WORKER_PASSWORD",
    "^ailss\\.(system\\.jobs|domain\\.events|dlx)$",
    "^projection\\.reconcile\\..*$",
  ],
];
for (const [user, secretName, write, read] of users) {
  await api(`/users/${user}`, "PUT", { password: required(env, secretName), tags: "" });
  await api(`/permissions/%2Failss/${user}`, "PUT", { configure: "^$", write, read });
}

const exchanges = [
  ["ailss.domain.events", "topic"],
  ["ailss.ai.jobs", "direct"],
  ["ailss.notifications", "direct"],
  ["ailss.system.jobs", "direct"],
  ["ailss.dlx", "direct"],
];
for (const [name, type] of exchanges)
  await api(`/exchanges/%2Failss/${encodeURIComponent(name)}`, "PUT", {
    type,
    durable: true,
    auto_delete: false,
    internal: false,
    arguments: {},
  });

const queues = [
  {
    queue: "identity.user.registered.q",
    exchange: "ailss.domain.events",
    key: "identity.user.registered.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "identity.user.status_changed.q",
    exchange: "ailss.domain.events",
    key: "identity.user.status_changed.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "learning.course.created.q",
    exchange: "ailss.domain.events",
    key: "learning.course.created.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "learning.course.published.q",
    exchange: "ailss.domain.events",
    key: "learning.course.published.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "classroom.class.created.q",
    exchange: "ailss.domain.events",
    key: "classroom.class.created.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "classroom.student.joined.q",
    exchange: "ailss.domain.events",
    key: "classroom.student.joined.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "assessment.quiz.submitted.q",
    exchange: "ailss.domain.events",
    key: "assessment.quiz.submitted.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "assessment.quiz.submitted.mastery.q",
    exchange: "ailss.domain.events",
    key: "assessment.quiz.submitted.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "assessment.quiz.graded.mastery.q",
    exchange: "ailss.domain.events",
    key: "assessment.quiz.graded.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "ai.quiz.generate.q",
    exchange: "ailss.ai.jobs",
    key: "ai.quiz.generate.v1",
    retry: [30_000, 120_000, 600_000],
  },
  {
    queue: "ai.document.extract.q",
    exchange: "ailss.ai.jobs",
    key: "ai.document.extract.v1",
    retry: [60_000, 300_000, 1_800_000],
  },
  {
    queue: "notification.q",
    exchange: "ailss.notifications",
    key: "system.notification.requested.v1",
    retry: [10_000, 30_000, 120_000, 600_000],
  },
  {
    queue: "audit.q",
    exchange: "ailss.domain.events",
    key: "system.audit.requested.v1",
    retry: [5_000, 30_000, 120_000, 600_000],
  },
  {
    queue: "projection.reconcile.q",
    exchange: "ailss.system.jobs",
    key: "system.projection.reconcile.v1",
    retry: [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000],
  },
  {
    queue: "learning.entitlement.fulfill.q",
    exchange: "ailss.domain.events",
    key: "learning.order.paid.v1",
    retry: [10_000, 60_000, 300_000, 1_800_000, 7_200_000],
  },
  {
    queue: "learning.course.enrolled.q",
    exchange: "ailss.domain.events",
    key: "learning.course.enrolled.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "learning.progress.updated.q",
    exchange: "ailss.domain.events",
    key: "learning.progress.updated.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "learning.lesson.completed.mastery.q",
    exchange: "ailss.domain.events",
    key: "learning.progress.updated.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "interaction.review.created.q",
    exchange: "ailss.domain.events",
    key: "interaction.review.created.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "interaction.report.created.q",
    exchange: "ailss.domain.events",
    key: "interaction.report.created.v1",
    retry: [5_000, 30_000, 120_000],
  },
  {
    queue: "interaction.content.moderated.q",
    exchange: "ailss.domain.events",
    key: "interaction.content.moderated.v1",
    retry: [5_000, 30_000, 120_000],
  },
];
for (const item of queues) {
  const dlq = item.queue.replace(/\.q$/, ".dlq");
  await api(`/queues/%2Failss/${encodeURIComponent(item.queue)}`, "PUT", {
    durable: true,
    auto_delete: false,
    arguments: { "x-queue-type": "classic" },
  });
  await api(
    `/bindings/%2Failss/e/${encodeURIComponent(item.exchange)}/q/${encodeURIComponent(item.queue)}`,
    "POST",
    { routing_key: item.key, arguments: {} },
  );
  await api(`/queues/%2Failss/${encodeURIComponent(dlq)}`, "PUT", {
    durable: true,
    auto_delete: false,
    arguments: { "x-queue-type": "classic" },
  });
  await api(`/bindings/%2Failss/e/${encodeURIComponent("ailss.dlx")}/q/${encodeURIComponent(dlq)}`, "POST", {
    routing_key: dlq,
    arguments: {},
  });
  for (const [index, ttl] of item.retry.entries()) {
    const retryQueue = `${item.queue}.retry.${index + 1}`;
    const retryKey = `${item.key}.retry.${index + 1}`;
    await api(`/queues/%2Failss/${encodeURIComponent(retryQueue)}`, "PUT", {
      durable: true,
      auto_delete: false,
      arguments: {
        "x-message-ttl": ttl,
        "x-dead-letter-exchange": item.exchange,
        "x-dead-letter-routing-key": item.key,
        "x-queue-type": "classic",
      },
    });
    await api(
      `/bindings/%2Failss/e/${encodeURIComponent(item.exchange)}/q/${encodeURIComponent(retryQueue)}`,
      "POST",
      { routing_key: retryKey, arguments: {} },
    );
  }
}

// Development smoke probe: isolated from the real audit backlog so verification never ACKs business events.
await api("/queues/%2Failss/audit.smoke.q", "PUT", {
  durable: true,
  auto_delete: false,
  arguments: { "x-queue-type": "classic", "x-message-ttl": 300_000 },
});
await api(
  `/bindings/%2Failss/e/${encodeURIComponent("ailss.domain.events")}/q/${encodeURIComponent("audit.smoke.q")}`,
  "POST",
  { routing_key: "system.audit.requested.v1", arguments: {} },
);

const topicPermissions = {
  mq_identity: "^(identity\\..*|system\\.audit\\.requested\\.v1)$",
  mq_learning: "^(learning\\..*|assessment\\.quiz\\.(submitted|graded)\\.v1\\.retry\\.[1-3]|system\\.audit\\.requested\\.v1)$",
  mq_classroom: "^(classroom\\..*|system\\.(audit|notification)\\.requested\\.v1)$",
  mq_assessment: "^(assessment\\..*|system\\.(audit|notification)\\.requested\\.v1)$",
  mq_interaction: "^(interaction\\..*|system\\.audit\\.requested\\.v1)$",
  mq_ai_service: "^(ai\\..*|system\\.audit\\.requested\\.v1)$",
  mq_ai_worker: "^(ai\\..*|system\\.audit\\.requested\\.v1)$",
  mq_document_worker: "^(ai\\..*|system\\.audit\\.requested\\.v1)$",
  mq_audit_worker: "^$",
  mq_reconcile_worker: "^system\\.(projection\\.reconcile|audit\\.requested)\\.v1$",
};
for (const [user, write] of Object.entries(topicPermissions)) {
  await api(`/topic-permissions/%2Failss/${user}`, "PUT", {
    exchange: "ailss.domain.events",
    write,
    read: ".*",
  });
}
console.log(
  JSON.stringify({
    stage: "rabbitmq-provision",
    status: "PASS",
    exchanges: exchanges.length,
    workQueues: queues.length,
    dlqs: queues.length,
    runtimeUsers: users.length,
  }),
);
