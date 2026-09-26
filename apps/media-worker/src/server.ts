import { startService } from "../../../packages/runtime/src/index.js";
import { createMediaMetrics } from "../../../packages/observability/src/media.js";
import { mediaRuntime } from "../../learning-service/src/media/config.js";
import { CassandraMediaRepository } from "../../learning-service/src/media/repository.js";
import { MediaProcessor } from "./processor.js";
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
      const repository = new CassandraMediaRepository(context.cassandra),
        processor = new MediaProcessor(
          repository,
          settings.storage,
          settings.policy,
          createMediaMetrics(context.metrics.registry),
        );
      let stopped = false;
      let active: Promise<void> | undefined;
      const poll = async () => {
        let after: string | undefined;
        while (!stopped) {
          const days = await repository.days(config.PLATFORM_TENANT_ID, after);
          for (const day of days)
            for (let shard = 0; shard < 4; shard++)
              for (const job of await repository.jobs(config.PLATFORM_TENANT_ID, day, shard)) {
                context.logger.info({
                  operation: "media.job",
                  mediaAssetId: job.mediaAssetId,
                  jobId: `${day}:${String(shard)}:${job.mediaAssetId}`,
                  attempt: job.attempts,
                });
                await processor.handle(job);
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
