import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** Detect Postgres unique-violation on a serial/identity primary key. */
export function isDuplicatePrimaryKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const cause = (err as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return false;
  const pg = cause as { code?: string; constraint?: string };
  return pg.code === "23505" && (pg.constraint?.endsWith("_pkey") ?? false);
}

/** Bump a table's serial sequence to MAX(id) so the next insert succeeds. */
export async function resyncPgSerialSequence(
  tableName: string,
  columnName = "id",
): Promise<void> {
  await db.execute(sql.raw(
    `SELECT setval(
       pg_get_serial_sequence('${tableName.replace(/'/g, "''")}', '${columnName.replace(/'/g, "''")}'),
       GREATEST(COALESCE((SELECT MAX("${columnName.replace(/"/g, '""')}") FROM "${tableName.replace(/"/g, '""')}"), 0), 1)
     )`,
  ));
}

/** Run an insert once; on duplicate-pkey drift, resync the sequence and retry. */
export async function withSerialInsertRetry<T>(
  tableName: string,
  insertFn: () => Promise<T>,
): Promise<T> {
  try {
    return await insertFn();
  } catch (err) {
    if (!isDuplicatePrimaryKeyError(err)) throw err;
    await resyncPgSerialSequence(tableName);
    return await insertFn();
  }
}
