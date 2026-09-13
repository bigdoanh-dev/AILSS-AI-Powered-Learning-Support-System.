// Run inside Learning's dev container with its existing scoped credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CassandraClient } from "/app/dist/packages/cassandra/src/index.js";
import {
  SepayRecoveryRepository,
  recoveryShard,
} from "/app/dist/apps/learning-service/src/commerce/recovery-repository.js";
const db = await CassandraClient.create({
  contactPoints: process.env.CASSANDRA_CONTACT_POINTS.split(","),
  localDataCenter: process.env.CASSANDRA_LOCAL_DC,
  keyspace: "learning_keyspace",
  username: process.env.CASSANDRA_USERNAME,
  password: process.env.CASSANDRA_PASSWORD,
  requestTimeoutMs: 10000,
});
const repo = new SepayRecoveryRepository(db);
const ids = [];
const prefix = `projection-test-${randomUUID()}`;
const now = new Date();
const old = new Date(now.getTime() - 5 * 86400000);
try {
  // Exercise the real repository only; no canonical Order/payment table mutations.
  let sequence = 0;
  for (let i = 0; i < 65; i++) {
    // Force 35 keys into one partition to exercise real keyset continuation;
    // remaining keys cover the other shards.
    const targetShard = i < 35 ? 0 : 1 + (i % 15);
    let transactionId;
    do {
      transactionId = `${prefix}-${String(sequence++).padStart(5, "0")}`;
    } while (recoveryShard(transactionId) !== targetShard);
    const input = {
      transactionId,
      orderId: randomUUID(),
      fingerprint: "test-fingerprint",
      recoveryMac: "test-recovery-mac",
      receivedAt: old,
      paidEventId: randomUUID(),
      correlationId: randomUUID(),
      amount: 1000,
    };
    const row = await repo.ensure(input);
    ids.push(row.transactionId);
    const replay = await repo.ensure({ ...input, receivedAt: now, correlationId: randomUUID() });
    assert.equal(replay.receivedAt.toISOString(), old.toISOString());
    assert.equal(replay.correlationId, input.correlationId);
    if (i === 0)
      await assert.rejects(repo.ensure({ ...input, fingerprint: "changed" }), {
        code: "PAYMENT_REPLAY_CONFLICT",
        status: 409,
      });
    // Immediately fence as manual review: these are projection fixtures, not valid payments.
    const current = await repo.get(row.transactionId);
    if (current && (await repo.claim(current, "projection-test", new Date())))
      await repo.finish(current, "projection-test", new Date(), "MANUAL_REVIEW");
  }
  const discovered = new Set();
  let pages = 0;
  for (let shard = 0; shard < 16; shard++) {
    let after;
    do {
      const rows = await repo.page(shard, after);
      pages++;
      for (const r of rows) if (ids.includes(r.transactionId)) discovered.add(r.transactionId);
      after = rows.length === 25 ? rows.at(-1).transactionId : undefined;
    } while (after);
  }
  assert.equal(discovered.size, 65);
  assert.ok(pages > 16, "must traverse more than one page in a shard");
  const probe = await repo.ensure({
    transactionId: prefix + "-lease",
    orderId: randomUUID(),
    fingerprint: "lease",
    recoveryMac: "lease-mac",
    receivedAt: new Date(Date.now() + 60000),
    paidEventId: randomUUID(),
    correlationId: randomUUID(),
    amount: 1000,
  });
  ids.push(probe.transactionId);
  const future = new Date(Date.now() + 60000);
  const current = await repo.get(probe.transactionId);
  assert.notEqual(current.state, "MANUAL_REVIEW");
  {
    assert.equal(await repo.claim(current, "owner-a", future), true);
    assert.equal(await repo.claim(current, "stale-owner", future), false);
    const leased = await repo.get(probe.transactionId);
    assert.equal(await repo.claim(leased, "owner-b", new Date(future.getTime() + 16000)), true);
    await repo.finish(current, "owner-a", future, "COMPLETE");
    assert.ok(await repo.get(probe.transactionId));
    await repo.finish(leased, "owner-b", future, "RETRY");
    const retry = await repo.get(probe.transactionId);
    assert.equal(retry.state, "READY");
    assert.equal(retry.retryCount, 1);
    assert.equal(await repo.claim(retry, "owner-c", future), false);
    assert.equal(await repo.claim(retry, "owner-c", new Date(future.getTime() + 2000)), true);
    await repo.finish(retry, "owner-c", future, "MANUAL_REVIEW");
    const manual = await repo.get(probe.transactionId);
    assert.equal(manual.state, "MANUAL_REVIEW");
    assert.equal(await repo.claim(manual, "owner-d", new Date(future.getTime() + 60000)), false);
    // A stale owner cannot delete the durable manual-review disposition.
    await repo.finish(retry, "owner-c", future, "COMPLETE");
    assert.ok(await repo.get(probe.transactionId));
    // Clean up a separately claimed candidate to prove fenced terminal removal.
    const cleanupInput = { ...probe, transactionId: prefix + "-cleanup", receivedAt: future };
    const cleanup = await repo.ensure(cleanupInput);
    ids.push(cleanup.transactionId);
    assert.equal(await repo.claim(cleanup, "owner-cleanup", future), true);
    await repo.finish(cleanup, "owner-cleanup", future, "COMPLETE");
    assert.equal(await repo.get(cleanup.transactionId), undefined);
  }
  console.log(
    JSON.stringify({
      gate: "real-cassandra-sepay-projection",
      status: "PASS",
      candidates: 65,
      pages,
      olderThanTwoDays: true,
      canonicalPaymentsMutated: false,
    }),
  );
} finally {
  // Exact fixture keys only; approved projection test cleanup, no canonical mutation.
  for (const id of ids)
    await db.execute(
      "DELETE FROM sepay_recovery_by_shard WHERE shard=? AND transaction_id=?",
      [recoveryShard(id), id],
      "LOCAL_QUORUM",
    );
  await db.close();
}
