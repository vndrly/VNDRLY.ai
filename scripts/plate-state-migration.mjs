const APPROVED_STATEMENTS = [
  'ALTER TABLE "guest_sessions" ADD COLUMN IF NOT EXISTS "plate_state" text',
  'ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "plate_state" text',
];

function normalizeStatement(statement) {
  return statement.trim().replace(/\s+/g, " ");
}

export function parsePlateStateMigration(sqlText) {
  const statements = String(sqlText)
    .split(";")
    .map(normalizeStatement)
    .filter(Boolean);
  if (
    statements.length !== APPROVED_STATEMENTS.length ||
    statements.some(
      (statement, index) => statement !== APPROVED_STATEMENTS[index],
    )
  ) {
    throw new Error(
      "Migration must contain exactly the approved additive plate_state statements in chunk_391",
    );
  }
  return statements;
}

const VERIFICATION_SQL = `
SELECT table_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'plate_state'
  AND table_name IN ('guest_sessions', 'site_visits')
ORDER BY table_name
`;

export async function runPlateStateMigration(client, sqlText) {
  const statements = parsePlateStateMigration(sqlText);
  for (const statement of statements) {
    await client.query(statement);
  }
  const verification = await client.query(VERIFICATION_SQL);
  const expected = [
    { table_name: "guest_sessions", data_type: "text", is_nullable: "YES" },
    { table_name: "site_visits", data_type: "text", is_nullable: "YES" },
  ];
  if (JSON.stringify(verification.rows) !== JSON.stringify(expected)) {
    throw new Error(
      "plate_state preflight failed: both columns must exist as nullable text",
    );
  }
}

export function buildApiMigrationAndRestartCommands() {
  return `database_url="$(sudo sed -n 's/^DATABASE_URL=//p' .env.production | head -n 1)"
if [ -z "$database_url" ]; then
  echo "DATABASE_URL missing from .env.production; refusing API restart" >&2
  exit 1
fi
sudo -u vndrly env HOME=/home/vndrly DATABASE_URL="$database_url" pnpm --filter @workspace/api-server run migrate:plate-state
sudo -u vndrly env HOME=/home/vndrly DATABASE_URL="$database_url" pnpm --filter @workspace/api-server run migrate:notes-admission
sudo -u vndrly env HOME=/home/vndrly DATABASE_URL="$database_url" pnpm --filter @workspace/api-server run migrate:askv-greeting
unset database_url
sudo systemctl daemon-reload
sudo systemctl enable vndrly-api 2>/dev/null || true
sudo systemctl restart vndrly-api`;
}
