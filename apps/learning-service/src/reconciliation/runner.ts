import { randomUUID } from "node:crypto";
import type { ReconciliationWork } from "./repository.js";

export interface ReconciliationStore {
  listDue(now: Date): Promise<readonly ReconciliationWork[]>;
  claim(item: ReconciliationWork, owner: string, now: Date): Promise<boolean>;
  complete(item: ReconciliationWork, version: number, now: Date): Promise<void>;
  retry(item: ReconciliationWork, errorCode: string, next: Date): Promise<void>;
  discardCompleted(item: ReconciliationWork): Promise<void>;
}

export class LearningReconciliationRunner {
  readonly #owner = `learning-reconcile-${randomUUID()}`;

  public constructor(
    private readonly store: ReconciliationStore,
    private readonly cleanup: (item: ReconciliationWork) => Promise<number>,
  ) {}

  public async runOnce(now = new Date()): Promise<void> {
    for (const item of await this.store.listDue(now)) {
      if (item.operationState === "COMPLETE") {
        await this.store.discardCompleted(item);
        continue;
      }
      if (!(await this.store.claim(item, this.#owner, now))) continue;
      try {
        const version = await this.cleanup(item);
        await this.store.complete(item, version, new Date());
      } catch {
        const delay = Math.min(1_000 * 2 ** Math.min(item.retryCount, 6), 60_000);
        await this.store.retry(item, "CLEANUP_FAILED", new Date(Date.now() + delay));
      }
    }
  }
}
