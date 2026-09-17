-- Phase 20B Organization & University Multi-Tenancy
CREATE TABLE IF NOT EXISTS identity_keyspace.organizations_by_id (
  organization_id uuid,
  slug text,
  name text,
  domain text,
  status text,
  created_at timestamp,
  settings_json text,
  PRIMARY KEY (organization_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.organization_memberships_by_user (
  user_id uuid,
  organization_id uuid,
  role text,
  department text,
  status text,
  joined_at timestamp,
  PRIMARY KEY ((user_id), organization_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.organization_members_by_org (
  organization_id uuid,
  role text,
  user_id uuid,
  joined_at timestamp,
  PRIMARY KEY ((organization_id), role, user_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.institutional_sso_config (
  organization_id uuid,
  provider_type text,
  issuer_url text,
  client_id text,
  encrypted_secret text,
  allowed_domains list<text>,
  created_at timestamp,
  PRIMARY KEY (organization_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
