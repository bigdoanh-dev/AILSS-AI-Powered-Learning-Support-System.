-- Production SAML 2.0 and LTI 1.3 runtime state owned by Identity Service.
ALTER TABLE identity_keyspace.institutional_sso_config ADD IF NOT EXISTS sso_url text;
ALTER TABLE identity_keyspace.institutional_sso_config ADD IF NOT EXISTS idp_certificate text;
ALTER TABLE identity_keyspace.institutional_sso_config ADD IF NOT EXISTS secondary_certificates list<text>;
ALTER TABLE identity_keyspace.institutional_sso_config ADD IF NOT EXISTS secret_reference text;

CREATE TABLE IF NOT EXISTS identity_keyspace.lti_deployment_by_issuer (
  issuer text,
  client_id text,
  deployment_id text,
  organization_id uuid,
  auth_login_url text,
  auth_token_url text,
  jwks_url text,
  status text,
  created_at timestamp,
  PRIMARY KEY ((issuer), client_id, deployment_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.federation_transaction_by_state (
  state text PRIMARY KEY,
  protocol text,
  organization_id uuid,
  issuer text,
  client_id text,
  deployment_id text,
  nonce text,
  request_id text,
  target_link_uri text,
  created_at timestamp,
  expires_at timestamp,
  consumed_at timestamp
) WITH default_time_to_live = 900
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'HOURS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS identity_keyspace.system_saml_replays (
  tenant_id text,
  assertion_id text,
  idp_issuer text,
  response_id text,
  issued_at timestamp,
  expires_at timestamp,
  consumed_at timestamp,
  PRIMARY KEY ((tenant_id), assertion_id)
) WITH default_time_to_live = 900
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'HOURS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS identity_keyspace.federated_identity_by_subject (
  protocol text,
  issuer text,
  subject text,
  user_id uuid,
  email text,
  organization_id uuid,
  created_at timestamp,
  last_login_at timestamp,
  PRIMARY KEY ((protocol, issuer), subject)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
