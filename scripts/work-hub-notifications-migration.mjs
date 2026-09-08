const ALLOWED = [/^ALTER TABLE .* ADD COLUMN IF NOT EXISTS /i];
const FORBIDDEN = /^(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i;
export function validateWorkHubNotificationsMigration(sqlText) {
  const statements = String(sqlText).split(";").map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (!statements.length) throw new Error("Work Hub notifications migration is empty");
  for (const statement of statements) if (FORBIDDEN.test(statement) || !ALLOWED.some((pattern) => pattern.test(statement))) throw new Error(`Unsafe Work Hub notifications migration statement: ${statement.slice(0, 80)}`);
  return statements;
}
export async function runWorkHubNotificationsMigration(client, sqlText) { for (const statement of validateWorkHubNotificationsMigration(sqlText)) await client.query(statement); }
