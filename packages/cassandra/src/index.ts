import { readFile } from "node:fs/promises";
import cassandra from "cassandra-driver";

export type ConsistencyName = "LOCAL_ONE" | "LOCAL_QUORUM" | "LOCAL_SERIAL";

const levels: Record<ConsistencyName, number> = {
  LOCAL_ONE: cassandra.types.consistencies.localOne,
  LOCAL_QUORUM: cassandra.types.consistencies.localQuorum,
  LOCAL_SERIAL: cassandra.types.consistencies.localSerial,
};

export interface CassandraOptions {
  readonly contactPoints: readonly string[];
  readonly localDataCenter: string;
  readonly keyspace?: string;
  readonly username: string;
  readonly password: string;
  readonly requestTimeoutMs?: number;
  readonly startupRetry?: {
    readonly attempts?: number;
    readonly initialDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly onRetry?: (details: {
      readonly attempt: number;
      readonly attempts: number;
      readonly delayMs: number;
      readonly error: unknown;
    }) => void;
  };
  readonly tls?: { readonly caPath: string; readonly serverName: string };
}

export interface ConnectRetryOptions {
  readonly attempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly onRetry?: (details: {
    readonly attempt: number;
    readonly attempts: number;
    readonly delayMs: number;
    readonly error: unknown;
  }) => void;
  readonly delay?: (delayMs: number) => Promise<void>;
}

export async function connectWithRetry(
  connect: () => Promise<unknown>,
  options: ConnectRetryOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 18;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new RangeError("Cassandra connect attempts must be positive");
  if (!Number.isFinite(initialDelayMs) || initialDelayMs < 0)
    throw new RangeError("Cassandra retry delay must be non-negative");
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < initialDelayMs)
    throw new RangeError("Cassandra max retry delay must be at least the initial delay");

  for (let attempt = 1; ; attempt += 1) {
    try {
      await connect();
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      const delayMs = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.({ attempt, attempts, delayMs, error });
      await delay(delayMs);
    }
  }
}

export class CassandraClient {
  readonly #client: cassandra.Client;

  private constructor(client: cassandra.Client) {
    this.#client = client;
  }

  public static async create(options: CassandraOptions): Promise<CassandraClient> {
    const sslOptions = options.tls
      ? {
          ca: [await readFile(options.tls.caPath)],
          servername: options.tls.serverName,
          rejectUnauthorized: true,
        }
      : undefined;
    const client = new cassandra.Client({
      contactPoints: [...options.contactPoints],
      localDataCenter: options.localDataCenter,
      ...(options.keyspace ? { keyspace: options.keyspace } : {}),
      authProvider: new cassandra.auth.PlainTextAuthProvider(options.username, options.password),
      ...(sslOptions ? { sslOptions } : {}),
      socketOptions: { readTimeout: options.requestTimeoutMs ?? 2_000 },
      queryOptions: { prepare: true },
    });
    try {
      await connectWithRetry(() => client.connect(), options.startupRetry);
    } catch (error) {
      await client.shutdown().catch(() => undefined);
      throw error;
    }
    return new CassandraClient(client);
  }

  public async execute<T extends cassandra.types.Row = cassandra.types.Row>(
    cql: string,
    params: readonly unknown[],
    consistency: ConsistencyName,
    serialConsistency?: "LOCAL_SERIAL",
  ): Promise<readonly T[]> {
    const result = await this.#client.execute(cql, [...params], {
      prepare: true,
      consistency: levels[consistency],
      ...(serialConsistency ? { serialConsistency: levels[serialConsistency] } : {}),
    });
    return result.rows as unknown as readonly T[];
  }

  public async executePage(
    cql: string,
    params: readonly unknown[],
    consistency: ConsistencyName,
    fetchSize: number,
    pageState?: string,
  ): Promise<{ readonly rows: readonly cassandra.types.Row[]; readonly pageState?: string }> {
    const result = await this.#client.execute(cql, [...params], {
      prepare: true,
      consistency: levels[consistency],
      fetchSize,
      ...(pageState ? { pageState } : {}),
    });
    return {
      rows: result.rows,
      ...(result.pageState ? { pageState: result.pageState } : {}),
    };
  }

  public async ready(): Promise<boolean> {
    try {
      await this.#client.execute("SELECT release_version, data_center FROM system.local", [], {
        prepare: true,
        consistency: cassandra.types.consistencies.localOne,
      });
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.#client.shutdown();
  }
}
