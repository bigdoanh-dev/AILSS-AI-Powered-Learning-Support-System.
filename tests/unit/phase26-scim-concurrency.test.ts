/**
 * Phase 26.8: SCIM 2.0 Optimistic Concurrency & ETag Precondition Control
 *
 * Verifies RFC 7644 §3.14 optimistic concurrency controls:
 * 1. Two administrators issue concurrent PATCH with the same initial ETag:
 *    - The first PATCH succeeds and bumps resource version (ETag: W/"1" -> W/"2")
 *    - The second PATCH presenting stale ETag receives HTTP 412 Precondition Failed
 *    - Prevents silent lost updates across concurrent provisioning systems
 * 2. Sequential updates with refreshed ETags succeed seamlessly
 * 3. PUT operations validate If-Match and return updated ETags
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  Scim2ServerHandler,
  InMemoryScimRepository,
  type ScimUser,
} from "../../packages/contracts/src/scim.js";

describe("Phase 26.8: SCIM 2.0 Optimistic Concurrency via If-Match", () => {
  let repo: InMemoryScimRepository;
  let handler: Scim2ServerHandler;

  beforeEach(() => {
    repo = new InMemoryScimRepository();
    handler = new Scim2ServerHandler(repo, "tenant-pilot-polytech");
  });

  async function createTestUser(userName: string): Promise<ScimUser> {
    const res = await handler.handleRequest({
      method: "POST",
      path: "/Users",
      body: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName,
        externalId: `ext-${userName}`,
        name: { givenName: "An", familyName: "Nguyen" },
        emails: [{ value: userName, primary: true }],
      },
    });
    return res.body as ScimUser;
  }

  it("GET /Users/:id returns ETag header matching resource version", async () => {
    const user = await createTestUser("etag.test@polytech.edu.vn");

    const getRes = await handler.handleRequest({
      method: "GET",
      path: `/Users/${user.id ?? ""}`,
    });

    expect(getRes.status).toBe(200);
    expect(getRes.headers?.["ETag"]).toBe(`W/"${user.meta?.version ?? "1"}"`);
  });

  it("optimistic concurrency: two administrators issue PATCH with same old ETag -> one succeeds, second gets 412", async () => {
    const user = await createTestUser("concurrency.student@polytech.edu.vn");
    const initialVersion = user.meta?.version ?? "1";
    const initialETag = `W/"${initialVersion}"`;

    // Admin 1 submits PATCH to deactivate user with initial ETag
    const admin1Res = await handler.handleRequest({
      method: "PATCH",
      path: `/Users/${user.id ?? ""}`,
      headers: { "If-Match": initialETag },
      body: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      },
    });

    expect(admin1Res.status).toBe(200);
    const updatedUser = admin1Res.body as ScimUser;
    expect(updatedUser.active).toBe(false);
    expect(admin1Res.headers?.["ETag"]).not.toBe(initialETag); // Version incremented

    // Admin 2 concurrently submits PATCH with the OLD initial ETag
    const admin2Res = await handler.handleRequest({
      method: "PATCH",
      path: `/Users/${user.id ?? ""}`,
      headers: { "If-Match": initialETag }, // Outdated ETag!
      body: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: true }],
      },
    });

    // Expect HTTP 412 Precondition Failed
    expect(admin2Res.status).toBe(412);
    const errorBody = admin2Res.body as { status: string; detail: string };
    expect(errorBody.status).toBe("412");
    expect(errorBody.detail).toContain("Precondition Failed");

    // Verify user remains active=false (Admin 1's update is NOT overwritten by stale Admin 2)
    const finalGet = await handler.handleRequest({
      method: "GET",
      path: `/Users/${user.id ?? ""}`,
    });
    const finalUser = finalGet.body as ScimUser;
    expect(finalUser.active).toBe(false);
  });

  it("PUT /Users/:id rejects outdated If-Match with 412 and accepts matching If-Match", async () => {
    const user = await createTestUser("put.concurrency@polytech.edu.vn");
    const currentETag = `W/"${user.meta?.version ?? "1"}"`;

    // PUT with stale ETag fails
    const stalePutRes = await handler.handleRequest({
      method: "PUT",
      path: `/Users/${user.id ?? ""}`,
      headers: { "If-Match": 'W/"999"' },
      body: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: user.userName,
        externalId: user.externalId,
        name: { givenName: "Updated", familyName: "Nguyen" },
        emails: user.emails,
      },
    });
    expect(stalePutRes.status).toBe(412);

    // PUT with correct ETag succeeds
    const validPutRes = await handler.handleRequest({
      method: "PUT",
      path: `/Users/${user.id ?? ""}`,
      headers: { "If-Match": currentETag },
      body: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: user.userName,
        externalId: user.externalId,
        name: { givenName: "Updated", familyName: "Nguyen" },
        emails: user.emails,
      },
    });
    expect(validPutRes.status).toBe(200);
    expect(validPutRes.headers?.["ETag"]).not.toBe(currentETag);
  });
});
