import { Counter, Histogram, type Registry } from "prom-client";
export const mediaEvents = [
  "upload_session_created",
  "upload_completed",
  "upload_failed",
  "media_validation_failed",
  "media_processing_queued",
  "media_processing_failed",
  "media_ready",
  "playback_authorized",
  "playback_denied",
] as const;
export type MediaEvent = (typeof mediaEvents)[number];
export function createMediaMetrics(registry: Registry) {
  const counters = Object.fromEntries(
    mediaEvents.map((event) => [
      event,
      new Counter({ name: `ailss_${event}_total`, help: `Media ${event}`, registers: [registry] }),
    ]),
  ) as Record<MediaEvent, Counter>;
  const processingDuration = new Histogram({
    name: "ailss_media_processing_duration_seconds",
    help: "Media worker processing latency",
    registers: [registry],
  });
  return { event: (event: MediaEvent) => counters[event].inc(), processingDuration };
}
