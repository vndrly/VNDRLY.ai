import type { PgDatabase } from "drizzle-orm/pg-core";
import { pushSchema } from "drizzle-kit/api";

import { db, pool } from "../index";
import * as schema from "../schema";

async function mainEntry(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set to run the schema-drift check.",
    );
  }

  const { statementsToExecute, hasDataLoss, warnings } = await pushSchema(
    schema as Record<string, unknown>,
    db as unknown as PgDatabase<never>,
  );

  // Postgres truncates identifiers to NAMEDATALEN - 1 = 63 chars. Drizzle
  // generates FK constraint names like
  // "<table>_<col>_<reftable>_<refcol>_fk" which can easily exceed that
  // limit. When that happens the live constraint exists with the
  // truncated name, but `pushSchema` keeps proposing a DROP+ADD pair to
  // "fix" the name. The constraint is functionally identical, so treat
  // these as cosmetic noise and drop them from the drift report.
  const filtered = filterIdentifierTruncationDrift(statementsToExecute);

  if (filtered.length === 0) {
    process.stdout.write(
      "[check-schema] Database schema matches lib/db/src/schema. \u2713\n",
    );
    return;
  }

  const lines: string[] = [
    "",
    "\u2716 Database schema drift detected.",
    "",
    "  The live database does not match lib/db/src/schema. The following",
    "  statement(s) would need to be applied to bring it back in sync:",
    "",
  ];
  for (const statement of filtered) {
    const trimmed = statement.trim().replace(/\s+/g, " ");
    lines.push(`    \u2022 ${trimmed}`);
  }
  if (warnings.length > 0) {
    lines.push("");
    lines.push("  Drizzle warnings:");
    for (const warning of warnings) {
      lines.push(`    - ${warning}`);
    }
  }
  lines.push("");
  lines.push(
    "  Your DB is out of date \u2014 run `pnpm --filter @workspace/db push`",
  );
  if (hasDataLoss) {
    lines.push(
      "  (the change touches existing data; review the diff and use",
    );
    lines.push(
      "   `pnpm --filter @workspace/db push-force` if you accept the loss).",
    );
  }
  lines.push("");
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exitCode = 1;
}

// Postgres' NAMEDATALEN is hard-coded to 64; identifiers are truncated
// to 63 bytes when stored in pg_class / pg_constraint. Used both to
// filter "DROP truncated / ADD full" pairs from the drift report and
// to compare names in tests.
const PG_MAX_IDENTIFIER_LEN = 63;

function extractConstraintName(
  statement: string,
  verb: "DROP" | "ADD",
): string | null {
  const re =
    verb === "DROP"
      ? /DROP\s+CONSTRAINT\s+"([^"]+)"/i
      : /ADD\s+CONSTRAINT\s+"([^"]+)"/i;
  const m = statement.match(re);
  return m ? (m[1] ?? null) : null;
}

function tableOf(statement: string): string | null {
  const m = statement.match(/ALTER\s+TABLE\s+"([^"]+)"/i);
  return m ? (m[1] ?? null) : null;
}

// drizzle-kit normalizes empty array literals as `'{}'` even when the
// live DB stores `'{}'::text[]` (or vice versa). Both render identically
// at runtime, so treat empty-array SET DEFAULT statements as cosmetic.
const EMPTY_ARRAY_DEFAULT_RE =
  /ALTER\s+TABLE\s+"[^"]+"\s+ALTER\s+COLUMN\s+"[^"]+"\s+SET\s+DEFAULT\s+'\{\}'(?:::[a-z_]+(?:\[\])?)?;?\s*$/i;

export function filterIdentifierTruncationDrift(
  statements: readonly string[],
): string[] {
  const adds = new Map<string, number>();
  statements.forEach((s, i) => {
    const name = extractConstraintName(s, "ADD");
    const table = tableOf(s);
    if (name && table) adds.set(`${table}::${name}`, i);
  });
  const suppress = new Set<number>();
  statements.forEach((s, i) => {
    if (EMPTY_ARRAY_DEFAULT_RE.test(s.trim())) {
      suppress.add(i);
      return;
    }
    const droppedName = extractConstraintName(s, "DROP");
    if (!droppedName || droppedName.length !== PG_MAX_IDENTIFIER_LEN) return;
    const table = tableOf(s);
    if (!table) return;
    for (const [key, addIdx] of adds) {
      if (!key.startsWith(`${table}::`)) continue;
      const addedName = key.slice(table.length + 2);
      if (addedName.slice(0, PG_MAX_IDENTIFIER_LEN) === droppedName) {
        suppress.add(i);
        suppress.add(addIdx);
        break;
      }
    }
  });
  return statements.filter((_, i) => !suppress.has(i));
}

mainEntry()
  .catch((err) => {
    process.stderr.write(
      `[check-schema] Failed to compare schema against the database.\n${
        err instanceof Error ? `${err.stack ?? err.message}` : String(err)
      }\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {
      /* ignore pool teardown errors */
    });
  });
