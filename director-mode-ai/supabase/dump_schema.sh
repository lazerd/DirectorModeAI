#!/usr/bin/env bash
#
# Dumps the live production schema (DDL only, no data) from the Supabase
# database to stdout. Use this when you need an authoritative schema file
# instead of trusting the stale legacy_schema_stale.sql.
#
# Usage:
#   export DATABASE_URL='postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres'
#   ./dump_schema.sh > current_schema.sql
#
# Get the connection string from Supabase Dashboard → Settings → Database →
# Connection string → URI. Use the "Direct connection" string, not the pooler.
#
# Requires pg_dump (comes with the postgresql-client package).

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL environment variable is not set." >&2
  echo "" >&2
  echo "Get it from Supabase Dashboard → Settings → Database → Connection string → URI" >&2
  echo "Then run: export DATABASE_URL='postgresql://...'" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found. Install the postgresql-client package." >&2
  echo "  macOS:  brew install libpq && brew link --force libpq" >&2
  echo "  Ubuntu: sudo apt-get install postgresql-client" >&2
  echo "  Win:    download from https://www.postgresql.org/download/windows/" >&2
  exit 1
fi

pg_dump \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  --no-publications \
  --no-subscriptions \
  "$DATABASE_URL"
