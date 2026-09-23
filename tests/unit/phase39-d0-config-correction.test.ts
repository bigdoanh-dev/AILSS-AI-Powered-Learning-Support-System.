import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("AILSS Phase 39: D0 Cassandra Configuration Correction & RPO Re-attestation", () => {
  const correctionPath = resolve(process.cwd(), "artifacts/release-evidence/phase39-d0-config-correction.json");
  const topologyPath = resolve(process.cwd(), "artifacts/release-evidence/d0-storage-topology.json");

  it("verifies phase39-d0-config-correction.json exists and conforms to Cassandra batch vs group rules", () => {
    const raw = readFileSync(correctionPath, "utf8");
    const json = JSON.parse(raw);

    expect(json.cassandraConfigurationCorrection.cassandra5SyntaxRule).toContain("commitlog_sync: batch");
    expect(json.cassandraConfigurationCorrection.cassandra5SyntaxRule).toContain("commitlog_sync: group");

    const deployed = json.cassandraConfigurationCorrection.deployedD0Configuration;
    expect(deployed.commitlogSync).toBe("batch");
    expect(deployed.commitlogSyncBatchWindowInMs).toBeNull();
    expect(deployed.commitlogSyncGroupWindowInMs).toBeNull();
    expect(deployed.syncModeSemantics).toBe("IMMEDIATE_FSYNC_BEFORE_ACK_ZERO_WINDOW");

    const batchBench = json.cassandraConfigurationCorrection.comparativeRerunBenchmarks.batchModeZeroWindowDeployed;
    expect(batchBench.windowMs).toBe(0);
    expect(batchBench.processCrashVerification.observedRpoSeconds).toBe(0);
    expect(batchBench.hardPowerLossVerification.observedRpoSeconds).toBe(0);
    expect(batchBench.networkPartitionVerification.observedRpoSeconds).toBe(0);

    const groupBench = json.cassandraConfigurationCorrection.comparativeRerunBenchmarks.groupMode2msWindowEvaluated;
    expect(groupBench.commitlogSync).toBe("group");
    expect(groupBench.commitlogSyncGroupWindowInMs).toBe(2);
    expect(groupBench.processCrashVerification.observedRpoSeconds).toBe(0);
  });

  it("verifies d0-storage-topology.json has no batch window conflation", () => {
    const raw = readFileSync(topologyPath, "utf8");
    const json = JSON.parse(raw);
    const d0Cluster = json.clusters.find((c: { clusterName: string }) => c.clusterName === "ailss-d0-cluster");
    expect(d0Cluster).toBeDefined();
    expect(d0Cluster.nodeLevelCommitLogPolicy.commitlogSync).toBe("batch");
    expect(d0Cluster.nodeLevelCommitLogPolicy.commitlogSyncBatchWindowInMs).toBeNull();
  });

  it("validates precise tiered RPO values", () => {
    const raw = readFileSync(correctionPath, "utf8");
    const json = JSON.parse(raw);
    const rpo = json.rpoSemanticsReconciliation;

    expect(rpo.D0_OBSERVED_RPO).toBe("0s");
    expect(rpo.D1_OBSERVED_RPO).toBe("1.2s");
    expect(rpo.D2_OBSERVED_RPO).toBe("4.0s");
    expect(rpo.WORST_OBSERVED_DURABLE_RPO).toBe("4.0s");
    expect(rpo.PLATFORM_DURABLE_RPO_OBJECTIVE).toBe("<= 5.0s");
    expect(rpo.D3).toBe("LOSS_ACCEPTED_RECONSTRUCTABLE_NO_RPO");
  });
});
