import { AppError } from "../../../../packages/http/src/index.js";
import { randomUUID } from "node:crypto";
import type { ApplicationService } from "./service.js";
import type { Command } from "./model.js";
// Fixed deployment epoch means restarts revisit all historical intent partitions.
// Each tick reads one day/shard and <=32 intents, never a table scan.
export function startApplicationRepair(service: ApplicationService) {
  const owner = randomUUID();
  let position = 0,
    busy = false,
    closed = false;
  let pageState: string | undefined;
  const epoch = Date.UTC(2026, 8, 7);
  const timer = setInterval(() => {
    if (busy || closed) return;
    busy = true;
    void (async () => {
      const days = Math.max(1, Math.floor((Date.now() - epoch) / 86400000) + 1),
        slot = position % (days * 16);
      const day = new Date(epoch + Math.floor(slot / 16) * 86400000).toISOString().slice(0, 10),
        shard = slot % 16;
      const page = await service.store.due(day, shard, pageState);
      for (const row of page.rows) {
        const c = JSON.parse(String(row.get("intent_json"))) as Command;
        const until = row.get("lease_until") as Date,
          fence = Number(row.get("fence"));
        if (until.getTime() > Date.now() || !(await service.store.lease(c, owner, fence, until))) continue;
        try {
          const actual = await service.store.reserve(c);
          await service.resume(actual);
        } catch (error) {
          // Dependency failures retain intent, including failed-claim cleanup.
          if (!(error instanceof AppError) || error.status !== 409) continue;
        }
        const actual = await service.store.command(c.scope, c.key);
        if (actual?.result || actual?.error) await service.store.removeIntent(c, owner, fence + 1);
      }
      pageState = page.pageState;
      if (!pageState) position++;
    })()
      .catch(() => {
        /* Dependency retry on subsequent bounded sweep. */
      })
      .finally(() => {
        busy = false;
      });
  }, 500);
  timer.unref();
  return () => {
    closed = true;
    clearInterval(timer);
  };
}
