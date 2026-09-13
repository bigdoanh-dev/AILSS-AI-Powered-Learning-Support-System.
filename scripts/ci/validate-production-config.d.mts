export const requiredSecrets: readonly string[];
export function parseEnv(text: string): Record<string, string>;
export function validateProductionConfig(
  values: Record<string, string>,
  mode?: "fixture" | "runtime",
): string[];
