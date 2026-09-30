import { z } from "zod";

export const oneRosterUserSchema = z.object({
  sourcedId: z.string().min(1),
  status: z.enum(["active", "tobedeleted"]).default("active"),
  dateLastModified: z.string().datetime().optional(),
  username: z.string().min(1),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  role: z.enum(["student", "teacher", "administrator", "aide", "guardian"]),
  email: z.string().email(),
  enabledUser: z.boolean().default(true),
});

export type OneRosterUser = z.infer<typeof oneRosterUserSchema>;

export const oneRosterClassSchema = z.object({
  sourcedId: z.string().min(1),
  status: z.enum(["active", "tobedeleted"]).default("active"),
  dateLastModified: z.string().datetime().optional(),
  title: z.string().min(1),
  classCode: z.string().min(1),
  courseSourcedId: z.string().min(1),
  termSourcedIds: z.array(z.string()).min(1),
});

export type OneRosterClass = z.infer<typeof oneRosterClassSchema>;

export const oneRosterEnrollmentSchema = z.object({
  sourcedId: z.string().min(1),
  status: z.enum(["active", "tobedeleted"]).default("active"),
  dateLastModified: z.string().datetime().optional(),
  userSourcedId: z.string().min(1),
  classSourcedId: z.string().min(1),
  role: z.enum(["student", "teacher"]),
  primary: z.boolean().default(false),
  beginDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type OneRosterEnrollment = z.infer<typeof oneRosterEnrollmentSchema>;

export type OneRosterUserInput = z.input<typeof oneRosterUserSchema>;
export type OneRosterClassInput = z.input<typeof oneRosterClassSchema>;
export type OneRosterEnrollmentInput = z.input<typeof oneRosterEnrollmentSchema>;

export interface OneRosterSyncBatch {
  readonly organizationId: string;
  readonly syncId: string;
  readonly users: readonly OneRosterUserInput[];
  readonly classes: readonly OneRosterClassInput[];
  readonly enrollments: readonly OneRosterEnrollmentInput[];
}

export interface OneRosterSyncSummary {
  readonly syncId: string;
  readonly usersProcessed: number;
  readonly classesProcessed: number;
  readonly enrollmentsProcessed: number;
  readonly usersDeactivated: number;
  readonly enrollmentsDeactivated: number;
  readonly errors: readonly string[];
}

/**
 * Idempotent OneRoster 1.2 SIS synchronization processor.
 * Validates relational integrity between users, classes, and enrollments.
 * Guarantees that administrator roles never escalate to PLATFORM_ADMIN.
 */
export const OneRosterSyncEngine = {
  processBatch(batch: OneRosterSyncBatch): OneRosterSyncSummary {
    const errors: string[] = [];
    const validUserIds = new Set<string>();
    const validClassIds = new Set<string>();

    let usersProcessed = 0;
    let classesProcessed = 0;
    let enrollmentsProcessed = 0;
    let usersDeactivated = 0;
    let enrollmentsDeactivated = 0;

    // 1. Process Users
    for (const rawUser of batch.users) {
      const parsed = oneRosterUserSchema.safeParse(rawUser);
      if (!parsed.success) {
        errors.push(`Invalid OneRoster user: ${rawUser.sourcedId}`);
        continue;
      }
      const u = parsed.data;
      validUserIds.add(u.sourcedId);
      usersProcessed++;

      if (u.status === "tobedeleted" || !u.enabledUser) {
        usersDeactivated++;
      }
    }

    // 2. Process Classes
    for (const rawClass of batch.classes) {
      const parsed = oneRosterClassSchema.safeParse(rawClass);
      if (!parsed.success) {
        errors.push(`Invalid OneRoster class: ${rawClass.sourcedId}`);
        continue;
      }
      validClassIds.add(parsed.data.sourcedId);
      classesProcessed++;
    }

    // 3. Process Enrollments with Referential Integrity Checks
    for (const rawEnrollment of batch.enrollments) {
      const parsed = oneRosterEnrollmentSchema.safeParse(rawEnrollment);
      if (!parsed.success) {
        errors.push(`Invalid OneRoster enrollment: ${rawEnrollment.sourcedId}`);
        continue;
      }
      const e = parsed.data;

      // Referential integrity check
      if (!validUserIds.has(e.userSourcedId)) {
        errors.push(`Enrollment ${e.sourcedId} references unknown user ${e.userSourcedId}`);
        continue;
      }

      if (!validClassIds.has(e.classSourcedId)) {
        errors.push(`Enrollment ${e.sourcedId} references unknown class ${e.classSourcedId}`);
        continue;
      }

      enrollmentsProcessed++;
      if (e.status === "tobedeleted") {
        enrollmentsDeactivated++;
      }
    }

    return {
      syncId: batch.syncId,
      usersProcessed,
      classesProcessed,
      enrollmentsProcessed,
      usersDeactivated,
      enrollmentsDeactivated,
      errors,
    };
  },

  mapRole(role: OneRosterUser["role"]): "STUDENT" | "LECTURER" | "INSTITUTION_ADMIN" {
    switch (role) {
      case "administrator":
        return "INSTITUTION_ADMIN";
      case "teacher":
        return "LECTURER";
      default:
        return "STUDENT";
    }
  },
} as const;

// --- OneRoster 1.2 CSV Import & Delta Sync ---

export interface OneRosterCsvPackage {
  readonly manifestCsv?: string | undefined;
  readonly orgsCsv?: string | undefined;
  readonly coursesCsv?: string | undefined;
  readonly classesCsv?: string | undefined;
  readonly usersCsv?: string | undefined;
  readonly enrollmentsCsv?: string | undefined;
}

export interface OneRosterParsedCsvResult {
  readonly manifestValid: boolean;
  readonly orgsCount: number;
  readonly coursesCount: number;
  readonly classesCount: number;
  readonly usersCount: number;
  readonly enrollmentsCount: number;
  readonly deltaDeletionsCount: number;
  readonly integrityViolations: readonly string[];
  readonly summary: OneRosterSyncSummary;
}

export function parseCsvLines(csvText: string): Array<Record<string, string>> {
  const lines = csvText
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length <= 1) return [];

  const headerLine = lines[0];
  if (!headerLine) return [];

  const headers = headerLine.split(",").map((h) => h.trim().replace(/^["']|["']$/gu, ""));
  const records: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Basic CSV splitting respecting quotes
    const values: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line.charAt(c);
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        values.push(cur.trim().replace(/^["']|["']$/gu, ""));
        cur = "";
      } else {
        cur += ch;
      }
    }
    values.push(cur.trim().replace(/^["']|["']$/gu, ""));

    const row: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      const header = headers[h];
      if (header) {
        row[header] = values[h] ?? "";
      }
    }
    records.push(row);
  }

  return records;
}

export const OneRosterCsvParser = {
  parsePackage(
    pkg: OneRosterCsvPackage,
    options: { readonly organizationId: string; readonly syncId?: string | undefined },
  ): OneRosterParsedCsvResult {
    const syncId = options.syncId ?? `sync-csv-${Date.now().toString()}`;
    const violations: string[] = [];

    // 1. Verify Manifest
    let manifestValid = true;
    if (pkg.manifestCsv) {
      const manifestRows = parseCsvLines(pkg.manifestCsv);
      const props = new Map<string, string>();
      for (const r of manifestRows) {
        const prop = r["propertyName"] ?? r["property"] ?? "";
        const val = r["value"] ?? "";
        if (prop) props.set(prop.toLowerCase(), val);
      }
      if (props.has("oneroster.version") && props.get("oneroster.version") !== "1.2") {
        manifestValid = false;
        violations.push(
          `Unsupported OneRoster version in manifest: ${props.get("oneroster.version") ?? "unknown"}`,
        );
      }
    }

    // 2. Parse Orgs
    const orgRows = pkg.orgsCsv ? parseCsvLines(pkg.orgsCsv) : [];
    const validOrgIds = new Set<string>(
      orgRows.map((o) => o["sourcedId"]).filter((id): id is string => Boolean(id)),
    );

    // 3. Parse Courses
    const courseRows = pkg.coursesCsv ? parseCsvLines(pkg.coursesCsv) : [];
    const validCourseIds = new Set<string>();
    for (const c of courseRows) {
      const id = c["sourcedId"];
      if (id) {
        validCourseIds.add(id);
        const orgId = c["orgSourcedId"];
        if (orgId && validOrgIds.size > 0 && !validOrgIds.has(orgId)) {
          violations.push(`Course ${id} references unknown organization ${orgId}`);
        }
      }
    }

    // 4. Parse Classes
    const classRows = pkg.classesCsv ? parseCsvLines(pkg.classesCsv) : [];
    const parsedClasses: OneRosterClassInput[] = [];
    for (const cl of classRows) {
      const sourcedId = cl["sourcedId"] ?? "";
      const courseSourcedId = cl["courseSourcedId"] ?? "";
      if (validCourseIds.size > 0 && !validCourseIds.has(courseSourcedId)) {
        violations.push(`Class ${sourcedId} references unknown course ${courseSourcedId}`);
      }
      const termIds = (cl["termSourcedIds"] ?? "")
        .split(/[,;]/u)
        .map((t) => t.trim())
        .filter(Boolean);
      parsedClasses.push({
        sourcedId,
        status: cl["status"] === "tobedeleted" ? "tobedeleted" : "active",
        title: cl["title"] ?? "Untitled Class",
        classCode: cl["classCode"] ?? sourcedId,
        courseSourcedId,
        termSourcedIds: termIds.length > 0 ? termIds : ["term-default"],
        dateLastModified: cl["dateLastModified"] ? new Date(cl["dateLastModified"]).toISOString() : undefined,
      });
    }

    // 5. Parse Users
    const userRows = pkg.usersCsv ? parseCsvLines(pkg.usersCsv) : [];
    const parsedUsers: OneRosterUserInput[] = [];
    let deltaDeletionsCount = 0;

    for (const u of userRows) {
      const sourcedId = u["sourcedId"] ?? "";
      const status = u["status"] === "tobedeleted" ? "tobedeleted" : "active";
      const enabled = u["enabledUser"] ? u["enabledUser"].toLowerCase() === "true" : true;
      if (status === "tobedeleted" || !enabled) {
        deltaDeletionsCount++;
      }

      const rawRole = (u["role"] ?? "student").toLowerCase();
      const validRoles = ["student", "teacher", "administrator", "aide", "guardian"] as const;
      const role = validRoles.includes(rawRole as (typeof validRoles)[number])
        ? (rawRole as (typeof validRoles)[number])
        : "student";

      parsedUsers.push({
        sourcedId,
        status,
        username: u["username"] ?? sourcedId,
        givenName: u["givenName"] ?? "Unknown",
        familyName: u["familyName"] ?? "User",
        role,
        email: u["email"] ?? `${sourcedId}@tenant.edu.vn`,
        enabledUser: enabled,
        dateLastModified: u["dateLastModified"] ? new Date(u["dateLastModified"]).toISOString() : undefined,
      });
    }

    // 6. Parse Enrollments
    const enrollmentRows = pkg.enrollmentsCsv ? parseCsvLines(pkg.enrollmentsCsv) : [];
    const parsedEnrollments: OneRosterEnrollmentInput[] = [];

    for (const e of enrollmentRows) {
      const sourcedId = e["sourcedId"] ?? "";
      const status = e["status"] === "tobedeleted" ? "tobedeleted" : "active";
      if (status === "tobedeleted") {
        deltaDeletionsCount++;
      }

      const role = e["role"]?.toLowerCase() === "teacher" ? "teacher" : "student";
      parsedEnrollments.push({
        sourcedId,
        status,
        userSourcedId: e["userSourcedId"] ?? "",
        classSourcedId: e["classSourcedId"] ?? "",
        role,
        primary: e["primary"] ? e["primary"].toLowerCase() === "true" : false,
        beginDate: e["beginDate"],
        endDate: e["endDate"],
        dateLastModified: e["dateLastModified"] ? new Date(e["dateLastModified"]).toISOString() : undefined,
      });
    }

    // 7. Execute Sync Batch through engine
    const batchSummary = OneRosterSyncEngine.processBatch({
      organizationId: options.organizationId,
      syncId,
      users: parsedUsers,
      classes: parsedClasses,
      enrollments: parsedEnrollments,
    });

    const allViolations = [...violations, ...batchSummary.errors];

    return {
      manifestValid,
      orgsCount: orgRows.length,
      coursesCount: courseRows.length,
      classesCount: classRows.length,
      usersCount: userRows.length,
      enrollmentsCount: enrollmentRows.length,
      deltaDeletionsCount,
      integrityViolations: allViolations,
      summary: {
        ...batchSummary,
        errors: allViolations,
      },
    };
  },
} as const;

// ---------------------------------------------------------------------------
// Phase 28.7: SIS / OneRoster Operational Drift Reconciliation Engine
// ---------------------------------------------------------------------------

export type OneRosterConflictType =
  | "ORPHAN_ENROLLMENT"
  | "STALE_COURSE"
  | "STALE_CLASS"
  | "DEACTIVATED_STUDENT"
  | "LECTURER_ROLE_CHANGE"
  | "DUPLICATE_SOURCED_ID";

export interface OneRosterReconciliationConflict {
  readonly conflictType: OneRosterConflictType;
  readonly sourcedId: string;
  readonly sourceRecord?: Record<string, unknown> | undefined;
  readonly ailssRecord?: Record<string, unknown> | undefined;
  readonly lastSyncedAt?: string | undefined;
  readonly sourceVersion?: string | undefined;
  readonly details: string;
}

export interface OneRosterReconciliationReport {
  readonly organizationId: string;
  readonly totalChecked: number;
  readonly conflictsCount: number;
  readonly conflicts: readonly OneRosterReconciliationConflict[];
  readonly scannedAt: string;
}

export const OneRosterReconciliationEngine = {
  reconcile(options: {
    readonly organizationId: string;
    readonly sisUsers: readonly OneRosterUserInput[];
    readonly sisClasses: readonly OneRosterClassInput[];
    readonly sisEnrollments: readonly OneRosterEnrollmentInput[];
    readonly ailssUsers: readonly {
      readonly sourcedId: string;
      readonly role: string;
      readonly active: boolean;
    }[];
    readonly ailssClasses: readonly { readonly sourcedId: string; readonly active: boolean }[];
    readonly ailssEnrollments: readonly {
      readonly sourcedId: string;
      readonly userSourcedId: string;
      readonly classSourcedId: string;
    }[];
  }): OneRosterReconciliationReport {
    const { organizationId, sisUsers, sisClasses, sisEnrollments, ailssUsers, ailssClasses } = options;
    const conflicts: OneRosterReconciliationConflict[] = [];

    const sisUserMap = new Map<string, OneRosterUserInput>();
    const seenUserIds = new Set<string>();
    for (const u of sisUsers) {
      if (seenUserIds.has(u.sourcedId)) {
        conflicts.push({
          conflictType: "DUPLICATE_SOURCED_ID",
          sourcedId: u.sourcedId,
          sourceRecord: { username: u.username },
          details: `Duplicate user sourcedId in SIS feed: ${u.sourcedId}`,
        });
      } else {
        seenUserIds.add(u.sourcedId);
        sisUserMap.set(u.sourcedId, u);
      }
    }

    const sisClassMap = new Map<string, OneRosterClassInput>();
    for (const c of sisClasses) {
      sisClassMap.set(c.sourcedId, c);
    }

    const ailssUserMap = new Map<string, { sourcedId: string; role: string; active: boolean }>();
    for (const au of ailssUsers) {
      ailssUserMap.set(au.sourcedId, au);
    }

    const ailssClassMap = new Map<string, { sourcedId: string; active: boolean }>();
    for (const ac of ailssClasses) {
      ailssClassMap.set(ac.sourcedId, ac);
    }

    // 1. Detect orphan enrollments
    for (const enr of sisEnrollments) {
      const userExists = sisUserMap.has(enr.userSourcedId) || ailssUserMap.has(enr.userSourcedId);
      const classExists = sisClassMap.has(enr.classSourcedId) || ailssClassMap.has(enr.classSourcedId);

      if (!userExists || !classExists) {
        conflicts.push({
          conflictType: "ORPHAN_ENROLLMENT",
          sourcedId: enr.sourcedId,
          sourceRecord: {
            userSourcedId: enr.userSourcedId,
            classSourcedId: enr.classSourcedId,
          },
          details: `Orphan enrollment ${enr.sourcedId}: missing ${!userExists ? `user ${enr.userSourcedId}` : `class ${enr.classSourcedId}`}`,
        });
      }
    }

    // 2. Detect deactivated students
    for (const [sId, sisUser] of sisUserMap.entries()) {
      const ailssUser = ailssUserMap.get(sId);
      if (ailssUser) {
        const sisDeactivated = sisUser.status === "tobedeleted" || sisUser.enabledUser === false;
        if (sisDeactivated && ailssUser.active) {
          conflicts.push({
            conflictType: "DEACTIVATED_STUDENT",
            sourcedId: sId,
            sourceRecord: { status: sisUser.status, enabledUser: sisUser.enabledUser },
            ailssRecord: { active: ailssUser.active },
            details: `User ${sId} deactivated in SIS but remains active in AILSS`,
          });
        }

        // 3. Detect lecturer role changes
        if (sisUser.role === "teacher" && ailssUser.role !== "teacher" && ailssUser.role !== "LECTURER") {
          conflicts.push({
            conflictType: "LECTURER_ROLE_CHANGE",
            sourcedId: sId,
            sourceRecord: { role: sisUser.role },
            ailssRecord: { role: ailssUser.role },
            details: `Faculty role mismatch for ${sId}: SIS indicates teacher, AILSS has ${ailssUser.role}`,
          });
        }
      }
    }

    // 4. Detect stale classes
    for (const [cId, sisClass] of sisClassMap.entries()) {
      if (sisClass.status === "tobedeleted") {
        const ailssClass = ailssClassMap.get(cId);
        if (ailssClass?.active) {
          conflicts.push({
            conflictType: "STALE_CLASS",
            sourcedId: cId,
            sourceRecord: { status: sisClass.status },
            ailssRecord: { active: ailssClass.active },
            details: `Class ${cId} marked tobedeleted in SIS but remains active in AILSS`,
          });
        }
      }
    }

    const totalChecked = sisUsers.length + sisClasses.length + sisEnrollments.length;

    return {
      organizationId,
      totalChecked,
      conflictsCount: conflicts.length,
      conflicts,
      scannedAt: new Date().toISOString(),
    };
  },
} as const;
