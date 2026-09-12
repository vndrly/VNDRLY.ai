const safe = /^(?:CREATE TABLE IF NOT EXISTS|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS|ALTER TABLE [a-z_"]+ ADD COLUMN IF NOT EXISTS)\b/i;
export function validateWorkHubDevicesMigration(sql) {
  const statements = sql.split(";").map(value => value.trim()).filter(Boolean);
  if (!statements.length) throw new Error("Unsafe empty Work Hub devices migration");
  for (const statement of statements) {
    if (!safe.test(statement) || /^(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i.test(statement) || /\bDROP\s+(?:COLUMN|CONSTRAINT|TABLE|INDEX)\b/i.test(statement)) throw new Error(`Unsafe Work Hub devices migration statement: ${statement.slice(0, 100)}`);
  }
  return statements;
}
export async function runWorkHubDevicesMigration(client, sql) {
  for (const statement of validateWorkHubDevicesMigration(sql)) await client.query(statement);
}
