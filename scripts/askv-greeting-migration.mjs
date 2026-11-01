const APPROVED_STATEMENTS = [
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "askv_last_full_greeting_on" text',
];

function normalizeStatement(statement) {
  return statement.trim().replace(/\s+/g, " ");
}

export function parseAskVGreetingMigration(sqlText) {
  const statements = String(sqlText)
    .split(";")
    .map(normalizeStatement)
    .filter(Boolean);
  if (
    statements.length !== APPROVED_STATEMENTS.length ||
    statements.some((statement, index) => statement !== APPROVED_STATEMENTS[index])
  ) {
    throw new Error(
      "Migration must contain exactly the approved additive askv_last_full_greeting_on statement",
    );
  }
  return statements;
}

export async function runAskVGreetingMigration(client, sqlText) {
  const statements = parseAskVGreetingMigration(sqlText);
  const verify = async () => client.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='askv_last_full_greeting_on'");
  const before = await verify();
  if (before.rows.length) {
    if (before.rows.length !== 1 || before.rows[0].data_type !== "text" || before.rows[0].is_nullable !== "YES") throw new Error("AskV greeting column has an incompatible definition");
    return; // Already applied: do not acquire an unnecessary users table DDL lock.
  }
  for (const statement of statements) {
    await client.query(statement);
  }
  const after = await verify();
  if (after.rows.length !== 1 || after.rows[0].data_type !== "text" || after.rows[0].is_nullable !== "YES") throw new Error("AskV greeting migration verification failed");
}
