import type { EventEnvelope } from "../../contracts/src/index.js";
import type { OutboxState } from "../../types/src/index.js";

const transitions: Readonly<Record<OutboxState, readonly OutboxState[]>> = {
  PREPARED: ["READY", "CANCELLED"],
  READY: ["PUBLISHING", "CANCELLED", "TERMINAL_FAILED"],
  PUBLISHING: ["PUBLISHED", "READY", "TERMINAL_FAILED"],
  PUBLISHED: [],
  TERMINAL_FAILED: [],
  CANCELLED: [],
};

export interface OutboxRecord {
  readonly event: EventEnvelope;
  readonly state: OutboxState;
  readonly attempt: number;
  readonly nextAttemptAt: Date;
  readonly leaseOwner?: string;
  readonly leaseUntil?: Date;
  readonly leaseFence: bigint;
}

export interface OutboxLease {
  readonly eventId: string;
  readonly event: EventEnvelope;
  readonly leaseOwner: string;
  readonly leaseUntil: Date;
  readonly leaseFence: bigint;
}

export interface OutboxStore {
  prepare(event: EventEnvelope, dueAt: Date): Promise<void>;
  markReady(eventId: string): Promise<void>;
  claimDue(workerId: string, now: Date, leaseMs: number, limit: number): Promise<readonly OutboxLease[]>;
  markPublished(lease: OutboxLease, publishedAt: Date): Promise<void>;
  releaseForRetry(lease: OutboxLease, nextAttemptAt: Date, safeReason: string): Promise<void>;
  markTerminal(lease: OutboxLease, safeReason: string): Promise<void>;
}

export interface ConfirmPublisher {
  publish(event: EventEnvelope): Promise<void>;
}

export function assertOutboxTransition(from: OutboxState, to: OutboxState): void {
  if (!transitions[from].includes(to)) throw new Error(`ILLEGAL_OUTBOX_TRANSITION:${from}->${to}`);
}

export function preparedRecoveryDecision(input: {
  canonicalExists: boolean;
  canonicalVersion?: number;
  intendedVersion: number;
  observationCount: number;
  maxObservations: number;
}): "PROMOTE_READY" | "RESCHEDULE" | "CANCEL" {
  if (
    input.canonicalExists &&
    input.canonicalVersion !== undefined &&
    input.canonicalVersion >= input.intendedVersion
  )
    return "PROMOTE_READY";
  if (input.observationCount < input.maxObservations) return "RESCHEDULE";
  return "CANCEL";
}

export class OutboxRelay {
  public constructor(
    private readonly store: OutboxStore,
    private readonly publisher: ConfirmPublisher,
  ) {}

  public async runBatch(
    workerId: string,
    now: Date,
    options: { leaseMs: number; limit: number; retryDelayMs: number; maxAttempts: number },
  ): Promise<{ published: number; retried: number; terminal: number }> {
    const leases = await this.store.claimDue(workerId, now, options.leaseMs, options.limit);
    let published = 0;
    let retried = 0;
    let terminal = 0;
    for (const lease of leases) {
      try {
        await this.publisher.publish(lease.event);
        await this.store.markPublished(lease, new Date());
        published += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.name : "PUBLISH_FAILED";
        const currentAttempt = Number(lease.leaseFence);
        if (currentAttempt >= options.maxAttempts) {
          await this.store.markTerminal(lease, reason);
          terminal += 1;
        } else {
          await this.store.releaseForRetry(lease, new Date(now.getTime() + options.retryDelayMs), reason);
          retried += 1;
        }
      }
    }
    return { published, retried, terminal };
  }
}
