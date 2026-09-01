import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { CanonicalPublicSubject, PublicLecturerProjection } from "./model.js";

const LOCAL_ONE = "LOCAL_ONE" as const;
const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const LOCAL_SERIAL = "LOCAL_SERIAL" as const;
const uuid = (value: string) => types.Uuid.fromString(value);

function text(row: types.Row, name: string): string {
  const value: unknown = row.get(name);
  if (typeof value === "string") return value;
  if (value instanceof types.Uuid) return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function nullableText(row: types.Row, name: string): string | null {
  const value: unknown = row.get(name);
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function numberValue(row: types.Row, name: string): number {
  const value: unknown = row.get(name);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

export class PublicProfileRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async getCanonicalSubject(userId: string): Promise<CanonicalPublicSubject | undefined> {
    // ERRATA-P7-007-01 / Q-IDN-001: canonical public-visibility guard.
    const rows = await this.client.execute(
      `SELECT user_id,display_name,role,status,lecturer_verified,profile_version
       FROM user_by_id WHERE user_id=?`,
      [uuid(userId)],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      userId: text(row, "user_id"),
      displayName: text(row, "display_name"),
      role: text(row, "role"),
      status: text(row, "status"),
      lecturerVerified: Boolean(row.get("lecturer_verified")),
      profileVersion: numberValue(row, "profile_version"),
    };
  }

  public async getProjection(lecturerId: string): Promise<PublicLecturerProjection | undefined> {
    // Q-IDN-006: exact public projection read at the registry candidate consistency.
    const rows = await this.client.execute(
      `SELECT lecturer_id,display_name,bio,avatar_object_key,verified,profile_version,updated_at
       FROM public_lecturer_by_id WHERE lecturer_id=?`,
      [uuid(lecturerId)],
      LOCAL_ONE,
    );
    const row = rows[0];
    if (!row) return undefined;
    const updatedAt: unknown = row.get("updated_at");
    if (!(updatedAt instanceof Date)) throw new Error("INVALID_UPDATED_AT");
    return {
      lecturerId: text(row, "lecturer_id"),
      displayName: text(row, "display_name"),
      bio: nullableText(row, "bio"),
      avatarObjectKey: nullableText(row, "avatar_object_key"),
      verified: Boolean(row.get("verified")),
      profileVersion: numberValue(row, "profile_version"),
      updatedAt,
    };
  }

  public async insertProjectionIfMissing(input: {
    lecturerId: string;
    displayName: string;
    profileVersion: number;
    updatedAt: Date;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `INSERT INTO public_lecturer_by_id
       (lecturer_id,display_name,bio,avatar_object_key,verified,profile_version,updated_at)
       VALUES (?,?,null,null,true,?,?) IF NOT EXISTS`,
      [
        uuid(input.lecturerId),
        input.displayName,
        types.Long.fromNumber(input.profileVersion),
        input.updatedAt,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return Boolean(rows[0]?.get("[applied]"));
  }

  public async advanceProjection(input: {
    lecturerId: string;
    expectedVersion: number;
    displayName: string;
    nextVersion: number;
    updatedAt: Date;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `UPDATE public_lecturer_by_id SET display_name=?,verified=true,profile_version=?,updated_at=?
       WHERE lecturer_id=? IF profile_version=? AND verified=true`,
      [
        input.displayName,
        types.Long.fromNumber(input.nextVersion),
        input.updatedAt,
        uuid(input.lecturerId),
        types.Long.fromNumber(input.expectedVersion),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return Boolean(rows[0]?.get("[applied]"));
  }
}
