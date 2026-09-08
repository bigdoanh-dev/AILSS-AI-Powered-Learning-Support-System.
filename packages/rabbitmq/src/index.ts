import { randomUUID } from "node:crypto";
import * as amqp from "amqplib";
import type { ConfirmChannel, ConsumeMessage, Options } from "amqplib";
import { decodeEvent, encodeEvent, type EventEnvelope } from "../../contracts/src/index.js";

export interface PublisherOptions {
  readonly confirmTimeoutMs?: number;
}

export class RabbitPublisher {
  readonly #returned = new Map<string, Error>();
  private constructor(
    private readonly connection: amqp.ChannelModel,
    private readonly channel: ConfirmChannel,
    private readonly timeoutMs: number,
  ) {
    connection.on("error", () => undefined);
    channel.on("error", () => undefined);
    channel.on("return", (message) => {
      const id: unknown = message.properties.messageId;
      if (typeof id === "string")
        this.#returned.set(id, new Error(`UNROUTABLE:${message.fields.routingKey}`));
    });
  }

  public static async connect(url: string, options: PublisherOptions = {}): Promise<RabbitPublisher> {
    const connection = await amqp.connect(url);
    const channel = await connection.createConfirmChannel();
    return new RabbitPublisher(connection, channel, options.confirmTimeoutMs ?? 5_000);
  }

  public async publish(exchange: string, routingKey: string, event: EventEnvelope): Promise<void> {
    const content = encodeEvent(event, event.eventType === "ai.quiz.generate.v1" ? 64 * 1024 : 128 * 1024);
    const properties: Options.Publish = {
      persistent: true,
      mandatory: true,
      contentType: "application/json",
      messageId: event.eventId,
      correlationId: event.correlationId,
      type: event.eventType,
      timestamp: Date.now(),
      headers: { specVersion: event.specVersion },
    };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("PUBLISH_CONFIRM_TIMEOUT")), this.timeoutMs);
      this.channel.publish(exchange, routingKey, content, properties, (error) => {
        clearTimeout(timer);
        if (error) reject(error instanceof Error ? error : new Error(String(error)));
        else {
          const returned = this.#returned.get(event.eventId);
          this.#returned.delete(event.eventId);
          if (returned) reject(returned);
          else resolve();
        }
      });
    });
  }

  public async close(): Promise<void> {
    await settleWithin(this.channel.close(), this.timeoutMs);
    await settleWithin(this.connection.close(), this.timeoutMs);
  }
}

async function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  await Promise.race([
    settled,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref();
    }),
  ]);
  if (timer) clearTimeout(timer);
}

export interface ConsumerDisposition {
  readonly kind: "ack" | "retry" | "dead-letter";
  readonly reason?: string;
}
export type EventHandler = (event: EventEnvelope) => Promise<ConsumerDisposition>;
export interface ConsumerRetryPolicy {
  readonly exchange: string;
  readonly routingKey: string;
  readonly attempts: number;
  readonly deadLetterExchange?: string;
  readonly deadLetterRoutingKey?: string;
}

export class RabbitConsumer {
  private closeHandler: (() => void) | undefined;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnecting: Promise<void> | undefined;
  private connection: amqp.ChannelModel;
  private channel: amqp.Channel;
  readonly #subscriptions = new Map<
    string,
    { queue: string; prefetch: number; handler: EventHandler; retryPolicy?: ConsumerRetryPolicy }
  >();
  private constructor(
    private readonly url: string,
    connection: amqp.ChannelModel,
    channel: amqp.Channel,
  ) {
    this.connection = connection;
    this.channel = channel;
    this.attach(connection, channel);
  }

  public static async connect(url: string): Promise<RabbitConsumer> {
    const connection = await amqp.connect(url);
    return new RabbitConsumer(url, connection, await connection.createChannel());
  }

  public async consume(
    queue: string,
    prefetch: number,
    handler: EventHandler,
    retryPolicy?: ConsumerRetryPolicy,
  ): Promise<string> {
    const subscriptionId = `ailss-${queue}-${randomUUID()}`;
    this.#subscriptions.set(subscriptionId, {
      queue,
      prefetch,
      handler,
      ...(retryPolicy ? { retryPolicy } : {}),
    });
    await this.startSubscription(subscriptionId);
    return subscriptionId;
  }

  private async startSubscription(subscriptionId: string): Promise<void> {
    const subscription = this.#subscriptions.get(subscriptionId);
    if (!subscription) return;
    const channel = this.channel;
    await channel.prefetch(subscription.prefetch);
    await channel.consume(
      subscription.queue,
      (message: ConsumeMessage | null) => {
        if (!message) return;
        let event: EventEnvelope;
        try {
          event = decodeEvent(message.content);
        } catch {
          channel.reject(message, false);
          return;
        }
        void subscription
          .handler(event)
          .then((disposition) => {
            if (disposition.kind === "ack") channel.ack(message);
            else if (disposition.kind === "retry" && subscription.retryPolicy) {
              const prior = Number(message.properties.headers?.["x-ailss-retry-count"] ?? 0);
              if (prior < subscription.retryPolicy.attempts) {
                channel.publish(
                  subscription.retryPolicy.exchange,
                  `${subscription.retryPolicy.routingKey}.retry.${String(prior + 1)}`,
                  message.content,
                  {
                    ...message.properties,
                    persistent: true,
                    headers: { ...message.properties.headers, "x-ailss-retry-count": prior + 1 },
                  },
                );
                channel.ack(message);
              } else
                this.deadLetter(
                  message,
                  subscription.queue,
                  disposition.reason,
                  subscription.retryPolicy,
                  channel,
                );
            } else if (disposition.kind === "retry") channel.nack(message, false, true);
            else if (subscription.retryPolicy)
              this.deadLetter(
                message,
                subscription.queue,
                disposition.reason,
                subscription.retryPolicy,
                channel,
              );
            else channel.reject(message, false);
          })
          .catch(() => {
            channel.reject(message, false);
          });
      },
      { noAck: false, consumerTag: subscriptionId },
    );
  }

  private deadLetter(
    message: ConsumeMessage,
    queue: string,
    reason: string | undefined,
    policy: ConsumerRetryPolicy,
    channel: amqp.Channel,
  ): void {
    channel.publish(
      policy.deadLetterExchange ?? "ailss.dlx",
      policy.deadLetterRoutingKey ?? queue.replace(/\.q$/u, ".dlq"),
      message.content,
      {
        ...message.properties,
        persistent: true,
        headers: { ...message.properties.headers, "x-ailss-dead-letter-reason": reason ?? "REJECTED" },
      },
    );
    channel.ack(message);
  }

  public async cancel(consumerTag: string): Promise<void> {
    this.#subscriptions.delete(consumerTag);
    if (!this.closed) await this.channel.cancel(consumerTag).catch(() => undefined);
  }
  public onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  public async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await settleWithin(this.channel.close(), 2_000);
    await settleWithin(this.connection.close(), 2_000);
  }

  private attach(connection: amqp.ChannelModel, channel: amqp.Channel): void {
    connection.on("error", () => undefined);
    channel.on("error", () => undefined);
    connection.on("close", () => {
      if (connection !== this.connection || this.closed) return;
      this.closeHandler?.();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer || this.reconnecting) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      let reconnected = false;
      this.reconnecting = this.reconnect()
        .then(() => {
          reconnected = true;
        })
        .catch(() => undefined)
        .finally(() => {
          this.reconnecting = undefined;
          if (!reconnected) this.scheduleReconnect();
        });
    }, 2_000);
    this.reconnectTimer.unref();
  }

  private async reconnect(): Promise<void> {
    if (this.closed) return;
    const connection = await amqp.connect(this.url);
    const channel = await connection.createChannel();
    this.connection = connection;
    this.channel = channel;
    this.attach(connection, channel);
    for (const subscriptionId of this.#subscriptions.keys()) await this.startSubscription(subscriptionId);
  }
}

export interface DedupStore {
  claim(
    eventId: string,
    aggregateId: string,
    aggregateVersion: number,
  ): Promise<"CLAIMED" | "DUPLICATE" | "STALE" | "GAP">;
  complete(eventId: string): Promise<void>;
}

export function withDeduplication(store: DedupStore, handler: EventHandler): EventHandler {
  return async (event) => {
    const claim = await store.claim(event.eventId, event.aggregate.id, event.aggregate.version);
    if (claim === "DUPLICATE" || claim === "STALE") return { kind: "ack" };
    if (claim === "GAP") return { kind: "dead-letter", reason: "AGGREGATE_VERSION_GAP" };
    const disposition = await handler(event);
    if (disposition.kind === "ack") await store.complete(event.eventId);
    return disposition;
  };
}

export class RabbitHealthClient {
  private readyState = true;
  private closed = false;
  private connection: amqp.ChannelModel;
  private reconnectTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly url: string,
    connection: amqp.ChannelModel,
  ) {
    this.connection = connection;
    this.attach(connection);
  }

  public static async connect(url: string): Promise<RabbitHealthClient> {
    const connection = await amqp.connect(url);
    return new RabbitHealthClient(url, connection);
  }

  public ready(): boolean {
    return this.readyState;
  }

  public async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    await settleWithin(this.connection.close(), 2_000);
  }

  private attach(connection: amqp.ChannelModel): void {
    connection.on("close", () => {
      this.readyState = false;
      this.scheduleReconnect();
    });
    connection.on("error", () => {
      this.readyState = false;
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnect();
    }, 2_000);
    this.reconnectTimer.unref();
  }

  private async reconnect(): Promise<void> {
    if (this.closed) return;
    await settleWithin(this.connection.close(), 2_000);
    try {
      this.connection = await amqp.connect(this.url);
      this.attach(this.connection);
      this.readyState = true;
    } catch {
      this.scheduleReconnect();
    }
  }
}
