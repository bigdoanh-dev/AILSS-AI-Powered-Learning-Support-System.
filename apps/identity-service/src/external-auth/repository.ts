import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import { maskEmail } from "../registration/model.js";
import { identitySearchShard } from "../admin/model.js";
import type { ExternalIdentityRecord, SocialProvider, UserLinkedProvider } from "./model.js";

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const uuid = (value: string) => types.Uuid.fromString(value);

export interface CreateSocialUserInput {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly provider: SocialProvider;
  readonly providerSubject: string;
  readonly profileSnapshot?: string;
  readonly now: Date;
}

export interface StoredUser {
  readonly userId: string;
  readonly emailMasked: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: string;
  readonly lecturerVerified: boolean;
  readonly tokenVersion: number;
  readonly profileVersion: number;
  readonly normalizedEmail?: string;
  readonly credentialVersion?: number;
}

export class IdentityExternalAuthRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async findExternalIdentity(
    provider: SocialProvider,
    providerSubject: string,
  ): Promise<ExternalIdentityRecord | null> {
    const rows = await this.client.execute(
      `SELECT provider, provider_subject, user_id, email_at_link_time, profile_snapshot, created_at, last_login_at
       FROM external_identity_by_provider_subject
       WHERE provider = ? AND provider_subject = ?`,
      [provider, providerSubject],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return null;

    const createdAtVal: unknown = row.get("created_at");
    const lastLoginAtVal: unknown = row.get("last_login_at");
    const profileVal: unknown = row.get("profile_snapshot");

    return {
      provider: row.get("provider") as SocialProvider,
      providerSubject: String(row.get("provider_subject")),
      userId: String(row.get("user_id")),
      emailAtLinkTime: String(row.get("email_at_link_time")),
      ...(typeof profileVal === "string" ? { profileSnapshot: profileVal } : {}),
      createdAt: createdAtVal instanceof Date ? createdAtVal : new Date(String(createdAtVal)),
      lastLoginAt: lastLoginAtVal instanceof Date ? lastLoginAtVal : new Date(String(lastLoginAtVal)),
    };
  }

  public async findExternalIdentitiesByUser(userId: string): Promise<UserLinkedProvider[]> {
    const rows = await this.client.execute(
      `SELECT provider, provider_subject, email_at_link_time, linked_at
       FROM external_identities_by_user
       WHERE user_id = ?`,
      [uuid(userId)],
      LOCAL_QUORUM,
    );

    return rows.map((r) => {
      const linkedAtVal: unknown = r.get("linked_at");
      return {
        provider: r.get("provider") as SocialProvider,
        providerSubject: String(r.get("provider_subject")),
        emailAtLinkTime: String(r.get("email_at_link_time")),
        linkedAt: linkedAtVal instanceof Date ? linkedAtVal : new Date(String(linkedAtVal)),
      };
    });
  }

  public async findCredentialByEmail(
    normalizedEmail: string,
  ): Promise<{ userId: string; status: string } | null> {
    const rows = await this.client.execute(
      `SELECT user_id, status FROM credential_by_email WHERE normalized_email = ?`,
      [normalizedEmail],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      userId: String(row.get("user_id")),
      status: String(row.get("status")),
    };
  }

  public async findUserById(userId: string): Promise<StoredUser | null> {
    const rows = await this.client.execute(
      `SELECT user_id, email_masked, display_name, role, status, lecturer_verified, token_version, profile_version, normalized_email, credential_version
       FROM user_by_id WHERE user_id = ?`,
      [uuid(userId)],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return null;

    const credVer: unknown = row.get("credential_version");
    const normEmail: unknown = row.get("normalized_email");

    return {
      userId: String(row.get("user_id")),
      emailMasked: String(row.get("email_masked")),
      displayName: String(row.get("display_name")),
      role: String(row.get("role")),
      status: String(row.get("status")),
      lecturerVerified: Boolean(row.get("lecturer_verified")),
      tokenVersion: Number(row.get("token_version")),
      profileVersion: Number(row.get("profile_version")),
      ...(typeof normEmail === "string" ? { normalizedEmail: normEmail } : {}),
      ...(credVer !== null && credVer !== undefined ? { credentialVersion: Number(credVer) } : {}),
    };
  }

  public async updateLastLogin(provider: SocialProvider, providerSubject: string, now: Date): Promise<void> {
    await this.client.execute(
      `UPDATE external_identity_by_provider_subject
       SET last_login_at = ?
       WHERE provider = ? AND provider_subject = ?`,
      [now, provider, providerSubject],
      LOCAL_QUORUM,
    );
  }

  public async createSocialUser(input: CreateSocialUserInput): Promise<StoredUser> {
    const uid = uuid(input.userId);
    const shard = identitySearchShard(input.userId);
    const masked = maskEmail(input.email);

    // 1. Insert user
    await this.client.execute(
      `INSERT INTO user_by_id (
         user_id, email_masked, display_name, role, status, lecturer_verified,
         token_version, profile_version, normalized_email, credential_version,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'STUDENT', 'ACTIVE', false, 1, 1, ?, 0, ?, ?)`,
      [uid, masked, input.displayName, input.email, input.now, input.now],
      LOCAL_QUORUM,
    );

    // 2. Shard index
    await this.client.execute(
      `INSERT INTO users_by_role_status_bucket
       (role, status, shard, updated_at, user_id, display_name, lecturer_verified, profile_version)
       VALUES ('STUDENT', 'ACTIVE', ?, ?, ?, ?, false, ?)`,
      [shard, input.now, uid, input.displayName, types.Long.fromNumber(1)],
      LOCAL_QUORUM,
    );

    // 3. Link external identity
    await this.linkExternalIdentity(
      input.userId,
      input.provider,
      input.providerSubject,
      input.email,
      input.profileSnapshot,
      input.now,
    );

    return {
      userId: input.userId,
      emailMasked: masked,
      displayName: input.displayName,
      role: "STUDENT",
      status: "ACTIVE",
      lecturerVerified: false,
      tokenVersion: 1,
      profileVersion: 1,
      normalizedEmail: input.email,
      credentialVersion: 0,
    };
  }

  public async linkExternalIdentity(
    userId: string,
    provider: SocialProvider,
    providerSubject: string,
    email: string,
    profileSnapshot?: string,
    now = new Date(),
  ): Promise<void> {
    const uid = uuid(userId);

    // Insert external_identity_by_provider_subject
    await this.client.execute(
      `INSERT INTO external_identity_by_provider_subject (
         provider, provider_subject, user_id, email_at_link_time, profile_snapshot, created_at, last_login_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [provider, providerSubject, uid, email, profileSnapshot ?? null, now, now],
      LOCAL_QUORUM,
    );

    // Insert external_identities_by_user
    await this.client.execute(
      `INSERT INTO external_identities_by_user (
         user_id, provider, provider_subject, email_at_link_time, linked_at
       ) VALUES (?, ?, ?, ?, ?)`,
      [uid, provider, providerSubject, email, now],
      LOCAL_QUORUM,
    );
  }

  public async unlinkExternalIdentity(
    userId: string,
    provider: SocialProvider,
    providerSubject: string,
  ): Promise<void> {
    const uid = uuid(userId);

    // Remove from external_identity_by_provider_subject
    await this.client.execute(
      `DELETE FROM external_identity_by_provider_subject
       WHERE provider = ? AND provider_subject = ?`,
      [provider, providerSubject],
      LOCAL_QUORUM,
    );

    // Remove from external_identities_by_user
    await this.client.execute(
      `DELETE FROM external_identities_by_user
       WHERE user_id = ? AND provider = ?`,
      [uid, provider],
      LOCAL_QUORUM,
    );
  }
}
