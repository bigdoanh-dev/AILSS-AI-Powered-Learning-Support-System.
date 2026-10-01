export function synchronizeCassandraRoles(
  roles: string,
  execute: (cql: string) => unknown,
  wait?: (milliseconds: number) => Promise<unknown>,
): Promise<void>;
