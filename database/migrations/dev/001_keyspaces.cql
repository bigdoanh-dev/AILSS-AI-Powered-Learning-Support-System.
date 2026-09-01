CREATE KEYSPACE IF NOT EXISTS identity_keyspace WITH replication = {'class':'NetworkTopologyStrategy','ailss_dc':1} AND durable_writes = true;

CREATE KEYSPACE IF NOT EXISTS learning_keyspace WITH replication = {'class':'NetworkTopologyStrategy','ailss_dc':1} AND durable_writes = true;

CREATE KEYSPACE IF NOT EXISTS classroom_keyspace WITH replication = {'class':'NetworkTopologyStrategy','ailss_dc':1} AND durable_writes = true;

CREATE KEYSPACE IF NOT EXISTS assessment_keyspace WITH replication = {'class':'NetworkTopologyStrategy','ailss_dc':1} AND durable_writes = true;

CREATE KEYSPACE IF NOT EXISTS interaction_keyspace WITH replication = {'class':'NetworkTopologyStrategy','ailss_dc':1} AND durable_writes = true;

CREATE KEYSPACE IF NOT EXISTS ai_keyspace WITH replication = {'class':'NetworkTopologyStrategy','ailss_dc':1} AND durable_writes = true;

CREATE KEYSPACE IF NOT EXISTS notification_keyspace WITH replication = {'class':'NetworkTopologyStrategy','ailss_dc':1} AND durable_writes = true;

CREATE KEYSPACE IF NOT EXISTS audit_support_keyspace WITH replication = {'class':'NetworkTopologyStrategy','ailss_dc':1} AND durable_writes = true;
