import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { AppError } from "../../../../packages/http/src/index.js";
import type { LearningAuthoringRepository } from "../authoring/repository.js";
import type { LearningOutboxRelay } from "../authoring/relay.js";
import type { LearningCommerceService } from "./service.js";
import type { SepayRecoveryRepository } from "./recovery-repository.js";

export class SepayRecoveryRunner {
  private readonly owner = randomUUID();
  private readonly cursors = new Map<number, string>();
  private shard = 0;
  private running = false;
  constructor(
    private readonly repo: SepayRecoveryRepository,
    private readonly commerce: LearningCommerceService,
    private readonly events: LearningAuthoringRepository,
    private readonly relay: LearningOutboxRelay,
    private readonly logger: Logger,
  ) {}
  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      // Two pages/tick, rotating all shards. Cursor advances even over poison/leased work.
      for (let page = 0; page < 2; page++) {
        const shard = this.shard;
        this.shard = (this.shard + 1) % 16;
        const rows = await this.repo.page(shard, this.cursors.get(shard));
        if (rows.length === 25 && rows[24]) this.cursors.set(shard, rows[24].transactionId);
        else this.cursors.delete(shard);
        for (const row of rows) {
          if (!(await this.repo.claim(row, this.owner, now))) continue;
          let disposition: "COMPLETE" | "RETRY" | "MANUAL_REVIEW" = "RETRY";
          try {
            const order = await this.commerce.resumeSepay(row);
            const published = await this.events.paymentPublished(row.paidEventId);
            if (!published) {
              const item = await this.events.paymentEventAt(row.paidEventId, order.paidAt ?? row.receivedAt);
              if (item) await this.relay.poll([item]);
            }
            // Existing canonical fulfillment algorithm, also used by reconciliation runner.
            await this.commerce.fulfill(row.orderId, row.paidEventId);
            const converged = await this.commerce.resumeSepay(row);
            if (converged.state === "ENTITLED" && (await this.events.paymentPublished(row.paidEventId)))
              disposition = "COMPLETE";
          } catch (error) {
            if (error instanceof AppError && error.status === 409) disposition = "MANUAL_REVIEW";
            this.logger.warn(
              {
                operation: "learning.sepay.recovery",
                transactionId: row.transactionId,
                orderId: row.orderId,
                disposition,
              },
              "Payment recovery remains durable",
            );
          }
          await this.repo.finish(row, this.owner, new Date(), disposition);
        }
      }
    } catch {
      this.logger.warn({ operation: "learning.sepay.recovery.poll" }, "Payment recovery poll will retry");
    } finally {
      this.running = false;
    }
  }
}
