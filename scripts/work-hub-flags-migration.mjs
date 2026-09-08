const APPROVED_STATEMENTS = [
  'ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_enabled" boolean NOT NULL DEFAULT false',
  'ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_meeting_recording_enabled" boolean NOT NULL DEFAULT false',
  'ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_microsoft_365_enabled" boolean NOT NULL DEFAULT false',
  'ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_exports_enabled" boolean NOT NULL DEFAULT false',
];

function normalizeStatement(statement) {
  return statement.trim().replace(/\s+/g, " ");
}

export function parseWorkHubFlagsMigration(sqlText) {
  const statements = String(sqlText).split(";").map(normalizeStatement).filter(Boolean);
  if (
    statements.length !== APPROVED_STATEMENTS.length ||
    statements.some((statement, index) => statement !== APPROVED_STATEMENTS[index])
  ) {
    throw new Error("Migration must contain exactly the approved additive Work Hub flag statements");
  }
  return statements;
}

export async function runWorkHubFlagsMigration(client, sqlText) {
  for (const statement of parseWorkHubFlagsMigration(sqlText)) {
    await client.query(statement);
  }
}
