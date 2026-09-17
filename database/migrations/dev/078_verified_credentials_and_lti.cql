-- Phase 20D & 20E Educational Interoperability, LTI and Verified Credentials
CREATE TABLE IF NOT EXISTS learning_keyspace.verified_certificates_by_id (
  certificate_id uuid,
  student_id uuid,
  course_id uuid,
  course_version int,
  organization_id uuid,
  issued_at timestamp,
  completion_percent int,
  grade text,
  status text,
  revoked_at timestamp,
  revoked_by uuid,
  revocation_reason text,
  signature text,
  PRIMARY KEY (certificate_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.certificates_by_student_course (
  student_id uuid,
  course_id uuid,
  certificate_id uuid,
  issued_at timestamp,
  PRIMARY KEY ((student_id), course_id, certificate_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.lti_deployments_by_org (
  organization_id uuid,
  deployment_id text,
  client_id text,
  issuer text,
  auth_login_url text,
  auth_token_url text,
  jwks_url text,
  status text,
  created_at timestamp,
  PRIMARY KEY ((organization_id), deployment_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
