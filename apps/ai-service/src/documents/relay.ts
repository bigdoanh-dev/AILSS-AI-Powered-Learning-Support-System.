import { randomUUID } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import { eventEnvelopeSchema } from "../../../../packages/contracts/src/index.js";
import { RabbitPublisher } from "../../../../packages/rabbitmq/src/index.js";

export class AiDocumentRelay {
  private timer?: NodeJS.Timeout;
  private publisher: RabbitPublisher | undefined;
  private running = false;
  private readonly owner = `ai-document-relay-${randomUUID()}`;
  constructor(
    private readonly db: CassandraClient,
    private readonly url: string,
  ) {}
  start() {
    this.timer = setInterval(() => void this.poll(), 1000);
    this.timer.unref();
    void this.poll();
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.publisher?.close();
  }
  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      for (let days = 0; days < 2; days++) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - days);
        for (let shard = 0; shard < 16; shard++) {
          const rows = await this.db.execute(
            "SELECT due_day,shard,next_attempt_at,event_id,payload_json,state,lease_fence FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at<=? LIMIT 25",
            [types.LocalDate.fromString(d.toISOString().slice(0, 10)), shard, now],
            "LOCAL_QUORUM",
          );
          for (const r of rows) {
            if (String(r.state) !== "READY") continue;
            const fence = Number(r.lease_fence ?? 0) + 1,
              claim = await this.db.execute(
                "UPDATE pending_events_by_due_bucket SET state='PUBLISHING',lease_owner=?,lease_until=?,lease_fence=? WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='READY'",
                [
                  this.owner,
                  new Date(now.getTime() + 15000),
                  types.Long.fromNumber(fence),
                  r.due_day,
                  r.shard,
                  r.next_attempt_at,
                  r.event_id,
                ],
                "LOCAL_QUORUM",
                "LOCAL_SERIAL",
              );
            if (claim[0]?.["[applied]"] !== true) continue;
            await this.db.execute(
              "UPDATE pending_event_by_id SET state='PUBLISHING',lease_fence=? WHERE event_id=?",
              [types.Long.fromNumber(fence), r.event_id],
              "LOCAL_QUORUM",
            );
            try {
              this.publisher ??= await RabbitPublisher.connect(this.url);
              const event = eventEnvelopeSchema.parse(JSON.parse(String(r.payload_json)));
              await this.publisher.publish("ailss.ai.jobs", event.eventType, event);
              await this.db.execute(
                "UPDATE pending_event_by_id SET state='PUBLISHED',published_at=? WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?",
                [new Date(), r.event_id, types.Long.fromNumber(fence)],
                "LOCAL_QUORUM",
                "LOCAL_SERIAL",
              );
              await this.db.execute(
                "DELETE FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=?",
                [r.due_day, r.shard, r.next_attempt_at, r.event_id],
                "LOCAL_QUORUM",
              );
            } catch {
              await this.db.execute(
                "UPDATE pending_events_by_due_bucket SET state='READY',lease_owner=null,lease_until=null WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF lease_fence=?",
                [r.due_day, r.shard, r.next_attempt_at, r.event_id, types.Long.fromNumber(fence)],
                "LOCAL_QUORUM",
                "LOCAL_SERIAL",
              );
              await this.db.execute(
                "UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF lease_fence=?",
                [r.event_id, types.Long.fromNumber(fence)],
                "LOCAL_QUORUM",
                "LOCAL_SERIAL",
              );
              await this.publisher?.close();
              this.publisher = undefined;
            }
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
