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
  readonly tls?: { readonly caPath: string; readonly serverName: string };
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
    await client.connect();
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
