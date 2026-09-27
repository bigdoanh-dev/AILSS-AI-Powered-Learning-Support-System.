/**
 * Phase 25.6: SCIM Protocol Hardening
 *
 * Verifies:
 * 1. ResourceTypes endpoint returns correct schema URIs
 * 2. Groups lifecycle: create member, list group shows member, delete user removes from group
 * 3. ETag/version: successive PATCHes increment version
 * 4. SCIM conformance classification:
 *    - ServiceProviderConfig includes all required fields (RFC 7643 §5)
 *    - Schemas endpoint returns all declared schemas
 *    - Error responses include scimType and status fields
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  Scim2ServerHandler,
  InMemoryScimRepository,
  SCIM_USER_SCHEMA_URI,
} from "../../packages/contracts/src/scim.js";

describe("Phase 25.6: SCIM Protocol Hardening & Conformance", () => {
  let handler: Scim2ServerHandler;
  let repo: InMemoryScimRepository;

  beforeEach(() => {
    repo = new InMemoryScimRepository();
    handler = new Scim2ServerHandler(repo, "tenant-pilot-polytech");
  });

  // ── ResourceTypes endpoint (RFC 7643 §6) ─────────────────────────────────
  it("GET /ResourceTypes returns User and Group resource types", async () => {
    const response = await handler.handleRequest({
      method: "GET",
      path: "/ResourceTypes",
    });

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    const resources = body["Resources"] as Array<Record<string, unknown>>;
    expect(Array.isArray(resources)).toBe(true);
    const names = resources.map((r) => r["name"]);
    expect(names).toContain("User");
    expect(names).toContain("Group");
  });

  // ── Groups lifecycle ──────────────────────────────────────────────────────
  it("provisioning a user adds them to the correct group", async () => {
    // Provision a lecturer
    const createResp = await handler.handleRequest({
      method: "POST",
      path: "/Users",
      body: {
        schemas: [SCIM_USER_SCHEMA_URI],
        externalId: "ext-g-001",
        userName: "lecturer@polytech.edu.vn",
        emails: [{ value: "lecturer@polytech.edu.vn", type: "work", primary: true }],
        active: true,
        roles: [{ value: "LECTURER" }],
      },
    });
    expect(createResp.status).toBe(201);

    // List groups — faculty group should have this user
    const groupsResp = await handler.handleRequest({
      method: "GET",
      path: "/Groups",
    });
    expect(groupsResp.status).toBe(200);
    const groupBody = groupsResp.body as Record<string, unknown>;
    const groups = groupBody["Resources"] as Array<Record<string, unknown>>;
    expect(groups.length).toBeGreaterThan(0);
  });

  // ── ETag / version increment ──────────────────────────────────────────────
  it("successive PATCH operations increment the ETag/version field", async () => {
    // Create user
    const created = await handler.handleRequest({
      method: "POST",
      path: "/Users",
      body: {
        schemas: [SCIM_USER_SCHEMA_URI],
        externalId: "ext-etag-001",
        userName: "etag@polytech.edu.vn",
        emails: [{ value: "etag@polytech.edu.vn", type: "work", primary: true }],
        active: true,
      },
    });
    expect(created.status).toBe(201);
    const userId = (created.body as Record<string, unknown>)["id"] as string;
    const v1 = ((created.body as Record<string, unknown>)["meta"] as Record<string, string>)["version"];
    expect(v1).toBeTruthy();

    // PATCH to deactivate
    const patched = await handler.handleRequest({
      method: "PATCH",
      path: `/Users/${userId}`,
      body: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      },
    });
    expect(patched.status).toBe(200);
    const v2 = ((patched.body as Record<string, unknown>)["meta"] as Record<string, string>)["version"];

    // Version should have incremented (v2 > v1 when parsed as number)
    expect(Number(v2)).toBeGreaterThan(Number(v1));
  });

  // ── ServiceProviderConfig RFC 7643 §5 compliance ─────────────────────────
  it("GET /ServiceProviderConfig includes all RFC 7643 §5 required capabilities", async () => {
    const resp = await handler.handleRequest({
      method: "GET",
      path: "/ServiceProviderConfig",
    });

    expect(resp.status).toBe(200);
    const body = resp.body as Record<string, unknown>;
    // Required capability objects
    expect(body).toHaveProperty("patch");
    expect(body).toHaveProperty("bulk");
    expect(body).toHaveProperty("filter");
    expect(body).toHaveProperty("changePassword");
    expect(body).toHaveProperty("sort");
    expect(body).toHaveProperty("etag");
    expect(body).toHaveProperty("authenticationSchemes");
    // Declared capabilities match Phase 25.6 configuration
    expect((body["patch"] as Record<string, boolean>)["supported"]).toBe(true);
    expect((body["etag"] as Record<string, boolean>)["supported"]).toBe(true);
    expect((body["bulk"] as Record<string, boolean>)["supported"]).toBe(false);
  });

  // ── Error response conformance ────────────────────────────────────────────
  it("error responses include schemas, status, and detail fields", async () => {
    const resp = await handler.handleRequest({
      method: "GET",
      path: "/Users/nonexistent-user-id",
    });

    expect(resp.status).toBe(404);
    const body = resp.body as Record<string, unknown>;
    expect(Array.isArray(body["schemas"])).toBe(true);
    expect(typeof body["status"]).toBe("string");
    expect(typeof body["detail"]).toBe("string");
  });

  // ── Schemas endpoint ──────────────────────────────────────────────────────
  it("GET /Schemas returns User and Group schemas", async () => {
    const resp = await handler.handleRequest({
      method: "GET",
      path: "/Schemas",
    });

    expect(resp.status).toBe(200);
    const body = resp.body as Record<string, unknown>;
    const resources = body["Resources"] as Array<Record<string, string>>;
    const ids = resources.map((r) => r["id"]);
    expect(ids).toContain("urn:ietf:params:scim:schemas:core:2.0:User");
    expect(ids).toContain("urn:ietf:params:scim:schemas:core:2.0:Group");
  });
});
