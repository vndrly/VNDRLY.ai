#!/usr/bin/env bash
# Boot local Postgres, the API, and the Vite web app for Cloud Agents.
set -euo pipefail

if [[ -d /usr/local/lib/nodejs/bin ]]; then
  export PATH="/usr/local/lib/nodejs/bin:${PATH}"
fi
if [[ "${NODE_OPTIONS:-}" != *--experimental-strip-types* ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--experimental-strip-types"
fi

cd /workspace

if ! pg_isready -q -h 127.0.0.1 -p 5432; then
  sudo service postgresql start
fi
ready=0
for _ in $(seq 1 30); do
  if pg_isready -q -h 127.0.0.1 -p 5432; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "PostgreSQL did not become ready" >&2
  exit 1
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vndrly') THEN
    CREATE ROLE vndrly LOGIN PASSWORD 'vndrly_local_dev';
  END IF;
END
$$;
ALTER ROLE vndrly WITH LOGIN PASSWORD 'vndrly_local_dev' CREATEDB;
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'vndrly'" | grep -q 1; then
  sudo -u postgres createdb -O vndrly vndrly
fi

cat > /workspace/.env.local <<'EOF'
# Local Cloud Agent database. Not production. Gitignored.
DATABASE_URL=postgresql://vndrly:vndrly_local_dev@127.0.0.1:5432/vndrly
LISTEN_NOTIFY_DATABASE_URL=postgresql://vndrly:vndrly_local_dev@127.0.0.1:5432/vndrly
PORT=8080
BASE_PATH=/
VITE_API_PROXY_TARGET=http://127.0.0.1:8080
SESSION_SECRET=local-dev-session-secret-change-in-production
PUBLIC_APP_URL=http://127.0.0.1:5173
APP_BASE_URL=http://127.0.0.1:5173
EXPO_PUBLIC_DOMAIN=http://127.0.0.1:8080
NODE_ENV=development
# Presence-only placeholder so the API can boot. Ask V calls need a real key.
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com
AI_INTEGRATIONS_ANTHROPIC_API_KEY=local-dev-placeholder
EOF

users_table="$(PGPASSWORD=vndrly_local_dev psql -h 127.0.0.1 -U vndrly -d vndrly -tAc "SELECT to_regclass('public.users')")"
if [[ "$users_table" != "users" ]]; then
  cat > /workspace/lib/db/_push_local.mts <<'EOF'
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { pushSchema } from "drizzle-kit/api";
import * as schema from "./src/schema/index.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1") {
  throw new Error("Refusing to push schema to a non-local database");
}
const pool = new pg.Pool({ connectionString: url, max: 4 });
try {
  const db = drizzle(pool, { schema });
  const { apply, hasDataLoss } = await pushSchema(
    schema as Record<string, unknown>,
    db as unknown as PgDatabase<never>,
  );
  if (hasDataLoss) {
    throw new Error("Refusing to apply schema push that reports data loss");
  }
  await apply();
  console.log("schema applied");
} finally {
  await pool.end();
}
EOF
  node --import /workspace/scripts/load-env-local.mjs \
    /workspace/lib/db/node_modules/tsx/dist/cli.mjs \
    /workspace/lib/db/_push_local.mts
  rm -f /workspace/lib/db/_push_local.mts
fi

TMUX=(tmux)
if [[ -f /exec-daemon/tmux.portal.conf ]]; then
  TMUX=(tmux -f /exec-daemon/tmux.portal.conf)
fi

if ! curl -sf http://127.0.0.1:8080/api/healthz >/dev/null; then
  "${TMUX[@]}" has-session -t "=vndrly-api" 2>/dev/null || \
    "${TMUX[@]}" new-session -d -s vndrly-api -c /workspace -- bash -l
  "${TMUX[@]}" send-keys -t vndrly-api:0.0 \
    'export PATH="/usr/local/lib/nodejs/bin:$PATH"; cd /workspace && corepack pnpm --filter @workspace/api-server run dev:local' C-m
fi

if ! curl -sf http://127.0.0.1:5173/api/healthz >/dev/null; then
  "${TMUX[@]}" has-session -t "=vndrly-web" 2>/dev/null || \
    "${TMUX[@]}" new-session -d -s vndrly-web -c /workspace -- bash -l
  "${TMUX[@]}" send-keys -t vndrly-web:0.0 \
    'export PATH="/usr/local/lib/nodejs/bin:$PATH"; export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--experimental-strip-types"; cd /workspace && corepack pnpm --filter @workspace/vndrly run dev:local' C-m
fi

api_ok=0
web_ok=0
for _ in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8080/api/healthz >/dev/null; then api_ok=1; fi
  if curl -sf http://127.0.0.1:5173/api/healthz >/dev/null; then web_ok=1; fi
  if [[ "$api_ok" -eq 1 && "$web_ok" -eq 1 ]]; then
    break
  fi
  sleep 2
done
if [[ "$api_ok" -ne 1 || "$web_ok" -ne 1 ]]; then
  echo "Dev servers did not become healthy (api=$api_ok web=$web_ok)" >&2
  exit 1
fi

curl -sf -X POST http://127.0.0.1:8080/api/auth/seed >/dev/null
echo "VNDRLY local dev is up: API http://127.0.0.1:8080  web http://127.0.0.1:5173"
