/**
 * Seed county-level site locations for Mach Natural Resources LP
 * (NYSE: MNR, Oklahoma City).
 *
 * IMPORTANT — what these entries represent:
 *   These are county-level "area" anchors covering the Oklahoma and
 *   Texas counties where Mach publicly discloses operations in its
 *   10-K filings and investor presentations (Anadarko Basin —
 *   SCOOP/STACK in Oklahoma; Western Anadarko / Granite Wash /
 *   Cleveland in the Texas Panhandle). They are NOT individual
 *   well/pad/lease entries — pulling those requires an OCC/RRC
 *   data feed.
 *
 *   Each entry is named "Mach <Play> — <County> County, <State>" so
 *   it is obvious to operators that these are area aggregates, and
 *   the lat/lon for each row is the real county centroid.
 *
 * Idempotent: matches existing rows by (partnerId, name). Inserts
 * only when missing; never overwrites.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seed-mach-site-locations.ts
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, partnersTable, siteLocationsTable } from "@workspace/db";

type SiteSeed = {
  name: string;
  address: string;
  state: "OK" | "TX";
  latitude: number;
  longitude: number;
  /** Approximate radius covering the county area in meters. */
  siteRadiusMeters: number;
};

const PARTNER_NAME = "Mach Natural Resources";

// Centroids from US Census TIGER county shapefiles (publicly known
// geographic facts, not fabricated coordinates). Play assignments
// reflect Mach's publicly disclosed core areas.
const SITES: SiteSeed[] = [
  // === Oklahoma — Anadarko Basin / SCOOP / STACK ===
  { name: "Mach STACK — Kingfisher County, OK",  address: "Kingfisher County, OK", state: "OK", latitude: 35.953, longitude: -97.940, siteRadiusMeters: 30000 },
  { name: "Mach STACK — Canadian County, OK",    address: "Canadian County, OK",   state: "OK", latitude: 35.541, longitude: -97.987, siteRadiusMeters: 30000 },
  { name: "Mach STACK — Major County, OK",       address: "Major County, OK",      state: "OK", latitude: 36.305, longitude: -98.553, siteRadiusMeters: 30000 },
  { name: "Mach STACK — Blaine County, OK",      address: "Blaine County, OK",     state: "OK", latitude: 35.880, longitude: -98.435, siteRadiusMeters: 30000 },
  { name: "Mach STACK — Dewey County, OK",       address: "Dewey County, OK",      state: "OK", latitude: 35.985, longitude: -99.003, siteRadiusMeters: 30000 },
  { name: "Mach Anadarko — Custer County, OK",   address: "Custer County, OK",     state: "OK", latitude: 35.617, longitude: -98.972, siteRadiusMeters: 30000 },
  { name: "Mach SCOOP — Grady County, OK",       address: "Grady County, OK",      state: "OK", latitude: 35.022, longitude: -97.853, siteRadiusMeters: 30000 },
  { name: "Mach SCOOP — Garvin County, OK",      address: "Garvin County, OK",     state: "OK", latitude: 34.706, longitude: -97.310, siteRadiusMeters: 30000 },
  { name: "Mach SCOOP — Stephens County, OK",    address: "Stephens County, OK",   state: "OK", latitude: 34.479, longitude: -97.853, siteRadiusMeters: 30000 },
  // === Texas Panhandle — Western Anadarko / Granite Wash / Cleveland ===
  { name: "Mach Western Anadarko — Hemphill County, TX",  address: "Hemphill County, TX",  state: "TX", latitude: 35.834, longitude: -100.270, siteRadiusMeters: 30000 },
  { name: "Mach Western Anadarko — Lipscomb County, TX",  address: "Lipscomb County, TX",  state: "TX", latitude: 36.278, longitude: -100.275, siteRadiusMeters: 30000 },
  { name: "Mach Western Anadarko — Wheeler County, TX",   address: "Wheeler County, TX",   state: "TX", latitude: 35.402, longitude: -100.270, siteRadiusMeters: 30000 },
  { name: "Mach Western Anadarko — Roberts County, TX",   address: "Roberts County, TX",   state: "TX", latitude: 35.840, longitude: -100.815, siteRadiusMeters: 30000 },
  { name: "Mach Western Anadarko — Ochiltree County, TX", address: "Ochiltree County, TX", state: "TX", latitude: 36.278, longitude: -100.815, siteRadiusMeters: 30000 },
];

function generateSiteCode(): string {
  // Matches the format used by POST /api/site-locations in
  // artifacts/api-server/src/routes/siteLocations.ts.
  return "SITE-" + randomBytes(4).toString("hex").toUpperCase();
}

export type MachSeedCounts = {
  inserted: number;
  skipped: number;
  partnerMissing: boolean;
};

export async function seedMachSiteLocations(): Promise<MachSeedCounts> {
  const [partner] = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.name, PARTNER_NAME))
    .limit(1);
  if (!partner) {
    console.error(`Partner "${PARTNER_NAME}" not found. Run seed-permian-basin.ts first.`);
    return { inserted: 0, skipped: 0, partnerMissing: true };
  }
  console.log(`Seeding ${SITES.length} county-level site locations for partner #${partner.id} (${partner.name})…`);

  let inserted = 0;
  let skipped = 0;
  for (const s of SITES) {
    const [existing] = await db
      .select()
      .from(siteLocationsTable)
      .where(
        and(
          eq(siteLocationsTable.partnerId, partner.id),
          eq(siteLocationsTable.name, s.name),
        ),
      )
      .limit(1);
    if (existing) {
      skipped++;
      console.log(`  · skip (exists): ${s.name}`);
      continue;
    }
    await db.insert(siteLocationsTable).values({
      partnerId: partner.id,
      name: s.name,
      address: s.address,
      latitude: s.latitude,
      longitude: s.longitude,
      state: s.state,
      siteRadiusMeters: s.siteRadiusMeters,
      siteCode: generateSiteCode(),
    });
    inserted++;
    console.log(`  + inserted: ${s.name}`);
  }
  console.log(`Done. +${inserted} inserted, ${skipped} already present.`);
  return { inserted, skipped, partnerMissing: false };
}

// Only run when invoked directly (e.g. `tsx scripts/seed-mach-site-locations.ts`),
// not when imported from the test suite.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (await import("node:url"))
    .pathToFileURL(process.argv[1])
    .href === import.meta.url;

if (invokedDirectly) {
  seedMachSiteLocations()
    .then((r) => process.exit(r.partnerMissing ? 1 : 0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
