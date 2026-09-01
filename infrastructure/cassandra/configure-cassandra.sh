#!/usr/bin/env bash
set -euo pipefail

python3 /opt/ailss/configure-cassandra.py
exec /usr/local/bin/docker-entrypoint.sh cassandra -f
