import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../lib/db/drizzle/chunk_411_implementation_a.sql", import.meta.url), "utf8");

test("managed subcontractor hours settings are additive and constrained", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "hours_approval_policy" text NOT NULL DEFAULT 'either'/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "hours_recipient_emails" text\[\] NOT NULL DEFAULT '\{\}'/i);
  assert.match(migration, /hours_approval_policy[^;]+IN \('contractor', 'subcontractor', 'either', 'dual'\)/is);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(migration, /DO \$\s*(?:BEGIN|DECLARE)/i, "PL/pgSQL blocks must use a complete dollar quote");
  assert.match(migration, /DO \$\$\s*(?:BEGIN|DECLARE)[\s\S]*END \$\$;/i);
});
