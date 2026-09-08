import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  EVENT_TYPES,
  decodeEvent,
  encodeEvent,
  eventEnvelopeSchema,
} from "../../packages/contracts/src/index.js";
import {
  AI_JOB_STATES,
  ATTEMPT_STATES,
  COURSE_STATES,
  LESSON_AUTHORING_STATES,
  ORDER_STATES,
  OUTBOX_STATES,
} from "../../packages/types/src/index.js";

describe("Phase 5 binding contracts", () => {
  it("locks exact registry cardinalities", async () => {
    const api = JSON.parse(await readFile("contracts/api-registry.json", "utf8"));
    const query = JSON.parse(await readFile("contracts/query-registry.json", "utf8"));
    expect([api.public.length, api.internal.length, query.queries.length, EVENT_TYPES.length]).toEqual([
      98, 15, 74, 22,
    ]);
  });

  it("locks the P7.12C multi-mode contract delta without adding event types", async () => {
    const api = JSON.parse(await readFile("contracts/api-registry.json", "utf8")) as {
      public: Array<{ id: string; path: string; queryIds: string[]; event: string | null }>;
      internal: Array<{ id: string; caller: string; owner: string; path: string }>;
    };
    const query = JSON.parse(await readFile("contracts/query-registry.json", "utf8")) as {
      queries: Array<{ queryId: string; owner: string; tables: string[] }>;
    };
    const events = JSON.parse(await readFile("contracts/event-registry.json", "utf8")) as {
      events: Array<{ eventType: string }>;
    };

    expect(api.public.filter(({ id }) => /^LRN-(2[2-8])$/.test(id))).toHaveLength(7);
    expect(api.public.filter(({ id }) => /^CLS-(1[1-9]|20)$/.test(id))).toHaveLength(10);
    expect(api.internal.filter(({ id }) => /^INT-CLS-0[4-8]$/.test(id))).toEqual(
      expect.arrayContaining([expect.objectContaining({ caller: "Learning", owner: "Classroom" })]),
    );
    expect(query.queries.filter(({ queryId }) => /^Q-LRN-(01[7-9]|02[0-2])$/.test(queryId))).toHaveLength(6);
    expect(query.queries.filter(({ queryId }) => /^Q-CLS-0(09|1[0-7])$/.test(queryId))).toHaveLength(9);
    expect(events.events.map(({ eventType }) => eventType)).not.toContain("classroom.schedule.reserved.v1");
    expect(events.events).toHaveLength(22);
  });

  it("applies all state-machine errata", () => {
    expect(AI_JOB_STATES).toEqual([
      "QUEUED",
      "PROCESSING",
      "VALIDATING",
      "AI_DRAFT",
      "FAILED",
      "APPROVED",
      "CANCELLED",
    ]);
    expect(ORDER_STATES).toEqual(["PENDING", "PAYMENT_FAILED", "PAID_PENDING_ENTITLEMENT", "ENTITLED"]);
    expect(ATTEMPT_STATES).toEqual(["CREATED", "IN_PROGRESS", "SUBMITTED", "EXPIRED"]);
    expect(OUTBOX_STATES).toContain("PREPARED");
    expect(ATTEMPT_STATES).not.toContain("GRADED");
    expect(COURSE_STATES).toEqual(["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"]);
    expect(LESSON_AUTHORING_STATES).toEqual(["DRAFT", "INCOMPLETE", "READY"]);
  });

  it("rejects invalid and oversized events", () => {
    expect(() => eventEnvelopeSchema.parse({ eventType: "invented.v1" })).toThrow();
    expect(() => decodeEvent(Buffer.from("{}"))).toThrow();
    const huge = {
      specVersion: "1.0",
      eventId: crypto.randomUUID(),
      eventType: "ai.quiz.generate.v1",
      occurredAt: new Date().toISOString(),
      producer: "ai-service",
      correlationId: crypto.randomUUID(),
      aggregate: { type: "quiz", id: crypto.randomUUID(), version: 1 },
      data: { prompt: "x".repeat(70_000) },
    } as const;
    expect(() => encodeEvent(huge, 64 * 1024)).toThrow("EVENT_TOO_LARGE");
  });

  it("binds IDN-01 exactly once to its strict registration contract", async () => {
    const registry = JSON.parse(await readFile("contracts/api-registry.json", "utf8")) as {
      public: Array<Record<string, unknown>>;
    };
    const registrations = registry.public.filter((entry) => entry.id === "IDN-01");
    expect(registrations).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/auth/register",
        queryIds: ["Q-IDN-001", "Q-IDN-002", "Q-IDN-005", "Q-IDN-007"],
        event: "identity.user.registered.v1",
      }),
    ]);

    const openApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8")) as {
      paths: Record<
        string,
        {
          post: {
            operationId: string;
            security: unknown[];
            parameters: unknown[];
            responses: Record<string, unknown>;
          };
        }
      >;
      components: {
        schemas: {
          RegistrationRequest: {
            additionalProperties: boolean;
            required: string[];
          };
        };
      };
    };
    const operation = openApi.paths["/api/v1/auth/register"]?.post;
    if (!operation) throw new Error("IDN-01 OpenAPI operation is missing");
    expect(operation.operationId).toBe("IDN-01");
    expect(operation.security).toEqual([]);
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
    );
    expect(operation.responses["201"]).toBeDefined();
    expect(operation.responses["501"]).toBeUndefined();
    expect(openApi.components.schemas.RegistrationRequest).toMatchObject({
      additionalProperties: false,
      required: ["email", "password", "displayName"],
    });
  });

  it("binds only IDN-02 to the implemented strict login contract", async () => {
    const registry = JSON.parse(await readFile("contracts/api-registry.json", "utf8")) as {
      public: Array<Record<string, unknown>>;
    };
    expect(registry.public.filter((entry) => entry.id === "IDN-02")).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/auth/login",
        queryIds: ["Q-IDN-001", "Q-IDN-002", "Q-IDN-003"],
        event: null,
      }),
    ]);

    const openApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8")) as {
      paths: Record<
        string,
        {
          post: {
            operationId: string;
            security: unknown[];
            requestBody?: unknown;
            responses: Record<string, unknown>;
          };
        }
      >;
      components: {
        schemas: {
          LoginRequest: { additionalProperties: boolean; required: string[] };
          LoginResponse: { additionalProperties: boolean; required: string[] };
        };
      };
    };
    const login = openApi.paths["/api/v1/auth/login"]?.post;
    if (!login) throw new Error("Identity login OpenAPI operation is missing");
    expect(login).toMatchObject({ operationId: "IDN-02", security: [], requestBody: { required: true } });
    expect(login.responses["200"]).toBeDefined();
    expect(login.responses["401"]).toBeDefined();
    expect(login.responses["503"]).toBeDefined();
    expect(login.responses["501"]).toBeUndefined();
    expect(openApi.components.schemas.LoginRequest).toMatchObject({
      additionalProperties: false,
      required: ["email", "password"],
    });
    expect(openApi.components.schemas.LoginResponse).toMatchObject({
      additionalProperties: false,
      required: ["data", "meta"],
    });
  });

  it("binds IDN-03 refresh and only current-session IDN-04 logout", async () => {
    const registry = JSON.parse(await readFile("contracts/api-registry.json", "utf8")) as {
      public: Array<Record<string, unknown>>;
    };
    expect(registry.public.filter((entry) => entry.id === "IDN-03")).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/auth/refresh",
        auth: "Refresh token",
        queryIds: ["Q-IDN-001", "Q-IDN-003"],
        event: null,
      }),
    ]);
    expect(registry.public.filter((entry) => entry.id === "IDN-04")).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/auth/logout",
        auth: "Bearer",
        queryIds: ["Q-IDN-003", "Q-IDN-004"],
        event: null,
      }),
    ]);

    const openApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8")) as {
      paths: Record<
        string,
        {
          post: {
            operationId: string;
            security: unknown[];
            requestBody?: unknown;
            responses: Record<string, unknown>;
          };
        }
      >;
      components: {
        schemas: {
          RefreshRequest: { additionalProperties: boolean; required: string[] };
          RefreshResponse: { additionalProperties: boolean; required: string[] };
        };
      };
    };
    const refresh = openApi.paths["/api/v1/auth/refresh"]?.post;
    const logout = openApi.paths["/api/v1/auth/logout"]?.post;
    if (!refresh || !logout) throw new Error("Identity lifecycle OpenAPI operation is missing");
    expect(refresh).toMatchObject({ operationId: "IDN-03", security: [], requestBody: { required: true } });
    expect(refresh.responses["200"]).toBeDefined();
    expect(refresh.responses["401"]).toBeDefined();
    expect(refresh.responses["503"]).toBeDefined();
    expect(refresh.responses["501"]).toBeUndefined();
    expect(openApi.components.schemas.RefreshRequest).toMatchObject({
      additionalProperties: false,
      required: ["sessionId", "refreshToken"],
    });
    expect(openApi.components.schemas.RefreshResponse).toMatchObject({
      additionalProperties: false,
      required: ["data", "meta"],
    });
    expect(logout).toMatchObject({ operationId: "IDN-04", security: [{ bearerAuth: [] }] });
    expect(logout.requestBody).toBeUndefined();
    expect(logout.responses["200"]).toBeDefined();
    expect(logout.responses["401"]).toBeDefined();
    expect(logout.responses["503"]).toBeDefined();
    expect(logout.responses["501"]).toBeUndefined();
  });

  it("binds strict IDN-05..08 identity contracts and the P7.7 projection errata", async () => {
    const registry = JSON.parse(await readFile("contracts/api-registry.json", "utf8")) as {
      public: Array<Record<string, unknown>>;
    };
    expect(registry.public.filter((entry) => entry.id === "IDN-05")).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/me",
        auth: "Bearer",
        queryIds: ["Q-IDN-001"],
        event: null,
      }),
    ]);
    expect(registry.public.filter((entry) => entry.id === "IDN-06")).toEqual([
      expect.objectContaining({
        method: "PATCH",
        path: "/api/v1/me",
        auth: "Bearer",
        queryIds: ["Q-IDN-001", "Q-IDN-005", "Q-IDN-006", "Q-IDN-007"],
        event: null,
      }),
    ]);
    expect(registry.public.filter((entry) => entry.id === "IDN-07")).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/me/password",
        auth: "Bearer + recent-auth",
        queryIds: ["Q-IDN-001", "Q-IDN-002", "Q-IDN-003", "Q-IDN-004", "Q-IDN-007"],
        event: null,
      }),
    ]);

    const openApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8")) as {
      paths: Record<
        string,
        {
          get?: OperationContract;
          patch?: OperationContract;
          post?: OperationContract;
        }
      >;
      components: {
        schemas: Record<
          string,
          { additionalProperties?: boolean; required?: string[]; properties?: Record<string, unknown> }
        >;
      };
    };
    const read = openApi.paths["/api/v1/me"]?.get;
    const update = openApi.paths["/api/v1/me"]?.patch;
    const password = openApi.paths["/api/v1/me/password"]?.post;
    const publicLecturer = openApi.paths["/api/v1/lecturers/{lecturerId}"]?.get;
    if (!read || !update || !password || !publicLecturer) {
      throw new Error("Identity profile lifecycle contract is missing");
    }
    expect(read).toMatchObject({ operationId: "IDN-05", security: [{ bearerAuth: [] }] });
    expect(read.requestBody).toBeUndefined();
    expect(read.responses["200"]).toBeDefined();
    expect(read.responses["401"]).toBeDefined();
    expect(read.responses["501"]).toBeUndefined();

    expect(update).toMatchObject({
      operationId: "IDN-06",
      security: [{ bearerAuth: [] }],
      requestBody: { required: true },
    });
    expect(update.parameters).toEqual([
      expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
    ]);
    expect(update.parameters?.some((parameter) => parameter.name.toLowerCase() === "if-match")).toBe(false);
    expect(update.responses["200"]).toBeDefined();
    expect(update.responses["409"]).toBeDefined();
    expect(update.responses["422"]).toBeDefined();
    expect(update.responses["501"]).toBeUndefined();
    expect(openApi.components.schemas.ProfileUpdateRequest).toMatchObject({
      additionalProperties: false,
      required: ["displayName"],
    });
    expect(Object.keys(openApi.components.schemas.ProfileUpdateRequest?.properties ?? {})).toEqual([
      "displayName",
    ]);
    expect(openApi.components.schemas.Profile?.properties).not.toHaveProperty("tokenVersion");
    expect(password).toMatchObject({
      operationId: "IDN-07",
      security: [{ bearerAuth: [] }],
      requestBody: { required: true },
    });
    expect(password.parameters).toEqual([
      expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
    ]);
    expect(password.responses["200"]).toBeDefined();
    expect(password.responses["401"]).toBeDefined();
    expect(password.responses["409"]).toBeDefined();
    expect(password.responses["422"]).toBeDefined();
    expect(password.responses["501"]).toBeUndefined();
    expect(openApi.components.schemas.PasswordChangeRequest).toMatchObject({
      additionalProperties: false,
      required: ["currentPassword", "newPassword"],
    });
    expect(Object.keys(openApi.components.schemas.PasswordChangeRequest?.properties ?? {})).toEqual([
      "currentPassword",
      "newPassword",
    ]);
    expect(registry.public.filter((entry) => entry.id === "IDN-08")).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/lecturers/{lecturerId}",
        auth: "Optional Bearer",
        queryIds: ["Q-IDN-001", "Q-IDN-006"],
        event: null,
      }),
    ]);
    expect(publicLecturer).toMatchObject({
      operationId: "IDN-08",
      security: [{}, { bearerAuth: [] }],
    });
    expect(publicLecturer.parameters).toEqual([
      expect.objectContaining({ name: "lecturerId", in: "path", required: true }),
    ]);
    expect(publicLecturer.responses["200"]).toBeDefined();
    expect(publicLecturer.responses["401"]).toBeDefined();
    expect(publicLecturer.responses["404"]).toBeDefined();
    expect(publicLecturer.responses["503"]).toBeDefined();
    expect(publicLecturer.responses["501"]).toBeUndefined();
    expect(openApi.components.schemas.PublicLecturerProfileResponse).toMatchObject({
      additionalProperties: false,
      required: ["data", "meta"],
    });
  });

  it("binds INT-IDN-01 to Service JWS and a minimal public-safe DTO", async () => {
    const openApi = YAML.parse(await readFile("contracts/openapi/internal-v1.yaml", "utf8")) as {
      paths: Record<string, { get?: OperationContract }>;
      components: {
        securitySchemes: Record<string, unknown>;
        schemas: Record<string, { additionalProperties?: boolean; required?: string[] }>;
      };
    };
    const operation = openApi.paths["/internal/v1/users/{id}/public-profile"]?.get;
    if (!operation) throw new Error("INT-IDN-01 OpenAPI operation is missing");
    expect(operation).toMatchObject({ operationId: "INT-IDN-01", security: [{ serviceAuth: [] }] });
    expect(operation.parameters).toEqual([
      expect.objectContaining({ name: "id", in: "path", required: true }),
    ]);
    expect(operation.responses["200"]).toBeDefined();
    expect(operation.responses["401"]).toBeDefined();
    expect(operation.responses["403"]).toBeDefined();
    expect(operation.responses["404"]).toBeDefined();
    expect(operation.responses["503"]).toBeDefined();
    expect(operation.responses["501"]).toBeUndefined();
    expect(openApi.components.securitySchemes.serviceAuth).toBeDefined();
    expect(openApi.components.schemas.InternalPublicProfileResponse).toMatchObject({
      additionalProperties: false,
      required: ["data", "meta"],
    });
  });

  it("binds INT-IDN-02 to Gateway-only service + actor authorization and strict password reauth", async () => {
    const registry = JSON.parse(await readFile("contracts/api-registry.json", "utf8")) as {
      internal: Array<Record<string, unknown>>;
    };
    expect(registry.internal.filter((entry) => entry.id === "INT-IDN-02")).toEqual([
      expect.objectContaining({
        caller: "API Gateway",
        owner: "Identity",
        method: "POST",
        path: "/internal/v1/admin/step-up-authorizations",
        queryIds: ["Q-IDN-001", "Q-IDN-002", "Q-IDN-003"],
      }),
    ]);
    const openApi = YAML.parse(await readFile("contracts/openapi/internal-v1.yaml", "utf8")) as {
      paths: Record<string, { post?: OperationContract }>;
      components: {
        securitySchemes: Record<string, unknown>;
        schemas: Record<string, { additionalProperties?: boolean; required?: string[] }>;
      };
    };
    const operation = openApi.paths["/internal/v1/admin/step-up-authorizations"]?.post;
    if (!operation) throw new Error("INT-IDN-02 OpenAPI operation is missing");
    expect(operation).toMatchObject({
      operationId: "INT-IDN-02",
      security: [{ serviceAuth: [], actorContextAuth: [] }],
      requestBody: { required: true },
    });
    expect(operation.responses["200"]).toBeDefined();
    expect(operation.responses["401"]).toBeDefined();
    expect(operation.responses["403"]).toBeDefined();
    expect(operation.responses["503"]).toBeDefined();
    expect(openApi.components.securitySchemes.actorContextAuth).toBeDefined();
    expect(openApi.components.schemas.AdminStepUpAuthorizationRequest).toMatchObject({
      additionalProperties: false,
      required: ["currentPassword", "action", "resourceType", "resourceId"],
    });
  });

  it("adds published_at and Q-LRN-016 lease fields only through the migrator migration", async () => {
    for (const profile of ["dev", "research"]) {
      const migration = await readFile(
        `database/migrations/${profile}/021_learning_course_published_at.cql`,
        "utf8",
      );
      expect(migration).toContain("course_by_id ADD IF NOT EXISTS published_at timestamp");
      expect(migration).toContain("reconcile_operation_by_id ADD IF NOT EXISTS lease_fence bigint");
      expect(migration).toContain("reconcile_by_due_bucket ADD IF NOT EXISTS lease_until timestamp");
      expect(migration).not.toContain("ALLOW FILTERING");
    }
  });

  it("binds P7.13 lesson authoring without changing registry cardinalities", async () => {
    const api = JSON.parse(await readFile("contracts/api-registry.json", "utf8")) as {
      public: Array<{ id: string; queryIds: string[]; event: string | null }>;
    };
    const query = JSON.parse(await readFile("contracts/query-registry.json", "utf8")) as {
      queries: Array<{ queryId: string; tables: string[]; operation: string }>;
    };
    expect(api.public.find(({ id }) => id === "LRN-10")?.queryIds).toEqual(["Q-LRN-001", "Q-LRN-006"]);
    expect(api.public.find(({ id }) => id === "LRN-11")?.queryIds).toContain("Q-LRN-007");
    expect(api.public.find(({ id }) => id === "LRN-13")?.queryIds).toContain("Q-LRN-001");
    expect(api.public.filter(({ id }) => /^LRN-1[0-3]$/.test(id)).every(({ event }) => event === null)).toBe(
      true,
    );
    expect(query.queries.find(({ queryId }) => queryId === "Q-LRN-007")).toMatchObject({
      tables: ["lesson_current_by_id", "lesson_by_id_version"],
      operation: "R/W",
    });
    expect(query.queries.find(({ queryId }) => queryId === "Q-LRN-015")?.tables).toContain(
      "content_mutation_by_course",
    );
    const openApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8"));
    expect(openApi.paths["/api/v1/courses/{courseId}/submit-review"].post.responses["202"]).toBeDefined();
    expect(openApi.paths["/api/v1/courses/{courseId}/lessons"].post.responses["201"]).toBeDefined();
    expect(openApi.paths["/api/v1/lessons/{lessonId}"].patch.responses["501"]).toBeUndefined();
    for (const profile of ["dev", "research"]) {
      const migration = await readFile(
        `database/migrations/${profile}/022_learning_lesson_authoring.cql`,
        "utf8",
      );
      expect(migration).toContain("lesson_current_by_id");
      expect(migration).toContain("content_mutation_by_course");
      expect(migration).not.toContain("ALLOW FILTERING");
    }
  });

  it("binds strict P7.8 Admin search, detail, status step-up and projection producers", async () => {
    const registry = JSON.parse(await readFile("contracts/api-registry.json", "utf8")) as {
      public: Array<Record<string, unknown>>;
    };
    expect(registry.public.filter((entry) => entry.id === "IDN-09")).toEqual([
      expect.objectContaining({
        auth: "Bearer",
        roles: "admin",
        queryIds: ["Q-IDN-005"],
        event: null,
      }),
    ]);
    expect(registry.public.filter((entry) => entry.id === "IDN-10")).toEqual([
      expect.objectContaining({ queryIds: ["Q-IDN-001"], event: null }),
    ]);
    expect(registry.public.filter((entry) => entry.id === "IDN-11")).toEqual([
      expect.objectContaining({
        auth: "Bearer + step-up current-password",
        queryIds: ["Q-IDN-001", "Q-IDN-002", "Q-IDN-003", "Q-IDN-005", "Q-IDN-007"],
        event: "identity.user.status_changed.v1",
      }),
    ]);
    const openApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8")) as {
      paths: Record<string, { get?: OperationContract; patch?: OperationContract }>;
      components: { schemas: Record<string, { additionalProperties?: boolean; required?: string[] }> };
    };
    const search = openApi.paths["/api/v1/admin/users"]?.get;
    const detail = openApi.paths["/api/v1/admin/users/{userId}"]?.get;
    const status = openApi.paths["/api/v1/admin/users/{userId}/status"]?.patch;
    if (!search || !detail || !status) throw new Error("P7.8 Admin OpenAPI contracts are missing");
    expect(search.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "role", required: true }),
        expect.objectContaining({ name: "status", required: true }),
        expect.objectContaining({ name: "limit" }),
        expect.objectContaining({ name: "cursor" }),
      ]),
    );
    expect(search.responses["200"]).toBeDefined();
    expect(search.responses["501"]).toBeUndefined();
    expect(detail.parameters).toEqual([
      expect.objectContaining({ name: "userId", in: "path", required: true }),
    ]);
    expect(detail.responses["501"]).toBeUndefined();
    expect(status.requestBody).toMatchObject({ required: true });
    expect(status.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "userId", required: true }),
        expect.objectContaining({ name: "Idempotency-Key", required: true }),
      ]),
    );
    expect(status.responses["501"]).toBeUndefined();
    expect(openApi.components.schemas.AdminStatusChangeRequest).toMatchObject({
      additionalProperties: false,
      required: ["status", "currentPassword"],
    });
    expect(openApi.components.schemas.AdminUserDetail).toMatchObject({ additionalProperties: false });
  });

  it("binds P7.10 public Learning reads to exact projections and strict optional auth", async () => {
    const registry = JSON.parse(await readFile("contracts/api-registry.json", "utf8")) as {
      public: Array<Record<string, unknown>>;
    };
    expect(registry.public.filter((entry) => entry.id === "LRN-01")).toEqual([
      expect.objectContaining({ auth: "Optional Bearer", queryIds: ["Q-LRN-003", "Q-LRN-001"], event: null }),
    ]);
    expect(registry.public.filter((entry) => entry.id === "LRN-02")).toEqual([
      expect.objectContaining({ auth: "Optional Bearer", queryIds: ["Q-LRN-004", "Q-LRN-001"], event: null }),
    ]);
    expect(registry.public.filter((entry) => entry.id === "LRN-03")).toEqual([
      expect.objectContaining({ queryIds: ["Q-LRN-001"], event: null }),
    ]);
    expect(registry.public.filter((entry) => entry.id === "LRN-04")).toEqual([
      expect.objectContaining({ queryIds: ["Q-LRN-002", "Q-LRN-001"], event: null }),
    ]);

    const openApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8")) as {
      paths: Record<string, { get?: OperationContract }>;
      components: { schemas: Record<string, { additionalProperties?: boolean; required?: string[] }> };
    };
    const operations = [
      openApi.paths["/api/v1/courses"]?.get,
      openApi.paths["/api/v1/courses/search"]?.get,
      openApi.paths["/api/v1/courses/{courseId}"]?.get,
      openApi.paths["/api/v1/courses/by-slug/{slug}"]?.get,
    ];
    expect(operations.every(Boolean)).toBe(true);
    expect(operations.map((operation) => operation?.operationId)).toEqual([
      "LRN-01",
      "LRN-02",
      "LRN-03",
      "LRN-04",
    ]);
    for (const operation of operations) {
      expect(operation?.security).toEqual([{}, { bearerAuth: [] }]);
      expect(operation?.responses["200"]).toBeDefined();
      expect(operation?.responses["401"]).toBeDefined();
      expect(operation?.responses["501"]).toBeUndefined();
    }
    expect(operations[0]?.parameters).toContainEqual(
      expect.objectContaining({ name: "categoryId", in: "query", required: true }),
    );
    expect(operations[1]?.parameters).toContainEqual(
      expect.objectContaining({ name: "q", in: "query", required: true }),
    );
    for (const schema of ["CourseSummary", "CourseCatalogResponse", "CourseDetail", "CourseDetailResponse"]) {
      expect(openApi.components.schemas[schema]).toMatchObject({ additionalProperties: false });
    }
  });
});

interface OperationContract {
  readonly operationId: string;
  readonly security: unknown[];
  readonly requestBody?: { readonly required?: boolean };
  readonly parameters?: readonly {
    readonly name: string;
    readonly in: string;
    readonly required?: boolean;
  }[];
  readonly responses: Record<string, unknown>;
}
