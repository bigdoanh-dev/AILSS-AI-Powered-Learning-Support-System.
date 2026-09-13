import { describe, expect, it } from "vitest";
import {
  canonicalPolicy,
  evaluateTargetSnapshot,
  findUnsafeStatements,
  runPrecheck,
} from "../../scripts/ci/precheck-populated-migrations.mjs";

const safeSnapshot = {
  schemaAgreement: true,
  cassandraVersion: "synthetic-version",
  datacenters: ["synthetic-dc"],
  replication: { strategy: "NetworkTopologyStrategy", approved: true, factors: { "synthetic-dc": 3 } },
  observedTables: ["synthetic.table"],
  observedColumns: { "synthetic.table": ["id"] },
  tableOptions: { "synthetic.table": { defaultTimeToLive: 0 } },
  diskFreeBytes: 1,
  capacityApproved: true,
  populationFacts: {
    reviewedMigrations: { "013": true, "024": true, "026": true, "033": true, "052": true, "076": true },
  },
};

describe("populated migration precheck", () => {
  it("has an exact explicit 34-file policy covering both profiles", async () => {
    expect(Object.keys(canonicalPolicy)).toHaveLength(34);
    const result = (await runPrecheck()) as {
      status: string;
      networkAccessPerformed: boolean;
      targetMutationPerformed: boolean;
      profiles: { dev: number; research: number };
      targetQualification: { status: string };
    };
    expect(result).toMatchObject({
      status: "PASS_SOURCE_POLICY",
      networkAccessPerformed: false,
      targetMutationPerformed: false,
      profiles: { dev: 34, research: 34 },
      targetQualification: { status: "BLOCKED_EXTERNAL" },
    });
  });

  it.each([
    "DROP TABLE x",
    "TRUNCATE x",
    "DELETE FROM x",
    "INSERT INTO x",
    "UPDATE x SET y=1",
    "BEGIN BATCH",
  ])("rejects unsafe statement %s", (statement) =>
    expect(findUnsafeStatements(statement)).not.toHaveLength(0),
  );

  it("classifies the backfill and table-option migrations explicitly", () => {
    expect(canonicalPolicy["013_profile_avatar.cql"]?.classification).toBe(
      "BACKFILL_OR_RECONCILIATION_REVIEW",
    );
    expect(canonicalPolicy["024_learning_entitlement_commerce.cql"]?.classification).toBe(
      "BACKFILL_OR_RECONCILIATION_REVIEW",
    );
    expect(canonicalPolicy["026_learning_sepay.cql"]?.classification).toBe(
      "BACKFILL_OR_RECONCILIATION_REVIEW",
    );
    expect(canonicalPolicy["033_classroom_student_schedule.cql"]?.classification).toBe("TABLE_OPTION_CHANGE");
    expect(canonicalPolicy["052_interaction_reviews.cql"]?.classification).toBe(
      "BACKFILL_OR_RECONCILIATION_REVIEW",
    );
    expect(canonicalPolicy["076_learning_sepay_recovery.cql"]?.classification).toBe(
      "BACKFILL_OR_RECONCILIATION_REVIEW",
    );
  });

  it("blocks incomplete or secret-bearing target snapshots", () => {
    expect(evaluateTargetSnapshot({ schemaAgreement: true }).status).toBe("BLOCKED_EXTERNAL");
    expect(evaluateTargetSnapshot({ ...safeSnapshot, password: "must-not-be-accepted" }).status).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(evaluateTargetSnapshot({ ...safeSnapshot, apiKey: "must-not-be-accepted" }).status).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(evaluateTargetSnapshot({ ...safeSnapshot, observedColumns: undefined }).status).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(
      evaluateTargetSnapshot({ ...safeSnapshot, replication: { strategy: "NetworkTopologyStrategy" } })
        .status,
    ).toBe("BLOCKED_EXTERNAL");
    expect(
      evaluateTargetSnapshot({
        ...safeSnapshot,
        replication: { strategy: "NetworkTopologyStrategy", approved: true, factors: {} },
      }).status,
    ).toBe("BLOCKED_EXTERNAL");
    expect(
      evaluateTargetSnapshot({ ...safeSnapshot, datacenters: ["synthetic-dc", "second-dc"] }).status,
    ).toBe("BLOCKED_EXTERNAL");
    expect(evaluateTargetSnapshot({ ...safeSnapshot, observedColumns: {} }).status).toBe("BLOCKED_EXTERNAL");
    expect(evaluateTargetSnapshot({ ...safeSnapshot, tableOptions: {} }).status).toBe("BLOCKED_EXTERNAL");
    expect(evaluateTargetSnapshot({ ...safeSnapshot, populationFacts: {} }).status).toBe("BLOCKED_EXTERNAL");
  });

  it("keeps the committed placeholder snapshot blocked", async () => {
    const result = (await runPrecheck({
      snapshotPath: "config/production-target-snapshot.example.json",
    })) as {
      targetQualification: { status: string };
    };
    expect(result.targetQualification.status).toBe("BLOCKED_EXTERNAL");
  });

  it("qualifies a complete synthetic read-only snapshot", () => {
    expect(evaluateTargetSnapshot(safeSnapshot)).toEqual({ status: "QUALIFIED_READ_ONLY", reasons: [] });
  });
});
