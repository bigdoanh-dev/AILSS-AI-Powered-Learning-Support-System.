#!/usr/bin/env python3
"""Apply the small, version-locked Cassandra 5.0 configuration delta for AILSS."""

from __future__ import annotations

import os
import pathlib
import re


CONFIG = pathlib.Path("/etc/cassandra/cassandra.yaml")


def replace_top_level(text: str, key: str, value: str) -> str:
    pattern = rf"(?m)^{re.escape(key)}:\s*.*$"
    updated, count = re.subn(pattern, f"{key}: {value}", text, count=1)
    if count != 1:
        raise RuntimeError(f"Expected exactly one top-level {key} entry, found {count}")
    return updated


def replace_section(text: str, section: str, body: str) -> str:
    pattern = rf"(?ms)^{re.escape(section)}:\s*\n.*?(?=^[A-Za-z_][A-Za-z0-9_]*:|\Z)"
    replacement = f"{section}:\n{body.rstrip()}\n"
    updated, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {section} section, found {count}")
    return updated


def main() -> None:
    text = CONFIG.read_text(encoding="utf-8")
    text = replace_top_level(text, "authenticator", "PasswordAuthenticator")
    text = replace_top_level(text, "authorizer", "CassandraAuthorizer")

    audit_enabled = os.getenv("AILSS_CASSANDRA_AUDIT", "false").lower() == "true"
    audit = f"""  enabled: {'true' if audit_enabled else 'false'}
  logger:
    - class_name: BinAuditLogger
  audit_logs_dir: /var/log/cassandra/audit
  excluded_keyspaces: system,system_schema,system_virtual_schema
  roll_cycle: HOURLY
  block: true
  max_queue_weight: 268435456
  max_log_size: 17179869184
  max_archive_retries: 10"""
    text = replace_section(text, "audit_logging_options", audit)

    tls_enabled = os.getenv("AILSS_CASSANDRA_TLS", "false").lower() == "true"
    if tls_enabled:
        pem_factory = """    class_name: org.apache.cassandra.security.PEMBasedSslContextFactory"""
        server = f"""  internode_encryption: all
  legacy_ssl_storage_port_enabled: false
  ssl_context_factory:
{pem_factory}
  keystore: /opt/ailss/tls/cassandra/server-keystore.pem
  truststore: /opt/ailss/tls/ca/ca-cert.pem
  require_client_auth: true
  require_endpoint_verification: false"""
        client = f"""  enabled: true
  optional: false
  ssl_context_factory:
{pem_factory}
  keystore: /opt/ailss/tls/cassandra/server-keystore.pem
  truststore: /opt/ailss/tls/ca/ca-cert.pem
  require_client_auth: false"""
        text = replace_section(text, "server_encryption_options", server)
        text = replace_section(text, "client_encryption_options", client)

    CONFIG.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
