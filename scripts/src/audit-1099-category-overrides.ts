/**
 * Audit / clean up legacy invalid 1099-category overrides
 * (`vendor_partner_billing_settings.default_income_category_overrides`).
 *
 * Why this exists
 * ---------------
 * Task #408 hardened `PUT /api/invoices/vendor-partner-billing-settings`
 * so an invalid line-type key or income-category value is rejected at
 * the API boundary. That fix protects rows written from then on, but
 * any override stored *before* the validation was added — e.g. left
 * over from a renamed/removed enum value — is still in the database.
 * The invoice generator (`invoice-generator.ts`) consults this map for
 * every freshly-emitted line, so a stale value would silently be
 * stamped onto every regenerated invoice line and surface as a 1099
 * miscategorization at tax time. This script makes those legacy rows
 * visible and provides a one-keystroke cleanup.
 *
 * What it does
 * ------------
 *  - Reports every `vendor_partner_billing_settings` row whose JSON
 *    override map contains a key not in the live `INVOICE_LINE_TYPES`
 *    tuple OR a value not in the live `INVOICE_LINE_INCOME_CATEGORIES`
 *    tuple. Each row is annotated with the vendor + partner names so
 *    an admin can identify it without a separate join.
 *  - Default mode is *report only*; no writes happen unless one of the
 *    cleanup flags is passed.
 *  - With `--clean`, drops just the offending entries from the JSON
 *    map and writes the cleaned object back (preserves any still-valid
 *    entries).
 *  - With `--clear-all`, sets the whole `defaultIncomeCategoryOverrides`
 *    column to `NULL` for affected rows. Useful when you want a fresh
 *    start instead of a partial map.
 *  - Always asks for interactive confirmation before any DB write,
 *    unless `--yes` is passed (handy for CI/cron usage).
 *
 * Usage
 * -----
 *   pnpm --filter @workspace/scripts run audit:1099-overrides
 *   pnpm --filter @workspace/scripts run audit:1099-overrides -- --clean
 *   pnpm --filter @workspace/scripts run audit:1099-overrides -- --clear-all --yes
 *
 * When to run it
 * --------------
 * Run after any change to `INVOICE_LINE_TYPES` or
 * `INVOICE_LINE_INCOME_CATEGORIES` in `lib/db/src/schema/invoiceLines.ts`
 * (renames, removals, splits) — the new enum values won't break the
 * write path (Task #408 covers that), but pre-existing rows may now
 * carry a stale value.
 */
import { eq, isNotNull, sql } from "drizzle-orm";
import * as readline from "node:readline";
import {
  db,
  pool,
  vendorPartnerBillingSettingsTable,
  vendorsTable,
  partnersTable,
  INVOICE_LINE_TYPES,
  INVOICE_LINE_INCOME_CATEGORIES,
} from "@workspace/db";
import type { IncomeCategoryOverrideMap } from "@workspace/db";

type Mode = "report" | "clean" | "clear-all";

interface Args {
  mode: Mode;
  assumeYes: boolean;
}

function parseArgs(argv: string[]): Args {
  let mode: Mode = "report";
  let assumeYes = false;
  for (const a of argv) {
    if (a === "--") {
      // pnpm forwards `--` as a literal separator; ignore it.
      continue;
    }
    if (a === "--clean") {
      if (mode === "clear-all")
        throw new Error("Pick either --clean or --clear-all, not both.");
      mode = "clean";
    } else if (a === "--clear-all") {
      if (mode === "clean")
        throw new Error("Pick either --clean or --clear-all, not both.");
      mode = "clear-all";
    } else if (a === "--yes" || a === "-y") {
      assumeYes = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx audit-1099-category-overrides.ts [--clean | --clear-all] [--yes]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { mode, assumeYes };
}

const VALID_KEYS = new Set<string>(INVOICE_LINE_TYPES);
const VALID_VALUES = new Set<string>(INVOICE_LINE_INCOME_CATEGORIES);

interface InvalidEntry {
  key: string;
  value: string;
  reason: "unknown-key" | "unknown-value";
}

function findInvalidEntries(
  map: Record<string, unknown> | null,
): InvalidEntry[] {
  if (!map || typeof map !== "object") return [];
  const out: InvalidEntry[] = [];
  for (const [key, value] of Object.entries(map)) {
    const valueStr = typeof value === "string" ? value : String(value);
    if (!VALID_KEYS.has(key)) {
      out.push({ key, value: valueStr, reason: "unknown-key" });
      continue;
    }
    if (!VALID_VALUES.has(valueStr)) {
      out.push({ key, value: valueStr, reason: "unknown-value" });
    }
  }
  return out;
}

interface BadRow {
  id: number;
  vendorId: number;
  partnerId: number;
  vendorName: string;
  partnerName: string;
  overrides: Record<string, unknown>;
  invalid: InvalidEntry[];
}

async function findBadRows(): Promise<BadRow[]> {
  const rows = await db
    .select({
      id: vendorPartnerBillingSettingsTable.id,
      vendorId: vendorPartnerBillingSettingsTable.vendorId,
      partnerId: vendorPartnerBillingSettingsTable.partnerId,
      vendorName: vendorsTable.name,
      partnerName: partnersTable.name,
      overrides: vendorPartnerBillingSettingsTable.defaultIncomeCategoryOverrides,
    })
    .from(vendorPartnerBillingSettingsTable)
    .innerJoin(
      vendorsTable,
      eq(vendorsTable.id, vendorPartnerBillingSettingsTable.vendorId),
    )
    .innerJoin(
      partnersTable,
      eq(partnersTable.id, vendorPartnerBillingSettingsTable.partnerId),
    )
    .where(
      isNotNull(
        vendorPartnerBillingSettingsTable.defaultIncomeCategoryOverrides,
      ),
    );

  const bad: BadRow[] = [];
  for (const r of rows) {
    const overrides = r.overrides as Record<string, unknown> | null;
    const invalid = findInvalidEntries(overrides);
    if (invalid.length > 0 && overrides) {
      bad.push({
        id: r.id,
        vendorId: r.vendorId,
        partnerId: r.partnerId,
        vendorName: r.vendorName,
        partnerName: r.partnerName,
        overrides,
        invalid,
      });
    }
  }
  return bad;
}

function formatReport(rows: BadRow[]): void {
  if (rows.length === 0) {
    console.log("No invalid 1099 category overrides found. Nothing to do.");
    return;
  }
  console.log(
    `Found ${rows.length} vendor_partner_billing_settings row(s) with invalid 1099 overrides:\n`,
  );
  for (const r of rows) {
    console.log(
      `  • settings.id=${r.id}  vendor=${r.vendorId} "${r.vendorName}"  partner=${r.partnerId} "${r.partnerName}"`,
    );
    console.log(`      stored map: ${JSON.stringify(r.overrides)}`);
    for (const e of r.invalid) {
      const why =
        e.reason === "unknown-key"
          ? `unknown line-type key (not in INVOICE_LINE_TYPES)`
          : `unknown income category (not in INVOICE_LINE_INCOME_CATEGORIES)`;
      console.log(`        - "${e.key}" → "${e.value}"  [${why}]`);
    }
  }
  console.log("");
}

function cleanedMap(row: BadRow): IncomeCategoryOverrideMap | null {
  const dropKeys = new Set(row.invalid.map((e) => e.key));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.overrides)) {
    if (dropKeys.has(k)) continue;
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length === 0
    ? null
    : (out as IncomeCategoryOverrideMap);
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer: string = await new Promise((resolve) => {
      rl.question(prompt, (a) => resolve(a));
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function applyCleanup(rows: BadRow[], mode: Mode): Promise<void> {
  for (const r of rows) {
    const next = mode === "clear-all" ? null : cleanedMap(r);
    await db
      .update(vendorPartnerBillingSettingsTable)
      .set({
        defaultIncomeCategoryOverrides: next,
        // bump updatedAt explicitly so audit trails show the cleanup.
        updatedAt: sql`now()`,
      })
      .where(eq(vendorPartnerBillingSettingsTable.id, r.id));
    console.log(
      `  ✓ settings.id=${r.id} updated → ${
        next ? JSON.stringify(next) : "NULL"
      }`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(
    `[audit-1099-overrides] mode=${args.mode}  assumeYes=${args.assumeYes}`,
  );
  console.log(
    `[audit-1099-overrides] valid keys: ${INVOICE_LINE_TYPES.join(", ")}`,
  );
  console.log(
    `[audit-1099-overrides] valid values: ${INVOICE_LINE_INCOME_CATEGORIES.join(", ")}\n`,
  );

  const rows = await findBadRows();
  formatReport(rows);

  if (args.mode === "report" || rows.length === 0) {
    await pool.end();
    process.exit(0);
  }

  const verb = args.mode === "clear-all" ? "clear (set to NULL)" : "clean";
  if (!args.assumeYes) {
    const ok = await confirm(
      `About to ${verb} 1099 overrides on ${rows.length} row(s). Continue? [y/N] `,
    );
    if (!ok) {
      console.log("Aborted. No changes were written.");
      await pool.end();
      process.exit(0);
    }
  }

  console.log("\nApplying changes...");
  await applyCleanup(rows, args.mode);
  console.log(`\nDone. Updated ${rows.length} row(s).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("[audit-1099-overrides] FAILED", err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
