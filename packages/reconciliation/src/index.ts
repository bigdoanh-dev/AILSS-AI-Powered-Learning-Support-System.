export interface DueCursor {
  readonly dueDay: string;
  readonly shard: number;
  readonly pagingState?: string;
}
export interface ReconcileOperation {
  readonly operationId: string;
  readonly projectionName: string;
  readonly canonicalId: string;
  readonly expectedVersion: number;
  readonly projectionVersion: number;
  readonly expectedChecksum: string;
  readonly projectionChecksum: string;
  readonly attempt: number;
}
export type RepairDecision =
  "NO_DRIFT" | "REPAIR_VERSION_GAP" | "REPAIR_CHECKSUM_DRIFT" | "RETRY_OWNER_UNAVAILABLE" | "TERMINAL";

export function decideRepair(
  operation: ReconcileOperation,
  ownerAvailable: boolean,
  maxAttempts: number,
): RepairDecision {
  if (!ownerAvailable) return operation.attempt >= maxAttempts ? "TERMINAL" : "RETRY_OWNER_UNAVAILABLE";
  if (operation.projectionVersion < operation.expectedVersion) return "REPAIR_VERSION_GAP";
  if (
    operation.projectionVersion === operation.expectedVersion &&
    operation.projectionChecksum !== operation.expectedChecksum
  )
    return "REPAIR_CHECKSUM_DRIFT";
  return "NO_DRIFT";
}

export function validateDueScan(input: { shard: number; shardCount: number; pageSize: number }): void {
  if (!Number.isInteger(input.shard) || input.shard < 0 || input.shard >= input.shardCount)
    throw new Error("INVALID_RECONCILE_SHARD");
  if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 200)
    throw new Error("UNBOUNDED_RECONCILE_PAGE");
}

export interface OwnerApi {
  getCanonicalProjection(
    operation: ReconcileOperation,
    signal: AbortSignal,
  ): Promise<{ version: number; checksum: string; repairPayload?: unknown }>;
}

export async function inspectThroughOwnerApi(
  operation: ReconcileOperation,
  owner: OwnerApi,
  timeoutMs = 2_000,
): Promise<RepairDecision> {
  try {
    const canonical = await owner.getCanonicalProjection(operation, AbortSignal.timeout(timeoutMs));
    return decideRepair(
      { ...operation, expectedVersion: canonical.version, expectedChecksum: canonical.checksum },
      true,
      8,
    );
  } catch {
    return decideRepair(operation, false, 8);
  }
}
