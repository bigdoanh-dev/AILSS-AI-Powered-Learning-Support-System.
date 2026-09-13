export function disposition(path, { dirty = false } = {}) {
  if (path === ".env" || path.startsWith("credentials/") || /\.(?:pem|key|p12|jks)$/.test(path))
    return "EXCLUDE_SECRET_NEVER_COMMIT";
  if (path.startsWith("evidence/")) return "EXCLUDE_EVIDENCE";
  if (/^(?:dist|build|tmp|temp|logs|screenshots|output|coverage)(?:\/|$)/.test(path))
    return "EXCLUDE_GENERATED_RUNTIME";
  if (/^(?:infrastructure\/(?:storage|cassandra)\/data)(?:\/|$)/.test(path))
    return "EXCLUDE_GENERATED_RUNTIME";
  const approved = [
    /^(?:apps|packages|contracts|database|scripts|tests|config|docs|infrastructure)\//,
    /^(?:AILSS_P13_|AILSS_PHASE_13_)/,
    /^(?:\.env\.example|\.gitignore|Dockerfile|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.[^.]+)?\.json|eslint\.config\.js|vitest\.config\.ts)$/,
    /^docker-compose(?:\.[^.]+)?\.yml$/,
  ];
  if (!dirty || approved.some((pattern) => pattern.test(path))) return "INCLUDE";
  return "EXCLUDE_UNRELATED";
}
