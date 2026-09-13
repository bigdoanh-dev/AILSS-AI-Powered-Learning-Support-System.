/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
type Validator = ((value: unknown) => boolean) & { errors?: unknown };
const JsonSchemaValidator = Ajv2020 as unknown as new (options: { allErrors: boolean; strict: boolean }) => {
  compile: (schema: unknown) => Validator;
};
const installFormats = addFormats as unknown as (validator: object) => void;

describe("P11 BLOCK-P11-001 same-ID contract remediation", () => {
  it("locks the exact notification event payload and rejects missing/unknown data", async () => {
    const schema = await json("contracts/events/system/system.notification.requested.v1.schema.json");
    const ajv = new JsonSchemaValidator({ allErrors: true, strict: true });
    installFormats(ajv);
    const validate = ajv.compile(schema);
    const event = {
      specVersion: "1.0",
      eventId: crypto.randomUUID(),
      eventType: "system.notification.requested.v1",
      occurredAt: new Date().toISOString(),
      producer: "classroom-service",
      correlationId: crypto.randomUUID(),
      aggregate: { type: "CLASS_ANNOUNCEMENT", id: crypto.randomUUID(), version: 1 },
      data: {
        recipientId: crypto.randomUUID(),
        notificationType: "CLASS_ANNOUNCEMENT",
        title: "Lịch học",
        body: "Thông báo lớp mới: Lịch học",
        source: { announcementId: crypto.randomUUID(), classId: crypto.randomUUID() },
      },
    };
    expect(validate(event)).toBe(true);
    expect(validate({ ...event, data: { ...event.data, recipientId: undefined } })).toBe(false);
    expect(validate({ ...event, data: { ...event.data, secret: "forbidden" } })).toBe(false);
  });

  it("locks NOT-01 month, limit, opaque cursor and exact DTO", async () => {
    const openApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8"));
    const operation = openApi.paths["/api/v1/notifications"].get;
    expect(operation["x-contract-status"]).toBe("IMPLEMENTED");
    expect(operation.parameters).toEqual([
      { $ref: "#/components/parameters/NotificationMonth" },
      { $ref: "#/components/parameters/NotificationLimit" },
      { $ref: "#/components/parameters/NotificationCursor" },
    ]);
    expect(openApi.components.parameters.NotificationMonth).toMatchObject({ required: true });
    expect(openApi.components.parameters.NotificationLimit.schema).toMatchObject({
      default: 20,
      minimum: 1,
      maximum: 50,
    });
    expect(openApi.components.parameters.NotificationCursor.description).toContain("15-minute TTL");
    expect(openApi.components.schemas.NotificationListResponse.required).toEqual(["items", "page"]);
  });

  it("locks NOT-02 locator ownership and excludes a public userId input", async () => {
    const openApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8"));
    const operation = openApi.paths["/api/v1/notifications/{notificationId}/read"].patch;
    expect(operation.parameters).toContainEqual({
      $ref: "#/components/parameters/NotificationLocator",
    });
    expect(openApi.components.parameters.NotificationLocator).toMatchObject({
      name: "X-Notification-Locator",
      in: "header",
      required: true,
    });
    expect(operation.requestBody).toBeUndefined();
    expect(JSON.stringify(operation)).not.toMatch(/userId/u);
    expect(openApi.components.schemas.NotificationReadResponse.required).toEqual([
      "notificationId",
      "state",
      "readAt",
    ]);
  });

  it("corrects Q-NOT-001 authority and locks Q-NOT-002 recovery identity", async () => {
    const registry = await json("contracts/query-registry.json");
    const q1 = registry.queries.find((entry: { queryId: string }) => entry.queryId === "Q-NOT-001");
    const q2 = registry.queries.find((entry: { queryId: string }) => entry.queryId === "Q-NOT-002");
    expect(q1).toMatchObject({
      operation: "R/W LWT",
      apiConsumers: ["NOT-01", "NOT-02", "notification-worker"],
    });
    expect(q2).toMatchObject({
      dedupIdentity: ["event_id", "user_id"],
      recoveryStates: ["RESERVED", "MATERIALIZED"],
    });
  });

  it("keeps inventories and support-process ownership unchanged", async () => {
    const api = await json("contracts/api-registry.json");
    const queries = await json("contracts/query-registry.json");
    const events = await json("contracts/event-registry.json");
    const manifest = await json("contracts/notification-manifest.json");
    expect([api.public.length, api.internal.length, queries.queries.length, events.events.length]).toEqual([
      101, 15, 78, 22,
    ]);
    expect(api.internal.filter((entry: { owner?: string }) => entry.owner === "Notification")).toEqual([]);
    expect(manifest).toMatchObject({
      contractStatus: "IMPLEMENTED",
      owner: { process: "notification-worker", shape: "SUPPORT_PROCESS", businessService: false },
      delivery: { scope: "IN_APP", brokerGuarantee: "AT_LEAST_ONCE" },
      retention: { policy: "NO_AUTOMATIC_EXPIRY", cassandraTtl: false },
      inventory: {
        publicApis: 98,
        internalApis: 15,
        queryIds: 74,
        eventTypes: 22,
        businessServices: 6,
        redis: false,
      },
    });
    expect(manifest.errata).toHaveLength(10);
  });
});
