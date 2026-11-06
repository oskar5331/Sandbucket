#!/usr/bin/env bash
# One-shot Postgres role setup (compose service `db-init`), the database-side twin of
# garage-init.mjs. Idempotent: safe on every `docker compose up`, and a changed password
# in .env takes effect on the next run. Exits non-zero on any failure, so nothing that
# waits for it starts against a half-configured database.
#
# Creates the two roles of prd.md §19 and hands the database to the owner:
#   - the owner role (DATABASE_OWNER_URL) owns the database and its `public` schema;
#     it runs Prisma Migrate and backs lib/db/unsafe.ts. As table owner it bypasses RLS.
#   - the app role (DATABASE_URL) may connect and use the schema, nothing more. Table
#     grants are written per table in each migration (plan D6), never as defaults.
# Role names, passwords and the database name are read from those two URLs, so each is
# stated once. With DB_INIT_DEV_DATABASES=true it also prepares `<database>_test` for the
# integration tests and `<database>_shadow` for `prisma migrate dev`, which the owner role
# cannot create itself (no CREATEDB). Dev container and CI only; self-host leaves it unset.
#
# Runs with psql: inside the pinned postgres image under Compose, or the dev container's
# client (`pnpm db:init`).
set -euo pipefail

die() { echo "db-init: $*" >&2; exit 1; }

for name in POSTGRES_PASSWORD DATABASE_URL DATABASE_OWNER_URL; do
  [ -n "${!name:-}" ] || die "$name is not set"
done

# postgres://user:password@host[:port]/database[?params]. Percent-encoded values are
# refused rather than decoded: generate URL-safe secrets (openssl rand -hex 32).
url_re='^postgres(ql)?://([A-Za-z0-9._~-]+):([A-Za-z0-9._~-]+)@([A-Za-z0-9.-]+)(:([0-9]+))?/([A-Za-z0-9_]+)(\?.*)?$'
parse() {
  [[ ${!1} =~ $url_re ]] || die "$1 must look like postgres://user:password@host:port/database, with only URL-safe characters (A-Z a-z 0-9 . _ ~ -)"
  user=${BASH_REMATCH[2]} password=${BASH_REMATCH[3]} host=${BASH_REMATCH[4]}
  port=${BASH_REMATCH[6]:-5432} database=${BASH_REMATCH[7]}
  # Only `public` is handed to the owner and granted to the app role below, so a URL
  # pointing Prisma at another schema is refused here instead of failing at runtime.
  local query=${BASH_REMATCH[8]} schema_re='[?&]schema=([^&]*)'
  if [[ $query =~ $schema_re ]] && [ "${BASH_REMATCH[1]}" != "public" ]; then
    die "$1 sets schema=${BASH_REMATCH[1]}; db-init prepares only the public schema"
  fi
}

parse DATABASE_OWNER_URL
owner_role=$user owner_password=$password db_host=$host db_port=$port db_name=$database
parse DATABASE_URL
app_role=$user app_password=$password
[ "$host:$port/$database" = "$db_host:$db_port/$db_name" ] \
  || die "DATABASE_URL and DATABASE_OWNER_URL must name the same server and database"
[ "$app_role" != "$owner_role" ] || die "DATABASE_URL and DATABASE_OWNER_URL must use different roles"

export PGHOST=$db_host PGPORT=$db_port PGUSER=${POSTGRES_USER:-postgres} PGPASSWORD=$POSTGRES_PASSWORD

for attempt in $(seq 1 60); do
  pg_isready -q -d postgres && break
  [ "$attempt" -lt 60 ] || die "Postgres at $db_host:$db_port did not answer within 60 s"
  sleep 1
done

sql() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# Roles. NOINHERIT and the explicit NO* attributes keep both roles exactly as §19 says,
# even if one was created by hand with other attributes. The passwords reach psql through
# its environment (\getenv), never its argv, which any process can read with `ps`; and
# statement logging is off for this session so ALTER ROLE ... PASSWORD stays out of the log.
DB_INIT_OWNER_PW=$owner_password DB_INIT_APP_PW=$app_password \
  sql -d postgres -v owner="$owner_role" -v app="$app_role" <<'SQL'
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
\getenv owner_pw DB_INIT_OWNER_PW
\getenv app_pw DB_INIT_APP_PW
SELECT format('CREATE ROLE %I', :'owner') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I', :'app') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app') \gexec
ALTER ROLE :"owner" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'owner_pw';
ALTER ROLE :"app" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'app_pw';
SQL

databases=("$db_name")
[ "${DB_INIT_DEV_DATABASES:-}" != "true" ] || databases+=("${db_name}_test" "${db_name}_shadow")

for db in "${databases[@]}"; do
  sql -d postgres -v db="$db" -v owner="$owner_role" -v app="$app_role" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec
ALTER DATABASE :"db" OWNER TO :"owner";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app";
SQL
  # Owned explicitly rather than through pg_database_owner, whose implicit membership a
  # NOINHERIT role would not use without SET ROLE.
  sql -d "$db" -v owner="$owner_role" -v app="$app_role" <<'SQL'
ALTER SCHEMA public OWNER TO :"owner";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
SQL
  echo "db-init: $db ready (owner $owner_role, app $app_role)"
done
