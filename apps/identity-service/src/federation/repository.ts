import { randomUUID } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import { maskEmail } from "../registration/model.js";
import type { LoginSession } from "../login/model.js";

const LQ = "LOCAL_QUORUM" as const, LS = "LOCAL_SERIAL" as const;
const uuid = (value: string) => types.Uuid.fromString(value);

export interface FederationTransaction {
  readonly state: string; readonly protocol: "SAML" | "LTI"; readonly organizationId: string;
  readonly issuer: string; readonly clientId?: string; readonly deploymentId?: string;
  readonly nonce?: string; readonly requestId?: string; readonly targetLinkUri?: string;
  readonly expiresAt: Date;
}
export interface LtiDeployment {
  readonly organizationId: string; readonly issuer: string; readonly clientId: string;
  readonly deploymentId: string; readonly authLoginUrl: string; readonly jwksUrl: string;
  readonly status: "ACTIVE" | "SUSPENDED";
}
export interface SamlConfiguration {
  readonly organizationId: string; readonly entityId: string; readonly ssoUrl: string;
  readonly certificate: string; readonly secondaryCertificates: readonly string[];
}
export interface FederatedUser {
  readonly userId: string; readonly role: string; readonly tokenVersion: number;
  readonly displayName: string; readonly emailMasked: string;
}

export class FederationRepository {
  public constructor(private readonly db: CassandraClient) {}

  async ltiDeployment(issuer: string, clientId: string, deploymentId: string): Promise<LtiDeployment | undefined> {
    const row = (await this.db.execute(
      `SELECT organization_id,issuer,client_id,deployment_id,auth_login_url,jwks_url,status FROM lti_deployment_by_issuer WHERE issuer=? AND client_id=? AND deployment_id=?`,
      [issuer, clientId, deploymentId], LQ,
    ))[0];
    return row ? {
      organizationId: String(row.organization_id), issuer: String(row.issuer), clientId: String(row.client_id),
      deploymentId: String(row.deployment_id), authLoginUrl: String(row.auth_login_url),
      jwksUrl: String(row.jwks_url), status: String(row.status) as LtiDeployment["status"],
    } : undefined;
  }

  async samlConfiguration(organizationId: string): Promise<SamlConfiguration | undefined> {
    const row = (await this.db.execute(
      `SELECT organization_id,issuer_url,client_id,sso_url,idp_certificate,secondary_certificates,provider_type FROM institutional_sso_config WHERE organization_id=?`,
      [uuid(organizationId)], LQ,
    ))[0];
    if (!row || String(row.provider_type) !== "SAML" || !row.sso_url || !row.idp_certificate) return undefined;
    return { organizationId, entityId: String(row.issuer_url), ssoUrl: String(row.sso_url),
      certificate: String(row.idp_certificate), secondaryCertificates: Array.isArray(row.secondary_certificates)
        ? row.secondary_certificates.map(String) : [] };
  }

  async createTransaction(value: FederationTransaction): Promise<void> {
    const ttl = Math.max(1, Math.ceil((value.expiresAt.getTime() - Date.now()) / 1000));
    const rows = await this.db.execute(
      `INSERT INTO federation_transaction_by_state (state,protocol,organization_id,issuer,client_id,deployment_id,nonce,request_id,target_link_uri,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS USING TTL ?`,
      [value.state, value.protocol, uuid(value.organizationId), value.issuer, value.clientId ?? null,
        value.deploymentId ?? null, value.nonce ?? null, value.requestId ?? null, value.targetLinkUri ?? null,
        new Date(), value.expiresAt, ttl], LQ, LS,
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("FEDERATION_STATE_COLLISION");
  }

  async consumeTransaction(state: string, protocol: FederationTransaction["protocol"]): Promise<FederationTransaction | undefined> {
    const row = (await this.db.execute(
      `SELECT state,protocol,organization_id,issuer,client_id,deployment_id,nonce,request_id,target_link_uri,expires_at,consumed_at FROM federation_transaction_by_state WHERE state=?`,
      [state], LQ,
    ))[0];
    if (!row) return undefined;
    const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at));
    if (String(row.protocol) !== protocol || row.consumed_at || expiresAt.getTime() <= Date.now()) return undefined;
    const consumed = await this.db.execute(
      `UPDATE federation_transaction_by_state SET consumed_at=? WHERE state=? IF consumed_at=null`,
      [new Date(), state], LQ, LS,
    );
    if (consumed[0]?.["[applied]"] !== true) return undefined;
    return { state, protocol, organizationId: String(row.organization_id), issuer: String(row.issuer),
      ...(row.client_id ? { clientId: String(row.client_id) } : {}),
      ...(row.deployment_id ? { deploymentId: String(row.deployment_id) } : {}),
      ...(row.nonce ? { nonce: String(row.nonce) } : {}), ...(row.request_id ? { requestId: String(row.request_id) } : {}),
      ...(row.target_link_uri ? { targetLinkUri: String(row.target_link_uri) } : {}), expiresAt };
  }

  async consumeSamlReplay(tenantId: string, assertionId: string, issuer: string, expiresAt: Date): Promise<boolean> {
    const ttl = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
    const rows = await this.db.execute(
      `INSERT INTO system_saml_replays (tenant_id,assertion_id,idp_issuer,issued_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?) IF NOT EXISTS USING TTL ?`,
      [tenantId, assertionId, issuer, new Date(), expiresAt, new Date(), ttl], LQ, LS,
    );
    return rows[0]?.["[applied]"] === true;
  }

  async resolveUser(input: { protocol: "SAML" | "LTI"; issuer: string; subject: string; email: string; displayName: string; organizationId: string; role: string }): Promise<FederatedUser> {
    const existing = (await this.db.execute(
      `SELECT user_id FROM federated_identity_by_subject WHERE protocol=? AND issuer=? AND subject=?`,
      [input.protocol, input.issuer, input.subject], LQ,
    ))[0];
    let userId = existing ? String(existing.user_id) : undefined;
    if (!userId) {
      const credential = (await this.db.execute(`SELECT user_id FROM credential_by_email WHERE normalized_email=?`, [input.email], LQ))[0];
      const proposed = credential ? String(credential.user_id) : randomUUID();
      const claimed = await this.db.execute(
        `INSERT INTO federated_identity_by_subject (protocol,issuer,subject,user_id,email,organization_id,created_at,last_login_at) VALUES (?,?,?,?,?,?,?,?) IF NOT EXISTS`,
        [input.protocol, input.issuer, input.subject, uuid(proposed), input.email, uuid(input.organizationId), new Date(), new Date()], LQ, LS,
      );
      userId = claimed[0]?.["[applied]"] === true ? proposed : String(claimed[0]?.user_id);
      if (!credential && userId === proposed) {
        await this.db.execute(
          `INSERT INTO user_by_id (user_id,email_masked,display_name,role,status,lecturer_verified,token_version,profile_version,normalized_email,credential_version,created_at,updated_at) VALUES (?,?,?,?,'ACTIVE',false,1,1,?,0,?,?) IF NOT EXISTS`,
          [uuid(userId), maskEmail(input.email), input.displayName, input.role, input.email, new Date(), new Date()], LQ, LS,
        );
      }
    }
    const user = (await this.db.execute(
      `SELECT user_id,email_masked,display_name,role,status,token_version FROM user_by_id WHERE user_id=?`, [uuid(userId)], LQ,
    ))[0];
    if (!user || String(user.status) !== "ACTIVE") throw new Error("FEDERATED_ACCOUNT_DENIED");
    await this.db.execute(`UPDATE federated_identity_by_subject SET last_login_at=? WHERE protocol=? AND issuer=? AND subject=?`,
      [new Date(), input.protocol, input.issuer, input.subject], LQ);
    return { userId, emailMasked: String(user.email_masked), displayName: String(user.display_name),
      role: String(user.role), tokenVersion: Number(user.token_version) };
  }

  async insertSession(session: LoginSession): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO session_by_id (session_id,user_id,token_family_id,refresh_fingerprint,generation,state,expires_at,revoked_at,version,auth_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [uuid(session.sessionId), uuid(session.userId), uuid(session.tokenFamilyId), session.refreshFingerprint, session.generation,
        session.state, session.expiresAt, null, types.Long.fromNumber(session.version), session.authVersion, session.createdAt], LQ, LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
}
