import * as amqp from "amqplib";
import { readEnv, required } from "../dev/env.mjs";

const env = await readEnv();
function url(user, secretName) {
  const value = new URL("amqp://127.0.0.1:5672/%2Failss");
  value.username = user;
  value.password = required(env, secretName);
  return value.toString();
}
let denied = false;
let unauthorizedConnection;
let unauthorizedChannel;
try {
  unauthorizedConnection = await amqp.connect(url("mq_identity", "RABBITMQ_MQ_IDENTITY_PASSWORD"));
  unauthorizedConnection.on("error", () => undefined);
  unauthorizedChannel = await unauthorizedConnection.createChannel();
  unauthorizedChannel.on("error", () => undefined);
  await unauthorizedChannel.consume("audit.q", () => undefined, { noAck: false });
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("ACCESS-REFUSED")) throw error;
  denied = true;
} finally {
  if (unauthorizedChannel) await unauthorizedChannel.close().catch(() => undefined);
  if (unauthorizedConnection) await unauthorizedConnection.close().catch(() => undefined);
}
if (!denied) throw new Error("RabbitMQ unauthorized consume unexpectedly succeeded");

const eventId = crypto.randomUUID();
const correlationId = crypto.randomUUID();
const event = {
  specVersion: "1.0",
  eventId,
  eventType: "system.audit.requested.v1",
  occurredAt: new Date().toISOString(),
  producer: "identity-service",
  correlationId,
  aggregate: { type: "phase6-smoke", id: crypto.randomUUID(), version: 1 },
  data: { safeFixture: true },
};
const producerConnection = await amqp.connect(url("mq_identity", "RABBITMQ_MQ_IDENTITY_PASSWORD"));
const producer = await producerConnection.createConfirmChannel();
producer.publish("ailss.domain.events", "system.audit.requested.v1", Buffer.from(JSON.stringify(event)), {
  persistent: true,
  mandatory: true,
  messageId: eventId,
  correlationId,
});
await producer.waitForConfirms();
await producer.close();
await producerConnection.close();

const consumerConnection = await amqp.connect(url("mq_audit_worker", "RABBITMQ_MQ_AUDIT_WORKER_PASSWORD"));
const consumer = await consumerConnection.createChannel();
const received = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("manual ACK fixture timed out")), 10_000);
  void consumer.consume(
    "audit.smoke.q",
    (message) => {
      if (!message) return;
      const value = JSON.parse(message.content.toString("utf8"));
      if (value.eventId !== eventId) {
        consumer.nack(message, false, true);
        return;
      }
      consumer.ack(message);
      clearTimeout(timer);
      resolve({
        eventId: value.eventId,
        correlationId: value.correlationId,
        redelivered: message.fields.redelivered,
      });
    },
    { noAck: false },
  );
});
await consumer.close();
await consumerConnection.close();
console.log(
  JSON.stringify({
    stage: "rabbitmq-acl-and-delivery",
    status: "PASS",
    unauthorizedConsumeDenied: true,
    publisherConfirm: true,
    manualAck: true,
    received,
  }),
);
