const ALLOWED = [/^CREATE TABLE IF NOT EXISTS /i, /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS /i, /^ALTER TABLE [a-z_]+ ADD COLUMN IF NOT EXISTS /i];
const FORBIDDEN = /^(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i;
export function validateWorkHubGovernanceExportMigration(sqlText) {
  const statements = String(sqlText).split(";").map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (statements.length === 0) throw new Error("Work Hub governance/export migration is empty");
  for (const statement of statements) if (FORBIDDEN.test(statement) || !ALLOWED.some((pattern) => pattern.test(statement))) throw new Error(`Unsafe Work Hub governance/export migration statement: ${statement.slice(0, 80)}`);
  return statements;
}
export async function runWorkHubGovernanceExportMigration(client, sqlText) { for (const statement of validateWorkHubGovernanceExportMigration(sqlText)) await client.query(statement); }
