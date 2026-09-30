import { describe, expect, it } from "vitest";
import {
  InMemoryScimRepository,
  Scim2ServerHandler,
  SCIM_USER_SCHEMA_URI,
  SCIM_GROUP_SCHEMA_URI,
  SCIM_LIST_RESPONSE_URI,
} from "../../packages/contracts/src/scim.js";

describe("Phase 24.10: SCIM 2.0 Core Provisioning & Standard Endpoints", () => {
  it("GET /ServiceProviderConfig returns compliant RFC 7643 discovery metadata", async () => {
    const handler = new Scim2ServerHandler();
    const res = await handler.handleRequest({
      method: "GET",
      path: "/ServiceProviderConfig",
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body["schemas"]).toContain("urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig");
    expect(body["patch"]).toEqual({ supported: true });
    expect(body["bulk"]).toEqual({ supported: false, maxOperations: 0, maxPayloadSize: 0 });
    expect(body["filter"]).toEqual({ supported: true, maxResults: 100 });
  });

  it("GET /Schemas returns standard User and Group schema URIs", async () => {
    const handler = new Scim2ServerHandler();
    const res = await handler.handleRequest({
      method: "GET",
      path: "/Schemas",
    });

    expect(res.status).toBe(200);
    const body = res.body as { schemas: string[]; totalResults: number; Resources: Array<{ id: string }> };
    expect(body.schemas).toContain(SCIM_LIST_RESPONSE_URI);
    expect(body.totalResults).toBe(2);
    expect(body.Resources.some((r) => r.id === SCIM_USER_SCHEMA_URI)).toBe(true);
    expect(body.Resources.some((r) => r.id === SCIM_GROUP_SCHEMA_URI)).toBe(true);
  });

  it("POST /Users creates user and assigns institutional tenant role", async () => {
    const repo = new InMemoryScimRepository();
    const handler = new Scim2ServerHandler(repo, "tenant-pilot-polytech");

    const userPayload = {
      schemas: [SCIM_USER_SCHEMA_URI],
      externalId: "ext-polytech-1001",
      userName: "nguyen.van.a@polytech.edu.vn",
      name: {
        givenName: "A",
        familyName: "Nguyen Van",
        formatted: "Nguyen Van A",
      },
      emails: [{ value: "nguyen.van.a@polytech.edu.vn", primary: true }],
      roles: [{ value: "Student" }],
      active: true,
    };

    const res = await handler.handleRequest({
      method: "POST",
      path: "/Users",
      body: userPayload,
    });

    expect(res.status).toBe(201);
    const created = res.body as { id: string; userName: string; meta?: { location: string } };
    expect(created.id).toBeDefined();
    expect(created.userName).toBe("nguyen.van.a@polytech.edu.vn");
    expect(created.meta?.location).toContain(created.id);
  });

  it("POST /Users strictly rejects privilege escalation to PLATFORM_ADMIN (403 Forbidden)", async () => {
    const handler = new Scim2ServerHandler();

    const maliciousPayload = {
      schemas: [SCIM_USER_SCHEMA_URI],
      externalId: "ext-attacker-root",
      userName: "attacker@polytech.edu.vn",
      emails: [{ value: "attacker@polytech.edu.vn", primary: true }],
      roles: [{ value: "PLATFORM_ADMIN" }],
      active: true,
    };

    const res = await handler.handleRequest({
      method: "POST",
      path: "/Users",
      body: maliciousPayload,
    });

    expect(res.status).toBe(403);
    const err = res.body as { schemas: string[]; status: string; detail: string };
    expect(err.schemas).toContain("urn:ietf:params:scim:api:messages:2.0:Error");
    expect(err.detail).toContain("PLATFORM_ADMIN");
  });

  it("GET /Users, GET /Users/:id, PATCH, and DELETE lifecycle executes correctly", async () => {
    const repo = new InMemoryScimRepository();
    const handler = new Scim2ServerHandler(repo, "tenant-pilot-polytech");

    // 1. Create user
    const createRes = await handler.handleRequest({
      method: "POST",
      path: "/Users",
      body: {
        schemas: [SCIM_USER_SCHEMA_URI],
        externalId: "ext-polytech-2002",
        userName: "le.thi.b@polytech.edu.vn",
        emails: [{ value: "le.thi.b@polytech.edu.vn", primary: true }],
        roles: [{ value: "Instructor" }],
        active: true,
      },
    });
    expect(createRes.status).toBe(201);
    const userId = (createRes.body as { id: string }).id;

    // 2. GET /Users (list with filter)
    const listRes = await handler.handleRequest({
      method: "GET",
      path: "/Users",
      query: { filter: 'userName eq "le.thi.b@polytech.edu.vn"' },
    });
    expect(listRes.status).toBe(200);
    const listBody = listRes.body as { totalResults: number; Resources: Array<{ id: string }> };
    expect(listBody.totalResults).toBe(1);
    expect(listBody.Resources[0]?.id).toBe(userId);

    // 3. GET /Users/:id
    const getRes = await handler.handleRequest({
      method: "GET",
      path: `/Users/${userId}`,
    });
    expect(getRes.status).toBe(200);
    expect((getRes.body as { id: string }).id).toBe(userId);

    // 4. PATCH /Users/:id - update active status and verify anti-escalation
    const patchEscalationRes = await handler.handleRequest({
      method: "PATCH",
      path: `/Users/${userId}`,
      body: {
        Operations: [{ op: "replace", path: "roles", value: [{ value: "PLATFORM_ADMIN" }] }],
      },
    });
    expect(patchEscalationRes.status).toBe(403);

    // Successful patch: deactivate user
    const patchOkRes = await handler.handleRequest({
      method: "PATCH",
      path: `/Users/${userId}`,
      body: {
        Operations: [{ op: "replace", path: "active", value: false }],
      },
    });
    expect(patchOkRes.status).toBe(200);
    expect((patchOkRes.body as { active: boolean }).active).toBe(false);

    // 5. DELETE /Users/:id
    const delRes = await handler.handleRequest({
      method: "DELETE",
      path: `/Users/${userId}`,
    });
    expect(delRes.status).toBe(204);

    // Verify user is gone
    const getAfterDel = await handler.handleRequest({
      method: "GET",
      path: `/Users/${userId}`,
    });
    expect(getAfterDel.status).toBe(404);
  });
});
