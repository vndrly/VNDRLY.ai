const ALLOWED = [
  /^CREATE TABLE IF NOT EXISTS /i,
  /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS /i,
];
const FORBIDDEN = /^(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|RENAME)\b/i;
export function validateWorkHubImportsMigration(sqlText) {
  const statements = String(sqlText)
    .split(";")
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (!statements.length)
    throw new Error("Work Hub imports migration is empty");
  for (const statement of statements)
    if (
      FORBIDDEN.test(statement) ||
      !ALLOWED.some((pattern) => pattern.test(statement))
    )
      throw new Error(
        `Unsafe Work Hub imports migration statement: ${statement.slice(0, 80)}`,
      );
  return statements;
}
export async function runWorkHubImportsMigration(client, sqlText) {
  for (const statement of validateWorkHubImportsMigration(sqlText))
    await client.query(statement);
}
