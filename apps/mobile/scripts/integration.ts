// Explicit local-only dev smoke. No credentials or response bodies are printed or persisted.
import assert from "node:assert/strict";
import { Transport } from "../src/api";
import { Session } from "../src/session";
import { items } from "../src/domain";
async function main() {
  const origin = process.env.AILSS_MOBILE_TEST_ORIGIN;
  if (!origin || new URL(origin).hostname !== "127.0.0.1" || new URL(origin).protocol !== "http:")
    throw Error("Explicit loopback dev origin required");
  if (!process.env.AILSS_MOBILE_TEST_EMAIL || !process.env.AILSS_MOBILE_TEST_PASSWORD)
    throw Error("Dev account required");
  let saved: string | null = null;
  const api = new Transport(origin);
  const session = new Session(api, {
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
    clear: async () => {
      saved = null;
    },
  });
  try {
    const catalog = items(await api.request("/api/v1/courses/search?q=python"));
    await session.login(process.env.AILSS_MOBILE_TEST_EMAIL, process.env.AILSS_MOBILE_TEST_PASSWORD);
    assert.equal(session.snapshot.state, "AUTHENTICATED");
    const role = session.snapshot.user?.role;
    await session.restore();
    assert.equal(session.snapshot.state, "AUTHENTICATED");
    const notifications = items(
      await session.request(`/api/v1/notifications?month=${new Date().toISOString().slice(0, 7)}`),
    );
    await session.request("/api/v1/me/avatar");
    await session.revalidate();
    assert.equal(session.snapshot.state, "AUTHENTICATED");
    await session.logout();
    assert.equal(saved, null);
    console.log(
      JSON.stringify({
        status: "PASS",
        role,
        catalogCount: catalog.length,
        notifications: notifications.length,
        login: true,
        restore: true,
        me: true,
        avatar: true,
        logout: true,
        nativeSecureStore: "NOT_TESTED_NODE_HARNESS",
      }),
    );
  } finally {
    if (saved) await session.logout().catch(() => {});
  }
}
void main().catch((error) => {
  console.error("Integration failed:", error instanceof Error ? error.message : "Unknown");
  process.exitCode = 1;
});
