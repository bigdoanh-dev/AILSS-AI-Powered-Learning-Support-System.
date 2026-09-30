CREATE TABLE IF NOT EXISTS learning_keyspace.commission_policy_by_effective_at (
  policy_name text,
  effective_at timestamp,
  basis_points int,
  updated_by uuid,
  PRIMARY KEY ((policy_name), effective_at)
) WITH CLUSTERING ORDER BY (effective_at DESC);
