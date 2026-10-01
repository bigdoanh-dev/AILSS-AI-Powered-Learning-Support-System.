import { CassandraClient } from "../../packages/cassandra/src/index.ts";
import { reconcileRevenueProjection } from "../../apps/learning-service/src/commerce/revenue-reconciliation.ts";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const fromText = process.env.FINANCE_BACKFILL_FROM;
if (fromText && !/^\d{4}-\d{2}-\d{2}$/.test(fromText)) throw new Error("Invalid FINANCE_BACKFILL_FROM");
const from = fromText ? new Date(`${fromText}T00:00:00Z`) : undefined;
if (from && !Number.isFinite(from.getTime())) throw new Error("Invalid FINANCE_BACKFILL_FROM");
const client = await CassandraClient.create({
  contactPoints: required("CASSANDRA_CONTACT_POINTS")
    .split(",")
    .map((value) => value.trim()),
  localDataCenter: required("CASSANDRA_LOCAL_DC"),
  keyspace: process.env.CASSANDRA_KEYSPACE || "learning_keyspace",
  username: required("CASSANDRA_USERNAME"),
  password: required("CASSANDRA_PASSWORD"),
});
try {
  const result = await reconcileRevenueProjection(client, { force: true, ...(from ? { from } : {}) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await client.close();
}
