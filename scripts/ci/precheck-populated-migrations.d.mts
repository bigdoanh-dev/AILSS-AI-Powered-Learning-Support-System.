export const canonicalPolicy: Record<string, { classification: string; review: string }>;
export function findUnsafeStatements(body: string): string[];
export function evaluateTargetSnapshot(snapshot?: unknown): { status: string; reasons: string[] };
export function runPrecheck(options?: { snapshotPath?: string }): Promise<unknown>;
