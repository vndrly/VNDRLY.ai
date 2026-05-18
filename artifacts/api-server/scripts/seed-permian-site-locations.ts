/**
 * Seed county-level site locations for the Permian Basin (TX) and
 * Mid-Continent (OK) operators that don't yet have any sites attached.
 *
 * IMPORTANT — what these entries represent:
 *   These are county-level "area" anchors covering the Texas and
 *   Oklahoma counties where each operator publicly discloses
 *   activity (10-K filings, investor presentations, RRC operator
 *   reports). They are NOT individual well/pad/lease entries —
 *   pulling those would require an RRC/OCC data feed.
 *
 *   Each entry is named "<Operator> <Play> — <County> County, <State>"
 *   so it is obvious to operators that these are area aggregates,
 *   and the lat/lon for each row is the real US Census TIGER county
 *   centroid (publicly known geographic facts, not fabricated
 *   coordinates).
 *
 * Idempotent: matches existing rows by (partnerId, name). Inserts
 * only when missing; never overwrites. Mach Natural Resources is
 * intentionally NOT covered here — see seed-mach-site-locations.ts
 * which already seeds Mach's 14 Anadarko counties.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seed-permian-site-locations.ts
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

// ---------------------------------------------------------------------------
// US Census TIGER county centroids used across multiple operators.
// Single source of truth so all operators share consistent lat/lon for the
// same county (centroid is a public geographic fact about the county itself,
// not about the operator).
// ---------------------------------------------------------------------------
const COUNTIES = {
  // === Texas — Delaware Basin (sub-Permian) ===
  "Loving, TX":     { lat: 31.847, lon: -103.578, state: "TX" as const },
  "Reeves, TX":     { lat: 31.252, lon: -103.696, state: "TX" as const },
  "Culberson, TX":  { lat: 31.367, lon: -104.518, state: "TX" as const },
  "Ward, TX":       { lat: 31.527, lon: -103.135, state: "TX" as const },
  "Winkler, TX":    { lat: 31.857, lon: -103.044, state: "TX" as const },
  "Pecos, TX":      { lat: 30.881, lon: -102.733, state: "TX" as const },
  // === Texas — Midland Basin (sub-Permian) ===
  "Midland, TX":    { lat: 31.870, lon: -102.029, state: "TX" as const },
  "Martin, TX":     { lat: 32.305, lon: -101.949, state: "TX" as const },
  "Andrews, TX":    { lat: 32.305, lon: -102.640, state: "TX" as const },
  "Ector, TX":      { lat: 31.870, lon: -102.541, state: "TX" as const },
  "Reagan, TX":     { lat: 31.366, lon: -101.521, state: "TX" as const },
  "Upton, TX":      { lat: 31.371, lon: -102.046, state: "TX" as const },
  "Glasscock, TX":  { lat: 31.870, lon: -101.518, state: "TX" as const },
  "Howard, TX":     { lat: 32.305, lon: -101.435, state: "TX" as const },
  "Borden, TX":     { lat: 32.745, lon: -101.435, state: "TX" as const },
  "Crockett, TX":   { lat: 30.722, lon: -101.413, state: "TX" as const },
  // === Texas — Central Basin Platform / Northwest Shelf ===
  "Crane, TX":      { lat: 31.426, lon: -102.520, state: "TX" as const },
  "Yoakum, TX":     { lat: 33.174, lon: -102.825, state: "TX" as const },
  "Gaines, TX":     { lat: 32.745, lon: -102.638, state: "TX" as const },
  // === Texas — Eagle Ford (South Texas) ===
  "Karnes, TX":     { lat: 28.901, lon: -97.858,  state: "TX" as const },
  "DeWitt, TX":     { lat: 29.083, lon: -97.357,  state: "TX" as const },
  "Atascosa, TX":   { lat: 28.895, lon: -98.527,  state: "TX" as const },
  "Gonzales, TX":   { lat: 29.458, lon: -97.490,  state: "TX" as const },
  "Webb, TX":       { lat: 27.762, lon: -99.331,  state: "TX" as const },
  "Dimmit, TX":     { lat: 28.422, lon: -99.756,  state: "TX" as const },
  "Maverick, TX":   { lat: 28.743, lon: -100.314, state: "TX" as const },
  // === Oklahoma — Anadarko Basin SCOOP/STACK ===
  "Kingfisher, OK": { lat: 35.953, lon: -97.940,  state: "OK" as const },
  "Canadian, OK":   { lat: 35.541, lon: -97.987,  state: "OK" as const },
  "Blaine, OK":     { lat: 35.880, lon: -98.435,  state: "OK" as const },
  "Dewey, OK":      { lat: 35.985, lon: -99.003,  state: "OK" as const },
  "Custer, OK":     { lat: 35.617, lon: -98.972,  state: "OK" as const },
  "Grady, OK":      { lat: 35.022, lon: -97.853,  state: "OK" as const },
  "Garvin, OK":     { lat: 34.706, lon: -97.310,  state: "OK" as const },
  "Stephens, OK":   { lat: 34.479, lon: -97.853,  state: "OK" as const },
};

type CountyKey = keyof typeof COUNTIES;
const RADIUS_M = 30000;

function mkSites(operator: string, play: string, counties: CountyKey[]): SiteSeed[] {
  return counties.map((key) => {
    const c = COUNTIES[key];
    return {
      name: `${operator} ${play} — ${key.replace(", ", " County, ")}`,
      address: `${key.replace(", ", " County, ")}`,
      state: c.state,
      latitude: c.lat,
      longitude: c.lon,
      siteRadiusMeters: RADIUS_M,
    };
  });
}

// ---------------------------------------------------------------------------
// Per-operator anchors. County selection reflects each operator's publicly
// disclosed core areas in 10-K filings and investor presentations as of 2024.
// Operators in shared counties (very common in the Permian) deliberately
// produce overlapping rows — this is realistic.
// ---------------------------------------------------------------------------
const PLAN: Array<{ partnerName: string; sites: SiteSeed[] }> = [
  {
    partnerName: "ExxonMobil",
    sites: [
      ...mkSites("ExxonMobil", "Delaware", ["Loving, TX", "Reeves, TX", "Culberson, TX", "Ward, TX", "Winkler, TX"]),
      ...mkSites("ExxonMobil", "Midland",  ["Midland, TX", "Martin, TX", "Andrews, TX", "Reagan, TX", "Upton, TX", "Glasscock, TX", "Howard, TX"]),
    ],
  },
  {
    partnerName: "Chevron",
    sites: [
      ...mkSites("Chevron", "Delaware", ["Loving, TX", "Reeves, TX", "Culberson, TX", "Ward, TX"]),
      ...mkSites("Chevron", "Midland",  ["Midland, TX", "Martin, TX", "Reagan, TX", "Upton, TX", "Glasscock, TX", "Howard, TX"]),
    ],
  },
  {
    partnerName: "ConocoPhillips",
    sites: [
      ...mkSites("ConocoPhillips", "Delaware",   ["Loving, TX", "Reeves, TX", "Ward, TX", "Winkler, TX", "Culberson, TX"]),
      ...mkSites("ConocoPhillips", "Eagle Ford", ["Karnes, TX", "DeWitt, TX"]),
    ],
  },
  {
    partnerName: "Pioneer Natural Resources",
    sites: mkSites("Pioneer", "Midland", ["Midland, TX", "Martin, TX", "Andrews, TX", "Reagan, TX", "Upton, TX", "Glasscock, TX", "Howard, TX", "Borden, TX"]),
  },
  {
    partnerName: "Diamondback Energy",
    sites: mkSites("Diamondback", "Midland", ["Midland, TX", "Martin, TX", "Andrews, TX", "Reagan, TX", "Upton, TX", "Glasscock, TX", "Howard, TX", "Ector, TX"]),
  },
  {
    partnerName: "Occidental Petroleum",
    sites: mkSites("Oxy", "Delaware", ["Loving, TX", "Reeves, TX", "Ward, TX", "Winkler, TX", "Culberson, TX", "Pecos, TX"]),
  },
  {
    partnerName: "Devon Energy",
    sites: mkSites("Devon", "Delaware", ["Loving, TX", "Reeves, TX", "Ward, TX"]),
  },
  {
    partnerName: "EOG Resources",
    sites: [
      ...mkSites("EOG", "Delaware",   ["Loving, TX", "Reeves, TX", "Culberson, TX"]),
      ...mkSites("EOG", "Eagle Ford", ["Karnes, TX", "Atascosa, TX", "Gonzales, TX"]),
    ],
  },
  {
    partnerName: "APA Corporation (Apache)",
    sites: mkSites("APA", "Alpine High / Delaware", ["Reeves, TX", "Culberson, TX", "Pecos, TX"]),
  },
  {
    partnerName: "Coterra Energy",
    sites: mkSites("Coterra", "Delaware", ["Culberson, TX", "Reeves, TX"]),
  },
  {
    partnerName: "Permian Resources",
    sites: mkSites("Permian Resources", "Delaware", ["Loving, TX", "Reeves, TX", "Ward, TX", "Winkler, TX"]),
  },
  {
    partnerName: "BP America (BPX Energy)",
    sites: mkSites("BPX", "Delaware", ["Reeves, TX", "Loving, TX", "Pecos, TX"]),
  },
  {
    partnerName: "Shell USA",
    sites: mkSites("Shell", "Delaware (legacy)", ["Loving, TX", "Reeves, TX"]),
  },
  {
    partnerName: "Marathon Oil",
    sites: mkSites("Marathon", "Eagle Ford", ["Karnes, TX", "DeWitt, TX", "Atascosa, TX", "Gonzales, TX"]),
  },
  {
    partnerName: "Endeavor Energy Resources",
    sites: mkSites("Endeavor", "Midland", ["Midland, TX", "Martin, TX", "Howard, TX", "Glasscock, TX", "Reagan, TX", "Upton, TX"]),
  },
  {
    partnerName: "Continental Resources",
    sites: [
      ...mkSites("Continental", "STACK", ["Kingfisher, OK", "Blaine, OK", "Canadian, OK", "Custer, OK", "Dewey, OK"]),
      ...mkSites("Continental", "SCOOP", ["Grady, OK", "Stephens, OK"]),
    ],
  },
  {
    partnerName: "Matador Resources",
    sites: mkSites("Matador", "Delaware", ["Loving, TX", "Reeves, TX"]),
  },
  {
    partnerName: "SM Energy",
    sites: [
      ...mkSites("SM", "Midland",    ["Howard, TX", "Martin, TX"]),
      ...mkSites("SM", "Eagle Ford", ["Webb, TX", "Dimmit, TX", "Maverick, TX"]),
    ],
  },
  {
    partnerName: "Vital Energy",
    sites: mkSites("Vital", "Midland", ["Howard, TX", "Glasscock, TX", "Reagan, TX", "Upton, TX", "Crockett, TX"]),
  },
  {
    partnerName: "Ovintiv",
    sites: [
      ...mkSites("Ovintiv", "Midland", ["Martin, TX", "Midland, TX"]),
      ...mkSites("Ovintiv", "SCOOP",   ["Grady, OK", "Garvin, OK"]),
    ],
  },
  {
    partnerName: "Civitas Resources",
    sites: [
      ...mkSites("Civitas", "Delaware", ["Reeves, TX"]),
      ...mkSites("Civitas", "Midland",  ["Howard, TX"]),
    ],
  },
  {
    partnerName: "Ring Energy",
    sites: mkSites("Ring", "Central Basin Platform", ["Andrews, TX", "Crane, TX", "Yoakum, TX", "Gaines, TX"]),
  },
  {
    partnerName: "Crownquest Operating",
    sites: mkSites("Crownquest (CrownRock)", "Midland", ["Midland, TX", "Martin, TX", "Andrews, TX", "Howard, TX"]),
  },
];

function generateSiteCode(): string {
  return "SITE-" + randomBytes(4).toString("hex").toUpperCase();
}

async function seedOperator(partnerName: string, sites: SiteSeed[]): Promise<{ inserted: number; skipped: number; missing: boolean }> {
  const partnerRows = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.name, partnerName));
  if (partnerRows.length === 0) {
    console.warn(`  ! partner not found in DB: "${partnerName}" — run seed-permian-basin.ts first; skipping.`);
    return { inserted: 0, skipped: 0, missing: true };
  }
  if (partnerRows.length > 1) {
    // Refuse to seed against an ambiguous partner row — the caller should
    // dedupe first (this is exactly what bit us with Marathon/BP earlier).
    console.warn(
      `  ! AMBIGUOUS: ${partnerRows.length} partner rows found for "${partnerName}" ` +
        `(ids=${partnerRows.map((p) => p.id).join(", ")}). Skipping to avoid splitting sites; ` +
        `dedupe first then rerun.`,
    );
    return { inserted: 0, skipped: 0, missing: true };
  }
  const partner = partnerRows[0]!;

  let inserted = 0;
  let skipped = 0;
  for (const s of sites) {
    const [existing] = await db
      .select({ id: siteLocationsTable.id })
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
  }
  console.log(`  · ${partner.name}: +${inserted} inserted, ${skipped} already present (of ${sites.length} planned)`);
  return { inserted, skipped, missing: false };
}

export type PermianSitesSeedCounts = {
  inserted: number;
  skipped: number;
  missingPartners: string[];
};

export async function seedAllPermianSiteLocations(): Promise<PermianSitesSeedCounts> {
  console.log(`Seeding county-level Permian / Mid-Continent site locations for ${PLAN.length} operators…`);
  let totalInserted = 0;
  let totalSkipped = 0;
  let missing: string[] = [];
  for (const { partnerName, sites } of PLAN) {
    const r = await seedOperator(partnerName, sites);
    totalInserted += r.inserted;
    totalSkipped += r.skipped;
    if (r.missing) missing.push(partnerName);
  }
  console.log("");
  console.log(`Done. +${totalInserted} sites inserted, ${totalSkipped} already present.`);
  if (missing.length) {
    console.log(`Skipped (missing partner rows): ${missing.join(", ")}`);
  }
  return { inserted: totalInserted, skipped: totalSkipped, missingPartners: missing };
}

// Only run when invoked directly (e.g. `tsx scripts/seed-permian-site-locations.ts`),
// not when imported from the test suite.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (await import("node:url"))
    .pathToFileURL(process.argv[1])
    .href === import.meta.url;

if (invokedDirectly) {
  seedAllPermianSiteLocations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
