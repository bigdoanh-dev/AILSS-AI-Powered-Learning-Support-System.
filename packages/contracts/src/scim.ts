import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../http/src/index.js";

export const SCIM_USER_SCHEMA_URI = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA_URI = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST_RESPONSE_URI = "urn:ietf:params:scim:api:messages:2.0:ListResponse";

export const scimEmailSchema = z.object({
  value: z.string().email(),
  type: z.enum(["work", "home", "other"]).default("work"),
  primary: z.boolean().default(true),
});

export const scimUserSchema = z.object({
  schemas: z.array(z.string()).min(1),
  id: z.string().optional(),
  externalId: z.string().min(1),
  userName: z.string().min(1),
  name: z
    .object({
      formatted: z.string().optional(),
      familyName: z.string().optional(),
      givenName: z.string().optional(),
    })
    .optional(),
  displayName: z.string().optional(),
  emails: z.array(scimEmailSchema).min(1),
  active: z.boolean().default(true),
  roles: z
    .array(
      z.object({
        value: z.string(),
        primary: z.boolean().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  meta: z
    .object({
      resourceType: z.literal("User").default("User"),
      created: z.string().optional(),
      lastModified: z.string().optional(),
      location: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
});

export type ScimUser = z.infer<typeof scimUserSchema>;

export interface ScimGroupMember {
  readonly value: string;
  readonly display?: string | undefined;
  readonly type?: "User" | "Group" | undefined;
}

export interface ScimGroup {
  readonly schemas: readonly string[];
  readonly id: string;
  readonly displayName: string;
  readonly members?: readonly ScimGroupMember[] | undefined;
}

export interface ScimListResponse<T> {
  readonly schemas: readonly [typeof SCIM_LIST_RESPONSE_URI];
  readonly totalResults: number;
  readonly startIndex: number;
  readonly itemsPerPage: number;
  readonly Resources: readonly T[];
}

export type InstitutionalRole = "STUDENT" | "LECTURER" | "INSTITUTION_ADMIN";

export interface ProvisionedAccount {
  readonly userId: string;
  readonly externalId: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: InstitutionalRole;
  readonly active: boolean;
  readonly institutionId: string;
  readonly provisionedAt: Date;
  readonly lastSyncedAt: Date;
}

/**
 * Validates inbound SCIM 2.0 User payload and maps to internal Institutional tenant account.
 * Crucial Security Guarantee: NEVER permits provisioning of PLATFORM_ADMIN via SCIM.
 */
export function processScimUserProvisioning(
  payload: unknown,
  _institutionId: string,
): {
  readonly externalId: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: InstitutionalRole;
  readonly active: boolean;
} {
  const parsed = scimUserSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("SCIM_SCHEMA_VALIDATION_FAILED", 400, "Invalid SCIM 2.0 User payload");
  }

  const user = parsed.data;

  // 1. Resolve primary email
  const primaryEmailObj = user.emails.find((e) => e.primary) ?? user.emails[0];
  if (!primaryEmailObj?.value) {
    throw new AppError("SCIM_EMAIL_REQUIRED", 400, "SCIM user must have at least one valid email");
  }
  const email = primaryEmailObj.value.toLowerCase().trim();

  // 2. Resolve Full Name
  const givenName = user.name?.givenName;
  const familyName = user.name?.familyName;
  const combinedName = [givenName, familyName].filter((part): part is string => Boolean(part)).join(" ");
  const fullName = user.name?.formatted ?? (combinedName.length > 0 ? combinedName : (user.displayName ?? user.userName));


  // 3. Resolve role and enforce PLATFORM_ADMIN prohibition
  let mappedRole: InstitutionalRole = "STUDENT";

  if (user.roles && user.roles.length > 0) {
    for (const r of user.roles) {
      const roleVal = r.value.toUpperCase();

      // STRICT SECURITY GUARD: Anti-Privilege Escalation
      if (roleVal === "PLATFORM_ADMIN" || roleVal === "SUPER_ADMIN" || roleVal === "ROOT") {
        throw new AppError(
          "SCIM_PRIVILEGE_ESCALATION_DENIED",
          403,
          "SCIM provisioning is forbidden from assigning PLATFORM_ADMIN role",
        );
      }

      if (roleVal.includes("ADMIN") || roleVal.includes("MANAGER")) {
        mappedRole = "INSTITUTION_ADMIN";
      } else if (roleVal.includes("INSTRUCTOR") || roleVal.includes("LECTURER") || roleVal.includes("FACULTY")) {
        mappedRole = "LECTURER";
      }
    }
  }

  return {
    externalId: user.externalId,
    email,
    fullName,
    role: mappedRole,
    active: user.active,
  };
}

// --- SCIM 2.0 Server Implementation (PROVISIONING_CORE) ---

export interface ScimRequest {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string | undefined> | undefined;
  readonly query?: {
    readonly startIndex?: string | number | undefined;
    readonly count?: string | number | undefined;
    readonly filter?: string | undefined;
  } | undefined;
}

export interface ScimResponse {
  readonly status: number;
  readonly headers?: Record<string, string> | undefined;
  readonly body: unknown;
}

// ---------------------------------------------------------------------------
// Phase 25.5 — Persistent SCIM Repository Interface
// ---------------------------------------------------------------------------

/**
 * ScimRepository — the authoritative SCIM persistence contract.
 *
 * Phase 24 shipped InMemoryScimRepository (test/development use only).
 * Phase 25.5 requires a production implementation backed by the identity
 * service's Cassandra keyspace, scoped per tenant (institutionId).
 *
 * The interface is intentionally narrow: Scim2ServerHandler uses it
 * exclusively, ensuring a single seam for swapping implementations.
 */
export interface ScimRepository {
  findUserById(id: string): Promise<ScimUser | null>;
  findUserByExternalId(externalId: string): Promise<ScimUser | null>;
  listUsers(options?: {
    startIndex?: number | undefined;
    count?: number | undefined;
    filter?: string | undefined;
  }): Promise<{ totalResults: number; resources: ScimUser[] }>;
  saveUser(user: ScimUser): Promise<ScimUser>;
  deleteUser(id: string): Promise<boolean>;
  listGroups(): Promise<ScimGroup[]>;
}

export class InMemoryScimRepository implements ScimRepository {
  private readonly users = new Map<string, ScimUser>();
  private readonly groups = new Map<string, ScimGroup>();

  public constructor() {
    // Seed standard institutional groups
    this.groups.set("group-students", {
      schemas: [SCIM_GROUP_SCHEMA_URI],
      id: "group-students",
      displayName: "Institutional Students",
      members: [],
    });
    this.groups.set("group-faculty", {
      schemas: [SCIM_GROUP_SCHEMA_URI],
      id: "group-faculty",
      displayName: "Institutional Faculty",
      members: [],
    });
  }

  public findUserById(id: string): Promise<ScimUser | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  public findUserByExternalId(externalId: string): Promise<ScimUser | null> {
    for (const u of this.users.values()) {
      if (u.externalId === externalId) return Promise.resolve(u);
    }
    return Promise.resolve(null);
  }

  public listUsers(options?: {
    startIndex?: number | undefined;
    count?: number | undefined;
    filter?: string | undefined;
  }): Promise<{ totalResults: number; resources: ScimUser[] }> {
    let all = Array.from(this.users.values());
    if (options?.filter) {
      // Basic SCIM filter support: userName eq "value" or externalId eq "value"
      const eqMatch = /(\w+)\s+eq\s+"([^"]+)"/iu.exec(options.filter);
      if (eqMatch && eqMatch[1] && eqMatch[2]) {
        const field = eqMatch[1].toLowerCase();
        const value = eqMatch[2].toLowerCase();
        all = all.filter((u) => {
          if (field === "username") return u.userName.toLowerCase() === value;
          if (field === "externalid") return u.externalId.toLowerCase() === value;
          if (field === "email") return u.emails.some((e) => e.value.toLowerCase() === value);
          return false;
        });
      }
    }

    const startIndex = Math.max(1, options?.startIndex ?? 1);
    const count = Math.min(100, Math.max(1, options?.count ?? 20));
    const paginated = all.slice(startIndex - 1, startIndex - 1 + count);

    return Promise.resolve({
      totalResults: all.length,
      resources: paginated,
    });
  }

  public saveUser(user: ScimUser): Promise<ScimUser> {
    const id = user.id ?? randomUUID();
    const now = new Date().toISOString();
    const saved: ScimUser = {
      ...user,
      id,
      meta: {
        resourceType: "User",
        created: user.meta?.created ?? now,
        lastModified: now,
        location: `/api/v1/scim/v2/Users/${id}`,
        // Increment version on each save for ETag support (RFC 7644 §3.14)
        version: String(Number(user.meta?.version ?? "0") + 1),
      },
    };
    this.users.set(id, saved);
    return Promise.resolve(saved);
  }

  public deleteUser(id: string): Promise<boolean> {
    return Promise.resolve(this.users.delete(id));
  }

  public listGroups(): Promise<ScimGroup[]> {
    return Promise.resolve(Array.from(this.groups.values()));
  }
}

export class Scim2ServerHandler {
  public constructor(
    private readonly repo: ScimRepository = new InMemoryScimRepository(),
    private readonly institutionId: string = "tenant-pilot-polytech",
  ) {}

  public async handleRequest(req: ScimRequest): Promise<ScimResponse> {
    const cleanPath = req.path.replace(/\/+$/u, "");

    // 1. GET /ServiceProviderConfig
    if (req.method === "GET" && (cleanPath === "/ServiceProviderConfig" || cleanPath.endsWith("/ServiceProviderConfig"))) {
      return {
        status: 200,
        headers: { "Content-Type": "application/scim+json" },
        body: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
          documentationUri: "https://ailss.edu.vn/docs/scim",
          patch: { supported: true },
          bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
          filter: { supported: true, maxResults: 100 },
          changePassword: { supported: false },
          sort: { supported: false },
          etag: { supported: true },
          authenticationSchemes: [
            {
              name: "OAuth Bearer Token",
              description: "Authentication scheme using the OAuth Bearer Token Standard",
              specUri: "http://www.rfc-editor.org/info/rfc6750",
              type: "oauthbearertoken",
              primary: true,
            },
          ],
        },
      };
    }

    // 1b. GET /ResourceTypes (RFC 7643 §6) — Phase 25.6
    if (req.method === "GET" && (cleanPath === "/ResourceTypes" || cleanPath.endsWith("/ResourceTypes"))) {
      return {
        status: 200,
        headers: { "Content-Type": "application/scim+json" },
        body: {
          schemas: [SCIM_LIST_RESPONSE_URI],
          totalResults: 2,
          startIndex: 1,
          itemsPerPage: 2,
          Resources: [
            {
              schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
              id: "User",
              name: "User",
              endpoint: "/Users",
              description: "SCIM 2.0 Core User",
              schema: SCIM_USER_SCHEMA_URI,
              schemaExtensions: [],
              meta: {
                resourceType: "ResourceType",
                location: `/api/v1/scim/v2/ResourceTypes/User`,
              },
            },
            {
              schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
              id: "Group",
              name: "Group",
              endpoint: "/Groups",
              description: "SCIM 2.0 Core Group",
              schema: SCIM_GROUP_SCHEMA_URI,
              schemaExtensions: [],
              meta: {
                resourceType: "ResourceType",
                location: `/api/v1/scim/v2/ResourceTypes/Group`,
              },
            },
          ],
        },
      };
    }

    // 2. GET /Schemas
    if (req.method === "GET" && (cleanPath === "/Schemas" || cleanPath.endsWith("/Schemas"))) {
      return {
        status: 200,
        headers: { "Content-Type": "application/scim+json" },
        body: {
          schemas: [SCIM_LIST_RESPONSE_URI],
          totalResults: 2,
          startIndex: 1,
          itemsPerPage: 2,
          Resources: [
            { id: SCIM_USER_SCHEMA_URI, name: "User", description: "SCIM 2.0 Core User" },
            { id: SCIM_GROUP_SCHEMA_URI, name: "Group", description: "SCIM 2.0 Core Group" },
          ],
        },
      };
    }

    // 3. GET /Groups
    if (req.method === "GET" && (cleanPath === "/Groups" || cleanPath.endsWith("/Groups"))) {
      const groups = await this.repo.listGroups();
      return {
        status: 200,
        headers: { "Content-Type": "application/scim+json" },
        body: {
          schemas: [SCIM_LIST_RESPONSE_URI],
          totalResults: groups.length,
          startIndex: 1,
          itemsPerPage: groups.length,
          Resources: groups,
        },
      };
    }

    // 4. POST /Users
    if (req.method === "POST" && (cleanPath === "/Users" || cleanPath.endsWith("/Users"))) {
      try {
        processScimUserProvisioning(req.body, this.institutionId);
        const parsed = scimUserSchema.parse(req.body);
        const existing = await this.repo.findUserByExternalId(parsed.externalId);
        if (existing) {
          return {
            status: 409,
            headers: { "Content-Type": "application/scim+json" },
            body: {
              schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
              status: "409",
              scimType: "uniqueness",
              detail: `User with externalId ${parsed.externalId} already exists`,
            },
          };
        }
        const created = await this.repo.saveUser(parsed);
        return {
          status: 201,
          headers: { "Content-Type": "application/scim+json", Location: created.meta?.location ?? "" },
          body: created,
        };
      } catch (err) {
        if (err instanceof AppError && err.code === "SCIM_PRIVILEGE_ESCALATION_DENIED") {
          return {
            status: 403,
            headers: { "Content-Type": "application/scim+json" },
            body: {
              schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
              status: "403",
              detail: err.message,
            },
          };
        }
        return {
          status: 400,
          headers: { "Content-Type": "application/scim+json" },
          body: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: "400",
            detail: (err as Error).message,
          },
        };
      }
    }

    // 5. GET /Users (List)
    if (req.method === "GET" && (cleanPath === "/Users" || cleanPath.endsWith("/Users"))) {
      const startIndex = req.query?.startIndex ? Number(req.query.startIndex) : 1;
      const count = req.query?.count ? Number(req.query.count) : 20;
      const filter = req.query?.filter;

      const { totalResults, resources } = await this.repo.listUsers({ startIndex, count, filter });
      return {
        status: 200,
        headers: { "Content-Type": "application/scim+json" },
        body: {
          schemas: [SCIM_LIST_RESPONSE_URI],
          totalResults,
          startIndex,
          itemsPerPage: resources.length,
          Resources: resources,
        },
      };
    }

    // 6. GET /Users/:id
    const userMatch = /(?:\/Users\/)([^/]+)$/u.exec(cleanPath);
    if (userMatch && userMatch[1]) {
      const userId = userMatch[1];

      if (req.method === "GET") {
        const user = (await this.repo.findUserById(userId)) ?? (await this.repo.findUserByExternalId(userId));
        if (!user) {
          return {
            status: 404,
            headers: { "Content-Type": "application/scim+json" },
            body: {
              schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
              status: "404",
              detail: `User ${userId} not found`,
            },
          };
        }
        const version = user.meta?.version ?? "1";
        return {
          status: 200,
          headers: {
            "Content-Type": "application/scim+json",
            "ETag": `W/"${version}"`,
          },
          body: user,
        };
      }

      // 7. PUT /Users/:id
      if (req.method === "PUT") {
        try {
          processScimUserProvisioning(req.body, this.institutionId);
          const parsed = scimUserSchema.parse(req.body);
          const existing = await this.repo.findUserById(userId);
          if (!existing) {
            return {
              status: 404,
              headers: { "Content-Type": "application/scim+json" },
              body: {
                schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
                status: "404",
                detail: `User ${userId} not found`,
              },
            };
          }

          // RFC 7644 §3.14: Optimistic Concurrency via If-Match
          const ifMatch = req.headers?.["if-match"] ?? req.headers?.["If-Match"];
          if (ifMatch) {
            const cleanIfMatch = ifMatch.replace(/^W\//u, "").replace(/^"|"$/gu, "").trim();
            const currentVersion = existing.meta?.version ?? "1";
            if (cleanIfMatch !== currentVersion) {
              return {
                status: 412,
                headers: { "Content-Type": "application/scim+json" },
                body: {
                  schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
                  status: "412",
                  scimType: "uniqueness",
                  detail: `Precondition Failed: Resource ETag ${cleanIfMatch} does not match current version ${currentVersion}`,
                },
              };
            }
          }

          const updated = await this.repo.saveUser({ ...parsed, id: userId, meta: existing.meta });
          const version = updated.meta?.version ?? "1";
          return {
            status: 200,
            headers: {
              "Content-Type": "application/scim+json",
              "ETag": `W/"${version}"`,
            },
            body: updated,
          };
        } catch (err) {
          const status = err instanceof AppError && err.code === "SCIM_PRIVILEGE_ESCALATION_DENIED" ? 403 : 400;
          return {
            status,
            headers: { "Content-Type": "application/scim+json" },
            body: {
              schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
              status: String(status),
              detail: (err as Error).message,
            },
          };
        }
      }

      // 8. PATCH /Users/:id
      if (req.method === "PATCH") {
        const user = await this.repo.findUserById(userId);
        if (!user) {
          return {
            status: 404,
            headers: { "Content-Type": "application/scim+json" },
            body: {
              schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
              status: "404",
              detail: `User ${userId} not found`,
            },
          };
        }

        // RFC 7644 §3.14: Optimistic Concurrency via If-Match
        const ifMatch = req.headers?.["if-match"] ?? req.headers?.["If-Match"];
        if (ifMatch) {
          const cleanIfMatch = ifMatch.replace(/^W\//u, "").replace(/^"|"$/gu, "").trim();
          const currentVersion = user.meta?.version ?? "1";
          if (cleanIfMatch !== currentVersion) {
            return {
              status: 412,
              headers: { "Content-Type": "application/scim+json" },
              body: {
                schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
                status: "412",
                scimType: "uniqueness",
                detail: `Precondition Failed: Resource ETag ${cleanIfMatch} does not match current version ${currentVersion}`,
              },
            };
          }
        }

        // Apply Patch Operations
        const patchBody = req.body as {
          Operations?: Array<{ op: string; path?: string; value: unknown }>;
        };
        const ops = patchBody.Operations ?? [];
        let updatedUser = { ...user };

        for (const op of ops) {
          const opType = op.op.toLowerCase();
          if (opType === "replace" || opType === "add") {
            if (op.path === "active") {
              updatedUser = { ...updatedUser, active: Boolean(op.value) };
            } else if (op.path === "roles" || (!op.path && typeof op.value === "object" && op.value !== null && "roles" in op.value)) {
              const roles = (op.path === "roles" ? op.value : (op.value as { roles: unknown }).roles) as Array<{ value: string }>;
              // Enforce anti-privilege escalation
              if (Array.isArray(roles) && roles.some((r) => r.value.toUpperCase().includes("PLATFORM_ADMIN"))) {
                return {
                  status: 403,
                  headers: { "Content-Type": "application/scim+json" },
                  body: {
                    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    status: "403",
                    detail: "SCIM patch is forbidden from assigning PLATFORM_ADMIN role",
                  },
                };
              }
              updatedUser = { ...updatedUser, roles };
            }
          }
        }

        const saved = await this.repo.saveUser(updatedUser);
        const version = saved.meta?.version ?? "1";
        return {
          status: 200,
          headers: {
            "Content-Type": "application/scim+json",
            "ETag": `W/"${version}"`,
          },
          body: saved,
        };
      }

      // 9. DELETE /Users/:id
      if (req.method === "DELETE") {
        const deleted = await this.repo.deleteUser(userId);
        if (!deleted) {
          return {
            status: 404,
            headers: { "Content-Type": "application/scim+json" },
            body: {
              schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
              status: "404",
              detail: `User ${userId} not found`,
            },
          };
        }
        return {
          status: 204,
          body: null,
        };
      }
    }

    return {
      status: 404,
      headers: { "Content-Type": "application/scim+json" },
      body: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "404",
        detail: `Not found: ${req.path}`,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 28.6: SCIM Operational Drift Reconciliation Engine
// ---------------------------------------------------------------------------

export type ScimReconciliationMode = "DRY_RUN" | "REPORT_ONLY" | "APPLY_SAFE_FIXES";

export type ScimDriftType =
  | "IDP_USER_EXISTS_AILSS_MISSING"
  | "AILSS_USER_EXISTS_IDP_MISSING"
  | "ROLE_MISMATCH"
  | "GROUP_MISMATCH"
  | "STATUS_MISMATCH"
  | "DUPLICATE_EXTERNAL_ID"
  | "ETAG_CONFLICT";

export interface ScimDriftItem {
  readonly driftType: ScimDriftType;
  readonly externalId: string;
  readonly userId?: string | undefined;
  readonly idpState?: Record<string, unknown> | undefined;
  readonly ailssState?: Record<string, unknown> | undefined;
  readonly actionTaken: "NONE" | "REPORTED" | "SAFE_FIX_APPLIED" | "REQUIRES_MANUAL_POLICY_REVIEW";
  readonly details: string;
}

export interface ScimReconciliationReport {
  readonly tenantId: string;
  readonly mode: ScimReconciliationMode;
  readonly scannedIdpUsers: number;
  readonly scannedAilssUsers: number;
  readonly totalDrifts: number;
  readonly drifts: readonly ScimDriftItem[];
  readonly safeFixesApplied: number;
  readonly requiresManualReview: number;
  readonly timestamp: string;
}

export const ScimDriftReconciliationEngine = {
  reconcile(options: {
    readonly tenantId: string;
    readonly mode: ScimReconciliationMode;
    readonly idpUsers: readonly ScimUser[];
    readonly ailssAccounts: readonly ProvisionedAccount[];
  }): ScimReconciliationReport {
    const { tenantId, mode, idpUsers, ailssAccounts } = options;
    const drifts: ScimDriftItem[] = [];

    const idpMap = new Map<string, ScimUser>();
    const seenExternalIds = new Set<string>();

    for (const u of idpUsers) {
      if (seenExternalIds.has(u.externalId)) {
        drifts.push({
          driftType: "DUPLICATE_EXTERNAL_ID",
          externalId: u.externalId,
          idpState: { userName: u.userName },
          actionTaken: mode === "APPLY_SAFE_FIXES" ? "REQUIRES_MANUAL_POLICY_REVIEW" : "REPORTED",
          details: `Duplicate externalId detected in IdP export: ${u.externalId}`,
        });
      } else {
        seenExternalIds.add(u.externalId);
        idpMap.set(u.externalId, u);
      }
    }

    const ailssMap = new Map<string, ProvisionedAccount>();
    for (const a of ailssAccounts) {
      ailssMap.set(a.externalId, a);
    }

    // 1. Check IdP users against AILSS
    for (const [extId, idpUser] of idpMap.entries()) {
      const ailssUser = ailssMap.get(extId);
      if (!ailssUser) {
        drifts.push({
          driftType: "IDP_USER_EXISTS_AILSS_MISSING",
          externalId: extId,
          idpState: { userName: idpUser.userName, active: idpUser.active },
          actionTaken: mode === "APPLY_SAFE_FIXES" ? "SAFE_FIX_APPLIED" : "REPORTED",
          details: `User exists in IdP but missing in AILSS: ${extId}`,
        });
        continue;
      }

      // Check active/inactive status mismatch
      if (idpUser.active !== ailssUser.active) {
        // Safe fix if deactivating
        const isDeactivation = !idpUser.active && ailssUser.active;
        drifts.push({
          driftType: "STATUS_MISMATCH",
          externalId: extId,
          userId: ailssUser.userId,
          idpState: { active: idpUser.active },
          ailssState: { active: ailssUser.active },
          actionTaken:
            mode === "APPLY_SAFE_FIXES"
              ? isDeactivation
                ? "SAFE_FIX_APPLIED"
                : "REQUIRES_MANUAL_POLICY_REVIEW"
              : "REPORTED",
          details: `Status mismatch for ${extId}: IdP=${String(idpUser.active)}, AILSS=${String(ailssUser.active)}`,
        });
      }

      // Check role mismatch
      const expectedRole = idpUser.roles?.[0]?.value?.toUpperCase() ?? "STUDENT";
      const actualRole = ailssUser.role;
      if (expectedRole !== actualRole) {
        drifts.push({
          driftType: "ROLE_MISMATCH",
          externalId: extId,
          userId: ailssUser.userId,
          idpState: { role: expectedRole },
          ailssState: { role: actualRole },
          actionTaken: mode === "APPLY_SAFE_FIXES" ? "REQUIRES_MANUAL_POLICY_REVIEW" : "REPORTED",
          details: `Role mismatch for ${extId}: IdP=${expectedRole}, AILSS=${actualRole}. Privilege changes require manual policy review.`,
        });
      }
    }

    // 2. Check AILSS accounts against IdP (orphans)
    for (const [extId, ailssUser] of ailssMap.entries()) {
      if (!idpMap.has(extId)) {
        drifts.push({
          driftType: "AILSS_USER_EXISTS_IDP_MISSING",
          externalId: extId,
          userId: ailssUser.userId,
          ailssState: { role: ailssUser.role, active: ailssUser.active },
          actionTaken: mode === "APPLY_SAFE_FIXES" ? "REQUIRES_MANUAL_POLICY_REVIEW" : "REPORTED",
          details: `Account exists in AILSS but removed from IdP: ${extId}. Orphan account deactivation requires policy review.`,
        });
      }
    }

    const safeFixesApplied = drifts.filter((d) => d.actionTaken === "SAFE_FIX_APPLIED").length;
    const requiresManualReview = drifts.filter(
      (d) => d.actionTaken === "REQUIRES_MANUAL_POLICY_REVIEW",
    ).length;

    return {
      tenantId,
      mode,
      scannedIdpUsers: idpUsers.length,
      scannedAilssUsers: ailssAccounts.length,
      totalDrifts: drifts.length,
      drifts,
      safeFixesApplied,
      requiresManualReview,
      timestamp: new Date().toISOString(),
    };
  },
} as const;
