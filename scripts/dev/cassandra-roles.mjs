import { setTimeout as delay } from "node:timers/promises";

export async function synchronizeCassandraRoles(roles, execute, wait = delay) {
  // Cassandra 5 disallows changing a role password within 5000 ms of creation
  // or its last update. Keep creation and synchronization in separate batches.
  const passwordUpdates = roles.match(/^ALTER ROLE .+;$/gm) ?? [];
  execute(roles.replace(/^ALTER ROLE .+;$/gm, ""));
  if (passwordUpdates.length > 0) {
    await wait(5_100);
    execute(passwordUpdates.join("\n"));
  }
}
