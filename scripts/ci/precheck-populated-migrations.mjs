import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const P = (classification, review) => ({ classification, review });
export const canonicalPolicy = {
  "001_keyspaces.cql": P("PRECHECK_REQUIRED", "Approve datacenters and replication factors."),
  "010_identity_schema.cql": P("SAFE_ADDITIVE", "Verify identity keyspace, roles and schema agreement."),
  "011_identity_security_versions.cql": P(
    "PRECHECK_REQUIRED",
    "Verify base tables and historical null handling.",
  ),
  "012_lecturer_applications.cql": P(
    "SAFE_ADDITIVE",
    "Verify identity keyspace, roles and schema agreement.",
  ),
  "013_profile_avatar.cql": P(
    "BACKFILL_OR_RECONCILIATION_REVIEW",
    "Inventory existing avatar objects and metadata.",
  ),
  "014_external_identity.cql": P("SAFE_ADDITIVE", "Verify identity keyspace and external identity tables."),
  "015_institution_tenancy.cql": P(
    "SAFE_ADDITIVE",
    "Verify identity keyspace and institutional tenancy/SSO tables.",
  ),
  "020_learning_schema.cql": P("SAFE_ADDITIVE", "Verify learning keyspace, roles and schema agreement."),
  "021_learning_course_published_at.cql": P(
    "PRECHECK_REQUIRED",
    "Review historical nulls and reconciliation leases.",
  ),
  "022_learning_lesson_authoring.cql": P("SAFE_ADDITIVE", "Verify learning keyspace and writer rollout."),
  "023_learning_course_offerings.cql": P("SAFE_ADDITIVE", "Validate existing course/class relationships."),
  "024_learning_entitlement_commerce.cql": P(
    "BACKFILL_OR_RECONCILIATION_REVIEW",
    "Review historical order fields and fulfillment projections.",
  ),
  "025_learning_progress.cql": P("PRECHECK_REQUIRED", "Review historical operation/event identifiers."),
  "026_learning_sepay.cql": P(
    "BACKFILL_OR_RECONCILIATION_REVIEW",
    "Reconcile orders/provider transactions without synthesizing success.",
  ),
  "027_learning_finance_ledger.cql": P(
    "SAFE_ADDITIVE",
    "Verify learning keyspace, financial ledger, refund and payout tables.",
  ),
  "028_course_versioning.cql": P(
    "SAFE_ADDITIVE",
    "Verify learning keyspace and course release versioning tables.",
  ),
  "029_learner_mastery.cql": P(
    "SAFE_ADDITIVE",
    "Verify learning keyspace, concept mastery, and adaptive graph tables.",
  ),
  "030_classroom_schema.cql": P("SAFE_ADDITIVE", "Verify classroom keyspace, roles and schema agreement."),
  "031_classroom_class_model.cql": P(
    "PRECHECK_REQUIRED",
    "Review defaults for existing class and membership rows.",
  ),
  "032_classroom_sessions.cql": P("SAFE_ADDITIVE", "Validate class relationships before writer rollout."),
  "033_classroom_student_schedule.cql": P(
    "TABLE_OPTION_CHANGE",
    "Review seven-day default TTL and existing reservations.",
  ),
  "034_classroom_attendance_presence.cql": P(
    "SAFE_ADDITIVE",
    "Verify classroom keyspace and writer rollout.",
  ),
  "035_classroom_manual_attendance.cql": P(
    "PRECHECK_REQUIRED",
    "Review null manual notes on historical attendance.",
  ),
  "040_assessment_schema.cql": P("SAFE_ADDITIVE", "Verify assessment keyspace, roles and schema agreement."),
  "041_assessment_quiz_authoring.cql": P(
    "PRECHECK_REQUIRED",
    "Review historical quiz rows and v2 projection rollout.",
  ),
  "042_assessment_attempt_guard.cql": P("SAFE_ADDITIVE", "Verify assessment keyspace and writer rollout."),
  "043_assessment_submit.cql": P("PRECHECK_REQUIRED", "Review historical attempt/result null compatibility."),
  "044_assessment_ai_import.cql": P("SAFE_ADDITIVE", "Verify assessment keyspace and writer rollout."),
  "045_assessment_manual_grading.cql": P(
    "SAFE_ADDITIVE",
    "Verify assessment keyspace and manual grading columns.",
  ),
  "050_interaction_schema.cql": P(
    "SAFE_ADDITIVE",
    "Verify interaction keyspace, roles and schema agreement.",
  ),
  "051_interaction_comments.cql": P("PRECHECK_REQUIRED", "Review historical idempotency and comment rows."),
  "052_interaction_reviews.cql": P(
    "BACKFILL_OR_RECONCILIATION_REVIEW",
    "Reconcile rating contribution and locator projections.",
  ),
  "053_interaction_moderation.cql": P("PRECHECK_REQUIRED", "Review report queue bounds and historical rows."),
  "060_ai_schema.cql": P("SAFE_ADDITIVE", "Verify AI keyspace, roles and schema agreement."),
  "061_ai_document_extraction.cql": P("PRECHECK_REQUIRED", "Review document object metadata linkage."),
  "062_ai_quiz_generation.cql": P("PRECHECK_REQUIRED", "Review quotas and historical provider operations."),
  "063_ai_human_approval.cql": P("SAFE_ADDITIVE", "Verify AI keyspace and writer rollout."),
  "064_ai_assistant.cql": P("SAFE_ADDITIVE", "Verify AI keyspace and assistant tables."),
  "065_ai_safety_audit.cql": P("SAFE_ADDITIVE", "Verify AI keyspace and safety audit tables."),
  "070_notification_schema.cql": P("PRECHECK_REQUIRED", "Review source fields on historical notifications."),
  "075_audit_support_schema.cql": P("SAFE_ADDITIVE", "Verify audit keyspace, roles and schema agreement."),
  "076_learning_sepay_recovery.cql": P(
    "BACKFILL_OR_RECONCILIATION_REVIEW",
    "Define unresolved-order eligibility and manual review.",
  ),
  "077_product_analytics_events.cql": P(
    "SAFE_ADDITIVE",
    "Verify audit keyspace and product analytics events tables.",
  ),
  "078_verified_credentials_and_lti.cql": P(
    "SAFE_ADDITIVE",
    "Verify learning keyspace and credentials/LTI tables.",
  ),
  "079_adaptive_learning_v2_and_institution.cql": P(
    "SAFE_ADDITIVE",
    "Verify learning keyspace, adaptive learning v2, copilot drafts, and institution tables.",
  ),
  "080_wave2_course_authoring_and_experimentation.cql": P(
    "SAFE_ADDITIVE",
    "Verify learning, assessment and identity keyspaces for Wave 2 tables.",
  ),
  "081_finance_projection_and_durable_refunds.cql": P(
    "BACKFILL_OR_RECONCILIATION_REVIEW",
    "Reconcile every historical paid order and refund before marking the finance projection READY.",
  ),
  "082_identity_federation_runtime.cql": P(
    "SAFE_ADDITIVE",
    "Verify Identity federation transaction, replay, LTI deployment, and federated subject tables.",
  ),
  "083_adaptive_runtime_completion.cql": P(
    "SAFE_ADDITIVE",
    "Apply required policy/version and durable Study Plan item lifecycle fields before enabling Revision G routes.",
  ),
  "084_mastery_evidence_ingestion.cql": P(
    "SAFE_ADDITIVE",
    "Create idempotent authoritative mastery evidence and ingestion recovery tables before starting the recalculation consumer.",
  ),
  "085_media_vertical_slice.cql": P(
    "SAFE_ADDITIVE",
    "Verify private media metadata/queue tables, media worker role, and course publication fence before enabling upload traffic.",
  ),
  "086_media_replacement_audit.cql": P(
    "SAFE_ADDITIVE",
    "Verify the media lesson binding has an atomic replacement history column before enabling published-media replacement.",
  ),
  "087_media_quota.cql": P(
    "SAFE_ADDITIVE",
    "Verify tenant media quota CAS table and reconcile existing media before enabling quota-enforced uploads.",
  ),
  "088_media_output_journal.cql": P(
    "SAFE_ADDITIVE",
    "Verify output-attempt journal and worker grants before enabling durable derived cleanup.",
  ),
  "089_identity_password_reset.cql": P(
    "SAFE_ADDITIVE",
    "Verify password reset challenge storage and token expiry before enabling recovery.",
  ),
  "090_lecturer_public_details.cql": P(
    "SAFE_ADDITIVE",
    "Verify lecturer profile detail columns and public read compatibility.",
  ),
  "091_lecturer_payout_preparation.cql": P(
    "SAFE_ADDITIVE",
    "Verify payout destination and monthly instruction tables before preparing transfers.",
  ),
  "092_platform_commission_policy.cql": P(
    "SAFE_ADDITIVE",
    "Verify effective-time commission history before enabling admin rate changes.",
  ),
};

export function findUnsafeStatements(body) {
  return [
    ["DROP", /\bDROP\b/i],
    ["TRUNCATE", /\bTRUNCATE\b/i],
    ["DELETE", /\bDELETE\s+FROM\b/i],
    ["INSERT", /\bINSERT\s+INTO\b/i],
    ["UPDATE", /\bUPDATE\s+[\w.]+\s+SET\b/i],
    ["BATCH", /\bBEGIN\s+(?:UNLOGGED\s+|COUNTER\s+)?BATCH\b/i],
  ]
    .filter(([, pattern]) => pattern.test(body))
    .map(([label]) => label);
}

function forbiddenKeys(value, path = "") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const next = path ? `${path}.${key}` : key;
    const own =
      /password|private.?key|secret|token|credential|api.?key|access.?key|hmac|payment|provider.?key/i.test(
        key,
      )
        ? [next]
        : [];
    return own.concat(forbiddenKeys(child, next));
  });
}

export function evaluateTargetSnapshot(snapshot) {
  if (!snapshot) return { status: "BLOCKED_EXTERNAL", reasons: ["target snapshot not supplied"] };
  const reasons = [];
  const allowed = new Set([
    "schemaAgreement",
    "cassandraVersion",
    "datacenters",
    "replication",
    "observedTables",
    "observedColumns",
    "tableOptions",
    "diskFreeBytes",
    "capacityApproved",
    "populationFacts",
  ]);
  const unknown = Object.keys(snapshot).filter((key) => !allowed.has(key));
  if (unknown.length) reasons.push(`unknown top-level fields: ${unknown.join(", ")}`);
  const forbidden = forbiddenKeys(snapshot);
  if (forbidden.length) reasons.push(`forbidden secret-bearing fields: ${forbidden.join(", ")}`);
  const hasPlaceholder = (value) =>
    typeof value === "string"
      ? /^<.*>$/.test(value) || value.trim() === ""
      : Array.isArray(value)
        ? value.some(hasPlaceholder)
        : value && typeof value === "object"
          ? Object.entries(value).some(([key, child]) => hasPlaceholder(key) || hasPlaceholder(child))
          : false;
  if (hasPlaceholder(snapshot)) reasons.push("placeholder or blank values are not observations");
  if (snapshot.schemaAgreement !== true) reasons.push("schema agreement not confirmed");
  if (typeof snapshot.cassandraVersion !== "string" || !snapshot.cassandraVersion)
    reasons.push("Cassandra version missing");
  if (!Array.isArray(snapshot.datacenters) || !snapshot.datacenters.length)
    reasons.push("datacenters missing");
  const datacenters = Array.isArray(snapshot.datacenters) ? snapshot.datacenters : [];
  const factors = snapshot.replication?.factors;
  if (
    snapshot.replication?.strategy !== "NetworkTopologyStrategy" ||
    snapshot.replication?.approved !== true ||
    !factors ||
    typeof factors !== "object" ||
    !Object.keys(factors).length ||
    Object.keys(factors).some((dc) => !datacenters.includes(dc)) ||
    datacenters.some((dc) => !Number.isInteger(factors[dc]) || factors[dc] <= 0)
  )
    reasons.push("approved NetworkTopologyStrategy factors missing or invalid");
  if (!Array.isArray(snapshot.observedTables) || !snapshot.observedTables.length)
    reasons.push("observed tables missing");
  if (!snapshot.observedColumns || typeof snapshot.observedColumns !== "object")
    reasons.push("observed columns missing");
  if (!snapshot.tableOptions || typeof snapshot.tableOptions !== "object")
    reasons.push("table options missing");
  const observedTables = Array.isArray(snapshot.observedTables) ? snapshot.observedTables : [];
  if (
    observedTables.some(
      (table) => !Array.isArray(snapshot.observedColumns?.[table]) || !snapshot.observedColumns[table].length,
    )
  )
    reasons.push("each observed table requires non-empty observed columns");
  if (
    observedTables.some(
      (table) =>
        !snapshot.tableOptions?.[table] ||
        typeof snapshot.tableOptions[table] !== "object" ||
        Array.isArray(snapshot.tableOptions[table]),
    )
  )
    reasons.push("each observed table requires table options");
  if (!Number.isFinite(snapshot.diskFreeBytes) || snapshot.diskFreeBytes <= 0)
    reasons.push("free disk missing");
  if (snapshot.capacityApproved !== true) reasons.push("capacity not approved");
  const requiredReviews = ["013", "024", "026", "033", "052", "076"];
  if (
    !snapshot.populationFacts ||
    typeof snapshot.populationFacts !== "object" ||
    !snapshot.populationFacts.reviewedMigrations ||
    requiredReviews.some((id) => snapshot.populationFacts.reviewedMigrations[id] !== true)
  )
    reasons.push("required populated-data review facts missing");
  return { status: reasons.length ? "BLOCKED_EXTERNAL" : "QUALIFIED_READ_ONLY", reasons };
}

export async function runPrecheck({ snapshotPath } = {}) {
  const inventory = {};
  const expected = Object.keys(canonicalPolicy);

  // 1. Check for duplicate IDs or unclassified entries in policy
  const policyIds = new Set();
  for (const name of expected) {
    const id = name.split("_")[0];
    if (policyIds.has(id)) {
      throw new Error(`DUPLICATE_MIGRATION_ID: Duplicate migration ID ${id} in policy`);
    }
    policyIds.add(id);
  }

  // 2. Load canonical migration registry baseline if present
  let registryMap = null;
  try {
    const registryContent = await readFile(join("database", "migration-registry.json"), "utf8");
    const registryData = JSON.parse(registryContent);
    if (Array.isArray(registryData.migrations)) {
      registryMap = new Map(registryData.migrations.map((m) => [m.filename, m]));
    }
  } catch {
    // Registry not loaded or absent
  }

  for (const profile of ["dev", "research"]) {
    const directory = join("database", "migrations", profile);
    const names = (await readdir(directory)).filter((name) => name.endsWith(".cql")).sort();
    if (JSON.stringify(names) !== JSON.stringify(expected))
      throw new Error(`${profile} migration set differs from explicit policy`);

    // Verify ordering and duplicate IDs in directory
    const seenIds = new Set();
    let previousIdNum = -1;
    for (const name of names) {
      if (!canonicalPolicy[name]) {
        throw new Error(`UNCLASSIFIED_MIGRATION: Migration ${name} is not classified in canonical policy`);
      }
      const idStr = name.split("_")[0];
      if (seenIds.has(idStr)) {
        throw new Error(`DUPLICATE_MIGRATION_ID: Duplicate migration ID ${idStr} found in ${profile}`);
      }
      seenIds.add(idStr);
      const idNum = parseInt(idStr, 10);
      if (!Number.isNaN(idNum)) {
        if (idNum <= previousIdNum) {
          throw new Error(`OUT_OF_ORDER_MIGRATION: Migration ${name} (${idStr}) is out of order`);
        }
        previousIdNum = idNum;
      }
    }

    inventory[profile] = await Promise.all(
      names.map(async (name) => {
        const body = await readFile(join(directory, name), "utf8");
        const unsafe = findUnsafeStatements(body);
        if (unsafe.length) throw new Error(`${profile}/${name} contains unapproved ${unsafe.join(", ")}`);

        const computedHash = createHash("sha256").update(body).digest("hex");

        // Verify against baseline registry if available
        if (registryMap) {
          const regRecord = registryMap.get(name);
          if (regRecord) {
            const expectedHash = profile === "dev" ? regRecord.sha256Dev : regRecord.sha256Research;
            if (expectedHash && computedHash !== expectedHash) {
              throw new Error(
                `HISTORICAL_CHECKSUM_MUTATION: Checksum mutation detected for ${profile}/${name}. Expected ${expectedHash}, computed ${computedHash}`,
              );
            }
          }
        }

        return {
          name,
          sha256: computedHash,
          ...canonicalPolicy[name],
          ddlType: /\bALTER\s+TABLE\b/i.test(body)
            ? "ALTER_OR_MIXED"
            : /\bCREATE\s+KEYSPACE\b/i.test(body)
              ? "KEYSPACE"
              : "CREATE_TABLE",
          targetReadCheck: "inspect schema objects, columns/options and relevant population facts",
          rollback: "retain additive schema; roll application/config to named last-known-good artifact",
        };
      }),
    );
  }
  const snapshot = snapshotPath ? JSON.parse(await readFile(snapshotPath, "utf8")) : undefined;
  return {
    stage: "p13.2a-populated-migration-precheck",
    status: "PASS_SOURCE_POLICY",
    networkAccessPerformed: false,
    targetMutationPerformed: false,
    profiles: { dev: inventory.dev.length, research: inventory.research.length },
    filenameParity: true,
    hashParity: inventory.dev.every((item, index) => item.sha256 === inventory.research[index].sha256),
    migrationHistory: "NO_NATIVE_HISTORY_TABLE_INFER_FROM_SCHEMA_OBJECTS",
    targetQualification: evaluateTargetSnapshot(snapshot),
    inventory,
  };
}

async function main() {
  const index = process.argv.indexOf("--target-snapshot");
  process.stdout.write(
    `${JSON.stringify(await runPrecheck({ snapshotPath: index >= 0 ? process.argv[index + 1] : undefined }), null, 2)}\n`,
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
