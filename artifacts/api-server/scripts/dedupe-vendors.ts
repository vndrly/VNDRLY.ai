/**
 * Dedupe legacy duplicate vendor rows.
 *
 * Several vendors have legacy duplicate rows from earlier demo seeds
 * (Baker Hughes ×2, Select Water Solutions ×2, ChampionX-style variants,
 * NOV variants, Liberty/ProFrac variants, etc). Vendor branding stamps the
 * same logo on each duplicate, but invoices, 1099s, ratings, tickets, and
 * site work are still split across the duplicate rows — so vendor-rollup
 * reports under-count actual volume per vendor.
 *
 * For each duplicate group we pick a canonical "survivor" row and re-point
 * every foreign key (tickets, invoices, tax_1099_filings, vendor_ratings,
 * vendor_partner_billing_settings, partner_vendor_relationships,
 * vendor_site_location_afes, vendor_work_types, vendor_people, vendor_notes,
 * site_visits.host_vendor_id, site_work_assignments, hotlist_bids,
 * hotlist_jobs.awarded_vendor_id, accounting_connections,
 * accounting_pushed_invoices, qb_account_mapping[_audit_log],
 * user_org_memberships) onto the survivor and then delete the loser rows.
 *
 * Tables with a unique constraint that scopes by vendor_id are merged with
 * conflict handling: if the survivor already has the conflicting row we drop
 * the loser's row instead of moving it (so we never violate the constraint).
 *
 * The actual FK rewrite + partial-conflict preflight logic lives in
 * `src/lib/vendor-merge.ts` (the admin UI/API merge flow was removed;
 * this script is the supported path for engineer-run dedupe).
 * UI shares the exact same code path. This script is the bulk batch
 * driver for the known legacy demo duplicates.
 *
 * Run modes:
 *   pnpm --filter @workspace/api-server exec tsx scripts/dedupe-vendors.ts
 *     → DRY RUN. Prints the pre-flight report only, makes no DB changes.
 *
 *   pnpm --filter @workspace/api-server exec tsx scripts/dedupe-vendors.ts --apply
 *     → APPLY. Runs the merge inside a single transaction.
 *
 * Idempotent. Safe to re-run; once a duplicate group is collapsed the script
 * sees only the survivor and skips it.
 */
import { pool, db, vendorsTable } from "@workspace/db";
import {
  applyMerge,
  planMerge,
  type MergeCounts,
} from "../src/lib/vendor-merge";

type DuplicateGroup = {
  /** Canonical name for logging. */
  canonical: string;
  /** Vendor names (case-sensitive) considered part of this group. */
  names: string[];
  /**
   * How to choose the survivor when more than one row matches `names`.
   * - "lowest-id": pick the smallest id (oldest row).
   * - "highest-id": pick the largest id (newest row).
   * - "name-match": pick the row whose name exactly equals `canonical`,
   *   falling back to lowest-id if no exact match.
   */
  survivor: "lowest-id" | "highest-id" | "name-match";
};

/**
 * Hard-coded duplicate groups from the legacy demo seeds. Listed in the
 * task description: Baker Hughes ×2, Select Water Solutions ×2,
 * ChampionX-style variants, NOV variants, Liberty/ProFrac variants, and
 * the Patterson-UTI / U.S. Silica / Stallion variants that share the
 * same shape. NexTier is intentionally NOT in this list — per
 * seed-vendor-branding.ts it is a retired brand kept as its own row.
 */
const GROUPS: DuplicateGroup[] = [
  {
    canonical: "Baker Hughes",
    names: ["Baker Hughes", "Baker Hughes Field Svcs"],
    survivor: "name-match",
  },
  {
    canonical: "ChampionX",
    names: ["ChampionX", "ChampionX / Newpark"],
    survivor: "name-match",
  },
  {
    canonical: "Liberty Energy",
    names: ["Liberty Energy", "Liberty Energy / ProFrac"],
    survivor: "name-match",
  },
  {
    canonical: "NOV Inc.",
    names: ["NOV Inc.", "NOV (National Oilwell Varco)"],
    survivor: "name-match",
  },
  {
    canonical: "Patterson-UTI Energy",
    names: ["Patterson-UTI Energy", "Patterson-UTI / Precision"],
    survivor: "name-match",
  },
  {
    canonical: "Select Water Solutions",
    names: ["Select Water Solutions"],
    // Both rows share the canonical name; pick the older one because in
    // the current DB it is the row with all the tickets/people attached.
    survivor: "lowest-id",
  },
  {
    canonical: "U.S. Silica Holdings",
    names: ["U.S. Silica Holdings", "U.S. Silica / Hi-Crush"],
    survivor: "name-match",
  },
  {
    canonical: "Stallion Infrastructure Services",
    names: ["Stallion Infrastructure Services", "Stallion Infrastructure"],
    survivor: "name-match",
  },
];

type VendorRow = { id: number; name: string; logoUrl: string | null };

function pickSurvivor(group: DuplicateGroup, rows: VendorRow[]): VendorRow {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  if (group.survivor === "name-match") {
    const exact = sorted.find((r) => r.name === group.canonical);
    if (exact) return exact;
    return sorted[0];
  }
  if (group.survivor === "highest-id") return sorted[sorted.length - 1];
  return sorted[0];
}

function fmtCounts(counts: MergeCounts): string {
  const parts: string[] = [];
  for (const [table, c] of Object.entries(counts)) {
    if (c.move === 0 && c.conflictDelete === 0) continue;
    const bits: string[] = [];
    if (c.move > 0) bits.push(`${c.move} moved`);
    if (c.conflictDelete > 0) bits.push(`${c.conflictDelete} dropped (conflict)`);
    parts.push(`    ${table.padEnd(36)} ${bits.join(", ")}`);
  }
  return parts.length ? parts.join("\n") : "    (no FK rows to move)";
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "DEDUPE VENDORS — APPLY mode (changes WILL be committed)"
      : "DEDUPE VENDORS — DRY RUN (no changes; pass --apply to commit)",
  );
  console.log("");

  const allVendors = (await db.select().from(vendorsTable)) as VendorRow[];

  type PlannedMerge = {
    survivor: VendorRow;
    losers: VendorRow[];
  };
  const plans: PlannedMerge[] = [];
  for (const group of GROUPS) {
    const matches = allVendors.filter((v) => group.names.includes(v.name));
    if (matches.length <= 1) {
      console.log(`✓ ${group.canonical}: nothing to merge (${matches.length} row).`);
      continue;
    }
    const survivor = pickSurvivor(group, matches);
    const losers = matches.filter((v) => v.id !== survivor.id);
    plans.push({ survivor, losers });
  }

  if (plans.length === 0) {
    console.log("\nNo duplicate groups found. Database is clean.");
    process.exit(0);
  }

  // Pre-flight: connect, plan everything in a read-only transaction, print.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { survivor, losers } of plans) {
      console.log("");
      console.log(`Group: survivor #${survivor.id} "${survivor.name}"`);
      for (const loser of losers) {
        const counts = await planMerge(client, survivor.id, loser.id);
        console.log(`  ← merging #${loser.id} "${loser.name}"`);
        console.log(fmtCounts(counts));
      }
    }
    await client.query("ROLLBACK");

    if (!apply) {
      console.log("");
      console.log("Dry run complete. Re-run with --apply to commit the merge.");
      process.exit(0);
    }

    // APPLY: do the work in a fresh transaction so the planning rollback
    // above stays clean.
    console.log("");
    console.log("Applying merge…");
    await client.query("BEGIN");
    let totalMoved = 0;
    let totalDropped = 0;
    let totalLosersDeleted = 0;
    for (const { survivor, losers } of plans) {
      for (const loser of losers) {
        const { counts } = await applyMerge(client, survivor.id, loser.id);
        for (const c of Object.values(counts)) {
          totalMoved += c.move;
          totalDropped += c.conflictDelete;
        }
        totalLosersDeleted++;
        console.log(`  ✓ merged #${loser.id} "${loser.name}" → #${survivor.id} "${survivor.name}"`);
      }
    }
    await client.query("COMMIT");
    console.log("");
    console.log(
      `Done. Deleted ${totalLosersDeleted} duplicate vendor row(s); ` +
        `moved ${totalMoved} FK rows; dropped ${totalDropped} conflicting loser rows.`,
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Best-effort rollback; ignore secondary errors.
    }
    throw err;
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("dedupe-vendors failed:", err);
  process.exit(1);
});
