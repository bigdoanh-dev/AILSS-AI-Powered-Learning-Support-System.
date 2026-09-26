import { startService } from "../../../packages/runtime/src/index.js";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMediaMetrics } from "../../../packages/observability/src/media.js";
import { mediaRuntime } from "../../learning-service/src/media/config.js";
import { CassandraMediaRepository } from "../../learning-service/src/media/repository.js";
import { MediaProcessor } from "./processor.js";
import { CassandraQuotaStore, MediaQuota } from "../../learning-service/src/media/quota.js";
import { cleanupExpiredUploads } from "./cleanup.js";
import { CassandraOutputJournal, recoverOutputIntent } from "./output-journal.js";
// A SIGKILL cannot execute MediaProcessor.finally. This container runs one
// worker process, so startup can safely clear only its own exact temp prefix.
for (const entry of await readdir(tmpdir(), { withFileTypes: true }))
  if (entry.isDirectory() && /^ailss-media-[A-Za-z0-9]{6}$/.test(entry.name))
    await rm(path.join(tmpdir(), entry.name), { recursive: true, force: true });
await startService(
  {
    serviceId: "media-worker",
    ownerDomain: "Media processing",
    defaultPort: 8210,
    keyspace: "learning_keyspace",
    cassandraRole: "svc_media_worker",
    publicApiIds: [],
    internalApiIds: [],
    producedEvents: [],
    consumedQueues: ["cassandra.media_job_by_day_shard"],
  },
  {
    configure: (_app, config, context) => {
      const settings = mediaRuntime(config, false);
      if (!settings || !context.cassandra) throw Error("MEDIA_WORKER_CONFIGURATION_REQUIRED");
      const metrics = createMediaMetrics(context.metrics.registry);
      const quota = new MediaQuota(new CassandraQuotaStore(context.cassandra), settings.quotaLimits);
      const repository = new CassandraMediaRepository(context.cassandra),
        outputJournal = new CassandraOutputJournal(context.cassandra),
        processor = new MediaProcessor(
          repository,
          settings.storage,
          settings.policy,
          metrics,
          quota,
          outputJournal,
        );
      const cleanupCursors = new Map<string, string>();
      let stopped = false;
      let active: Promise<void> | undefined;
      const poll = async () => {
        await cleanupExpiredUploads(
          config.PLATFORM_TENANT_ID,
          repository,
          settings.storage,
          quota,
          metrics.event,
        );
        let after: string | undefined;
        while (!stopped) {
          const days = await repository.days(config.PLATFORM_TENANT_ID, after);
          for (const day of days)
            for (let shard = 0; shard < 4; shard++) {
              const cursorKey = `${day}:${String(shard)}`;
              const page = await outputJournal.page(
                config.PLATFORM_TENANT_ID,
                day,
                shard,
                cleanupCursors.get(cursorKey),
              );
              for (const intent of page.intents)
                await recoverOutputIntent(intent, outputJournal, repository, settings.storage, metrics.event);
              if (page.cursor) cleanupCursors.set(cursorKey, page.cursor);
              else cleanupCursors.delete(cursorKey);
              for (const job of await repository.jobs(config.PLATFORM_TENANT_ID, day, shard)) {
                context.logger.info({
                  operation: "media.job",
                  mediaAssetId: job.mediaAssetId,
                  jobId: `${day}:${String(shard)}:${job.mediaAssetId}`,
                  attempt: job.attempts,
                });
                await processor.handle(job);
              }
            }
          if (days.length < 32) break;
          after = days.at(-1);
        }
      };
      const tick = () => {
        if (!active && !stopped)
          active = poll()
            .catch((error: unknown) =>
              context.logger.error({
                operation: "media.poll",
                error: error instanceof Error ? error.name : "unknown",
              }),
            )
            .finally(() => {
              active = undefined;
            });
      };
      const timer = setInterval(tick, 2000);
      timer.unref();
      tick();
      return async () => {
        stopped = true;
        clearInterval(timer);
        await active;
      };
    },
  },
);
