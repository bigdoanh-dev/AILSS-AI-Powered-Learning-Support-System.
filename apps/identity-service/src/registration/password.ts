import { Algorithm, Version, hash, verify } from "@node-rs/argon2";

export const ARGON2ID_PROFILE = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_PROFILE);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(canonicalizeLegacyPhcEncoding(passwordHash), password);
}

function canonicalizeLegacyPhcEncoding(passwordHash: string): string {
  // P7.1 emitted valid Argon2id parameters but encoded salt/tag with base64url.
  // Canonicalize only that transport alphabet and leave PHC parsing/verification to the library.
  return passwordHash.replaceAll("-", "+").replaceAll("_", "/");
}
