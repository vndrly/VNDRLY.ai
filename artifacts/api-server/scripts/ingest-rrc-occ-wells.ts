/**
 * Live ingestion of real well/pad coordinates from public RRC + OCC well
 * records, replacing the county-level area anchors created by
 * seed-permian-site-locations.ts and seed-mach-site-locations.ts.
 *
 * Data sources
 * ------------
 *   - Oklahoma Corporation Commission (OCC) — OK wells with per-well
 *     operator attribution. Pulled live from the FracTracker National
 *     Wells AGOL service (Part2_OH_WY layer).
 *   - Texas Railroad Commission (RRC) — TX wells with per-well
 *     operator attribution. Pulled from a pre-joined JSON file
 *     (scripts/data/rrc-tx-operator-wells.json) produced by the sister
 *     batch scripts/build-tx-operator-wells.ts, which downloads RRC's
 *     bulk wellbore.dbf and joins it with OPERATOR.dbf on
 *     OPERATOR_NUMBER. (FracTracker's TX layer omits operator names,
 *     hence the offline join.)
 *   - TX fallback: if the per-well JSON has no rows for a partner but
 *     the partner has a `tx_counties` block, the script falls back to
 *     bbox queries against the FracTracker TX layer around each county
 *     centroid.
 *
 * Pipeline
 * --------
 *   1. Loads scripts/data/operator-name-mappings.json (VNDRLY partner
 *      name -> { ok: <OPERATOR strings>, tx: <RRC OPERATOR_NAME strings>,
 *      tx_counties: <county keys for fallback> }).
 *   2. For each partner with an `ok` block:
 *        - Queries the OK FracTracker layer for wells matching the
 *          OPERATOR strings (paginated, capped per partner).
 *        - Bins each well into one of the partner's seeded OK counties
 *          using the closest TIGER county centroid.
 *        - Inserts each well as a site_locations row with
 *            sourceType='occ', sourceRef='OK:<API>',
 *            siteRadiusMeters=500.
 *        - Marks ONLY the area anchors for counties that received >=1
 *          real well as supersededAt=now() and hidden=true. Counties
 *          with no real wells inserted keep their area anchor.
 *   3. For each partner with a `tx` block:
 *        - Looks up wells in rrc-tx-operator-wells.json whose
 *          operatorName matches one of the partner's RRC operator-name
 *          strings (case-insensitive exact match).
 *        - Bins each well into the closest seeded TX county centroid
 *          (well rows that ship with `county` use it directly).
 *        - Inserts each well as sourceType='rrc', sourceRef='TX:<API>'.
 *        - Marks ONLY the area anchors for counties that received >=1
 *          real well as supersededAt=now() and hidden=true.
 *      If the partner has `tx_counties` but no `tx` (or the JSON has
 *      no matching wells), falls back to per-county bbox queries
 *      against the FracTracker TX layer.
 *
 * Idempotent on (partnerId, sourceRef) thanks to the partial unique
 * index on site_locations. Network failures abort that operator only.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts
 *   pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts --partner "Continental Resources"
 *   pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts --dry-run
 *   pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts --state OK
 *   pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts --state TX
 *
 * Refresh cadence
 * ---------------
 *   FracTracker rebuilds the national wells layers roughly quarterly
 *   from the underlying state agency downloads. Re-running this script
 *   is the intended refresh path — duplicate (partnerId, sourceRef)
 *   rows are skipped, but new wells discovered since the last run are
 *   inserted.
 *
 * Licensing
 * ---------
 *   Source RRC + OCC well records are public records. FracTracker
 *   publishes the compiled feature services under CC-BY 4.0 — see
 *   scripts/README.md for full attribution.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, ilike, isNull, sql } from "drizzle-orm";
import { db, partnersTable, siteLocationsTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// Feature service URLs
// ---------------------------------------------------------------------------

/** OK layer of the FracTracker National Wells AGOL feature service. */
const OK_FEATURE_SERVICE_URL =
  "https://services.arcgis.com/jDGuO8tYggdCCnUJ/arcgis/rest/services/FracTrackerNationalWells_Part2_OH_WY/FeatureServer/0/query";

/** TX layer of the FracTracker National Wells AGOL feature service. */
const TX_FEATURE_SERVICE_URL =
  "https://services.arcgis.com/jDGuO8tYggdCCnUJ/arcgis/rest/services/FracTrackerNationalWells_Part3_TX/FeatureServer/0/query";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Per-operator/state cap for the OK path (OCC has explicit operator names). */
const MAX_WELLS_PER_OPERATOR_OK = 30;

/** Per-operator cap for the TX per-well path (joined RRC roster has explicit operators). */
const MAX_WELLS_PER_OPERATOR_TX = 30;

/** Per (operator, county) cap for the TX bbox fallback (spread coverage). */
const MAX_WELLS_PER_COUNTY_TX = 5;

/** Tighter geofence radius for individual well/pad — vs. 30 km for area anchors. */
const WELL_RADIUS_METERS = 500;

/** ArcGIS REST page size for OK paginated queries. */
const PAGE_SIZE = 200;

/** Half-extent (km) of the TX spatial bbox around each county centroid. */
const TX_BBOX_HALF_KM = 12;

/**
 * Max distance (km) between an OK well and the nearest seeded county
 * centroid for the well to count toward that county's supersession.
 * OK counties are typically ~30-40km wide, so a well >50km from every
 * seeded centroid is too far to confidently attribute to any of them
 * and will NOT trigger supersession (the well is still inserted).
 */
const OK_COUNTY_BIN_MAX_KM = 50;

// ---------------------------------------------------------------------------
// US Census TIGER county centroids — kept in sync with seed scripts.
// Public geographic facts (no licensing).
// ---------------------------------------------------------------------------

type CountyKey = string;
type CountyCentroid = { lat: number; lon: number; state: "TX" | "OK" };

const COUNTY_CENTROIDS: Record<CountyKey, CountyCentroid> = {
  // ── Permian — Delaware Basin (TX side)
  "Loving, TX":     { lat: 31.847, lon: -103.578, state: "TX" },
  "Reeves, TX":     { lat: 31.252, lon: -103.696, state: "TX" },
  "Culberson, TX":  { lat: 31.367, lon: -104.518, state: "TX" },
  "Ward, TX":       { lat: 31.527, lon: -103.135, state: "TX" },
  "Winkler, TX":    { lat: 31.857, lon: -103.044, state: "TX" },
  "Pecos, TX":      { lat: 30.881, lon: -102.733, state: "TX" },
  // ── Permian — Midland Basin
  "Midland, TX":    { lat: 31.870, lon: -102.029, state: "TX" },
  "Martin, TX":     { lat: 32.305, lon: -101.949, state: "TX" },
  "Andrews, TX":    { lat: 32.305, lon: -102.640, state: "TX" },
  "Ector, TX":      { lat: 31.870, lon: -102.541, state: "TX" },
  "Reagan, TX":     { lat: 31.366, lon: -101.521, state: "TX" },
  "Upton, TX":      { lat: 31.371, lon: -102.046, state: "TX" },
  "Glasscock, TX":  { lat: 31.870, lon: -101.518, state: "TX" },
  "Howard, TX":     { lat: 32.305, lon: -101.435, state: "TX" },
  "Borden, TX":     { lat: 32.745, lon: -101.435, state: "TX" },
  "Crockett, TX":   { lat: 30.722, lon: -101.413, state: "TX" },
  // ── Permian — Central Basin Platform
  "Crane, TX":      { lat: 31.426, lon: -102.520, state: "TX" },
  "Yoakum, TX":     { lat: 33.174, lon: -102.825, state: "TX" },
  "Gaines, TX":     { lat: 32.745, lon: -102.638, state: "TX" },
  // ── Eagle Ford
  "Karnes, TX":     { lat: 28.901, lon: -97.858,  state: "TX" },
  "DeWitt, TX":     { lat: 29.083, lon: -97.357,  state: "TX" },
  "Atascosa, TX":   { lat: 28.895, lon: -98.527,  state: "TX" },
  "Gonzales, TX":   { lat: 29.458, lon: -97.490,  state: "TX" },
  "Webb, TX":       { lat: 27.762, lon: -99.331,  state: "TX" },
  "Dimmit, TX":     { lat: 28.422, lon: -99.756,  state: "TX" },
  "Maverick, TX":   { lat: 28.743, lon: -100.314, state: "TX" },
  // ── Texas Panhandle / Western Anadarko (Mach)
  "Hemphill, TX":   { lat: 35.834, lon: -100.270, state: "TX" },
  "Lipscomb, TX":   { lat: 36.278, lon: -100.275, state: "TX" },
  "Wheeler, TX":    { lat: 35.402, lon: -100.270, state: "TX" },
  "Roberts, TX":    { lat: 35.840, lon: -100.815, state: "TX" },
  "Ochiltree, TX":  { lat: 36.278, lon: -100.815, state: "TX" },
  // ── Mid-Continent (OK)
  "Kingfisher, OK": { lat: 35.953, lon: -97.940,  state: "OK" },
  "Canadian, OK":   { lat: 35.541, lon: -97.987,  state: "OK" },
  "Blaine, OK":     { lat: 35.880, lon: -98.435,  state: "OK" },
  "Dewey, OK":      { lat: 35.985, lon: -99.003,  state: "OK" },
  "Custer, OK":     { lat: 35.617, lon: -98.972,  state: "OK" },
  "Grady, OK":      { lat: 35.022, lon: -97.853,  state: "OK" },
  "Garvin, OK":     { lat: 34.706, lon: -97.310,  state: "OK" },
  "Stephens, OK":   { lat: 34.479, lon: -97.853,  state: "OK" },
  "Major, OK":      { lat: 36.305, lon: -98.553,  state: "OK" },
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
function flagValue(name: string): string | null {
  const idx = argv.indexOf(name);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1]! : null;
}
const PARTNER_FILTER = flagValue("--partner");
const STATE_FILTER = (flagValue("--state") ?? "").toUpperCase(); // "OK", "TX", or ""

// ---------------------------------------------------------------------------
// Mapping file
// ---------------------------------------------------------------------------

type OperatorMapping = Record<
  string,
  {
    /** OK: per-well attribution via FracTracker OPERATOR strings. */
    ok?: string[];
    /** TX: per-well attribution via canonical RRC OPERATOR_NAME strings. */
    tx?: string[];
    /** TX: county-bbox fallback when `tx` is empty or returns nothing. */
    tx_counties?: string[];
  }
>;

function loadMapping(): OperatorMapping {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, "data", "operator-name-mappings.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const out: OperatorMapping = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    out[k] = v as OperatorMapping[string];
  }
  return out;
}

// ---------------------------------------------------------------------------
// TX per-well JSON (produced by scripts/build-tx-operator-wells.ts)
// ---------------------------------------------------------------------------

type RrcTxOperatorWell = {
  apiNumber: string;
  operatorNumber: string;
  operatorName: string;
  lat: number;
  lon: number;
  county: string | null;
  state: "TX";
  attribution: "rrc-dbf-join" | "fractracker-spatial";
};

type TxWellsDoc = {
  _generatedAt?: string;
  _source?: string;
  _recordCount?: number;
  wells: RrcTxOperatorWell[];
};

let _txWellsCache: RrcTxOperatorWell[] | null = null;
let _txWellsByOperator: Map<string, RrcTxOperatorWell[]> | null = null;
let _txWellsByApi: Map<string, RrcTxOperatorWell> | null = null;
let _txDocSource = "";

function loadTxWellsJson(): RrcTxOperatorWell[] {
  if (_txWellsCache !== null) return _txWellsCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, "data", "rrc-tx-operator-wells.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    console.warn(
      `  [tx] rrc-tx-operator-wells.json missing — TX per-well path disabled. ` +
        `Run: pnpm --filter @workspace/api-server exec tsx scripts/build-tx-operator-wells.ts`,
    );
    _txWellsCache = [];
    _txWellsByOperator = new Map();
    _txWellsByApi = new Map();
    return _txWellsCache;
  }
  const doc = JSON.parse(raw) as TxWellsDoc;
  _txDocSource = doc._source ?? "(unknown)";
  if (_txDocSource === "fractracker-spatial") {
    console.warn(
      `  [tx] WARNING: rrc-tx-operator-wells.json was built from the FracTracker ` +
        `fallback (county-level proxy), not the canonical RRC dbf join. ` +
        `Per-well operator attribution is provisional. ` +
        `Re-run scripts/build-tx-operator-wells.ts (no --fallback-source flag) ` +
        `with the RRC wellbore.dbf + OPERATOR.dbf to upgrade.`,
    );
  }
  _txWellsCache = doc.wells ?? [];
  _txWellsByOperator = new Map();
  _txWellsByApi = new Map();
  for (const w of _txWellsCache) {
    const key = w.operatorName.trim().toUpperCase();
    let bucket = _txWellsByOperator.get(key);
    if (!bucket) {
      bucket = [];
      _txWellsByOperator.set(key, bucket);
    }
    bucket.push(w);
    _txWellsByApi.set(w.apiNumber, w);
  }
  return _txWellsCache;
}

/**
 * Look up TX wells from the pre-joined RRC roster by RRC API number.
 * Mirrors the OK helper's role for the per-well attribution path.
 * Wells whose API number is not present in the JSON are silently dropped.
 */
function fetchTxWellsForApiNumbers(apiNumbers: string[]): RrcTxOperatorWell[] {
  loadTxWellsJson();
  const out: RrcTxOperatorWell[] = [];
  if (!_txWellsByApi) return out;
  for (const api of apiNumbers) {
    const w = _txWellsByApi.get(api);
    if (w) out.push(w);
  }
  return out;
}

/**
 * Look up the API numbers of all TX wells whose operator name matches
 * one of the supplied canonical RRC OPERATOR_NAME strings (case-insensitive
 * exact match). Used by the ingest path to translate the partner's
 * mapping entry into the API list passed to fetchTxWellsForApiNumbers.
 */
function txApiNumbersForOperatorStrings(
  operatorStrings: string[],
  cap: number,
): string[] {
  loadTxWellsJson();
  const out: string[] = [];
  if (!_txWellsByOperator) return out;
  const seen = new Set<string>();
  for (const op of operatorStrings) {
    const key = op.trim().toUpperCase();
    const bucket = _txWellsByOperator.get(key) ?? [];
    for (const w of bucket) {
      if (out.length >= cap) break;
      if (seen.has(w.apiNumber)) continue;
      seen.add(w.apiNumber);
      out.push(w.apiNumber);
    }
    if (out.length >= cap) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// FracTracker queries
// ---------------------------------------------------------------------------

function escapeSqlLiteral(v: string): string {
  return v.replace(/'/g, "''");
}

type OkWellAttrs = {
  OBJECTID: number;
  State: string | null;
  API: number | null;
  Name: string | null;
  Operator: string | null;
  SpudDt: string | null;
  Status: string | null;
  Type: string | null;
  Lat: number | null;
  Long: number | null;
};

/** Query OK wells for one OPERATOR string (paginated). */
async function fetchOkWellsForOperatorString(
  operatorString: string,
  cap: number,
): Promise<OkWellAttrs[]> {
  const out: OkWellAttrs[] = [];
  let offset = 0;
  const where =
    `State='OK' AND UPPER(Operator)=UPPER('${escapeSqlLiteral(operatorString)}') ` +
    `AND Lat IS NOT NULL AND Long IS NOT NULL`;
  while (out.length < cap) {
    const params = new URLSearchParams({
      where,
      outFields: "OBJECTID,State,API,Name,Operator,SpudDt,Status,Type,Lat,Long",
      returnGeometry: "false",
      f: "json",
      resultRecordCount: String(Math.min(PAGE_SIZE, cap - out.length)),
      resultOffset: String(offset),
      orderByFields: "OBJECTID ASC",
    });
    const url = `${OK_FEATURE_SERVICE_URL}?${params.toString()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(
        `FracTracker OK query failed ${res.status} for "${operatorString}": ${await res.text().catch(() => "")}`,
      );
    }
    const json = (await res.json()) as { features?: { attributes: OkWellAttrs }[]; error?: { message: string } };
    if (json.error) throw new Error(`FracTracker OK error: ${json.error.message}`);
    const features = json.features ?? [];
    if (features.length === 0) break;
    for (const f of features) {
      if (out.length >= cap) break;
      out.push(f.attributes);
    }
    if (features.length < PAGE_SIZE) break;
    offset += features.length;
  }
  return out;
}

type TxWellAttrs = {
  OBJECTID: number;
  API: number | null;
  Lat: number | null;
  Long: number | null;
  Type: string | null;
  Status: string | null;
};

/** Query TX wells inside a lon/lat bbox. */
async function fetchTxWellsInBbox(
  centroid: { lat: number; lon: number },
  halfKm: number,
  cap: number,
): Promise<TxWellAttrs[]> {
  const dLat = halfKm / 111;
  const dLon = halfKm / (111 * Math.cos((centroid.lat * Math.PI) / 180));
  const xmin = centroid.lon - dLon;
  const xmax = centroid.lon + dLon;
  const ymin = centroid.lat - dLat;
  const ymax = centroid.lat + dLat;
  const params = new URLSearchParams({
    where: "Lat IS NOT NULL AND Long IS NOT NULL",
    geometry: `${xmin},${ymin},${xmax},${ymax}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,API,Lat,Long,Type,Status",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: String(cap),
    orderByFields: "OBJECTID ASC",
  });
  const url = `${TX_FEATURE_SERVICE_URL}?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `FracTracker TX query failed ${res.status} at (${centroid.lat},${centroid.lon}): ${await res
        .text()
        .catch(() => "")}`,
    );
  }
  const json = (await res.json()) as { features?: { attributes: TxWellAttrs }[]; error?: { message: string } };
  if (json.error) throw new Error(`FracTracker TX error: ${json.error.message}`);
  return (json.features ?? []).map((f) => f.attributes).filter((a) => a.API != null && a.Lat != null && a.Long != null);
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Bin a well into the closest county from the candidate set.
 * Returns null if no candidate is within `maxKm` (so the well is not
 * confidently attributable to any of the seeded counties).
 */
function nearestCounty(
  pt: { lat: number; lon: number },
  candidates: CountyKey[],
  maxKm: number,
): CountyKey | null {
  let best: { key: CountyKey; dKm: number } | null = null;
  for (const key of candidates) {
    const c = COUNTY_CENTROIDS[key];
    if (!c) continue;
    const d = haversineKm(pt, { lat: c.lat, lon: c.lon });
    if (!best || d < best.dKm) best = { key, dKm: d };
  }
  if (!best) return null;
  return best.dKm <= maxKm ? best.key : null;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function generateSiteCode(): string {
  return "SITE-" + randomBytes(4).toString("hex").toUpperCase();
}

async function lookupPartner(partnerName: string): Promise<{ id: number; name: string } | string> {
  const rows = await db
    .select({ id: partnersTable.id, name: partnersTable.name })
    .from(partnersTable)
    .where(eq(partnersTable.name, partnerName));
  if (rows.length === 0) return `partner not found in DB: "${partnerName}"`;
  if (rows.length > 1)
    return `AMBIGUOUS partner: ${rows.length} rows for "${partnerName}" (ids=${rows.map((r) => r.id).join(", ")})`;
  return rows[0]!;
}

async function siteRefExists(partnerId: number, sourceRef: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: siteLocationsTable.id })
    .from(siteLocationsTable)
    .where(
      and(
        eq(siteLocationsTable.partnerId, partnerId),
        eq(siteLocationsTable.sourceRef, sourceRef),
      ),
    )
    .limit(1);
  return Boolean(existing);
}

/** Supersede area anchors for a single (partner, county). Matches on name LIKE. */
async function supersedeCountyAnchor(
  partnerId: number,
  countyKey: CountyKey,
  state: "TX" | "OK",
): Promise<number> {
  const countyPlain = countyKey.split(",")[0]!.trim(); // "Loving"
  const rows = await db
    .update(siteLocationsTable)
    .set({ supersededAt: new Date(), hidden: true })
    .where(
      and(
        eq(siteLocationsTable.partnerId, partnerId),
        eq(siteLocationsTable.sourceType, "area-anchor"),
        eq(siteLocationsTable.state, state),
        ilike(siteLocationsTable.name, `%${countyPlain} County%`),
        isNull(siteLocationsTable.supersededAt),
      ),
    )
    .returning({ id: siteLocationsTable.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Per-partner ingestion
// ---------------------------------------------------------------------------

type Outcome = {
  partnerName: string;
  state: "OK" | "TX";
  fetched: number;
  inserted: number;
  skipped: number;
  superseded: number;
  countiesWithRealWells: string[];
  errors: string[];
};

function newOutcome(partnerName: string, state: "OK" | "TX"): Outcome {
  return {
    partnerName,
    state,
    fetched: 0,
    inserted: 0,
    skipped: 0,
    superseded: 0,
    countiesWithRealWells: [],
    errors: [],
  };
}

async function ingestOk(
  partnerName: string,
  operatorStrings: string[],
): Promise<Outcome> {
  const o = newOutcome(partnerName, "OK");
  const partner = await lookupPartner(partnerName);
  if (typeof partner === "string") {
    o.errors.push(partner);
    return o;
  }

  // Look up the partner's existing OK area anchors so we know which
  // counties are valid bins (and which to supersede on success).
  const okAnchors = await db
    .select({ id: siteLocationsTable.id, name: siteLocationsTable.name })
    .from(siteLocationsTable)
    .where(
      and(
        eq(siteLocationsTable.partnerId, partner.id),
        eq(siteLocationsTable.sourceType, "area-anchor"),
        eq(siteLocationsTable.state, "OK"),
      ),
    );
  // Derive candidate OK county keys from anchor names ("Mach STACK — Kingfisher County, OK").
  const candidateCounties: CountyKey[] = [];
  for (const a of okAnchors) {
    for (const key of Object.keys(COUNTY_CENTROIDS)) {
      if (!key.endsWith(", OK")) continue;
      const plain = key.split(",")[0]!.trim();
      if (a.name.includes(`${plain} County`)) {
        if (!candidateCounties.includes(key)) candidateCounties.push(key);
      }
    }
  }
  // If the partner has no seeded OK counties, we still ingest (best-effort
  // bin to nearest known OK county) but supersede nothing.
  const binCandidates =
    candidateCounties.length > 0
      ? candidateCounties
      : Object.keys(COUNTY_CENTROIDS).filter((k) => k.endsWith(", OK"));

  // Fetch wells across all operator-name variants, dedup by API.
  const collected: OkWellAttrs[] = [];
  const seenApis = new Set<number>();
  for (const opStr of operatorStrings) {
    if (collected.length >= MAX_WELLS_PER_OPERATOR_OK) break;
    let batch: OkWellAttrs[];
    try {
      batch = await fetchOkWellsForOperatorString(
        opStr,
        MAX_WELLS_PER_OPERATOR_OK - collected.length,
      );
    } catch (err) {
      o.errors.push(`fetch "${opStr}": ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const w of batch) {
      if (w.API == null || w.Lat == null || w.Long == null) continue;
      if (seenApis.has(w.API)) continue;
      seenApis.add(w.API);
      collected.push(w);
      if (collected.length >= MAX_WELLS_PER_OPERATOR_OK) break;
    }
  }
  o.fetched = collected.length;

  if (collected.length === 0) return o;

  // Bin each well into a county; track which counties got coverage.
  const countiesWithWells = new Set<CountyKey>();
  type Binned = { well: OkWellAttrs; county: CountyKey | null };
  const binned: Binned[] = collected.map((w) => ({
    well: w,
    county: nearestCounty(
      { lat: w.Lat!, lon: w.Long! },
      binCandidates,
      OK_COUNTY_BIN_MAX_KM,
    ),
  }));
  for (const b of binned) if (b.county) countiesWithWells.add(b.county);

  if (DRY_RUN) {
    console.log(`  [DRY] OK: would insert ${collected.length} wells for "${partnerName}"`);
    console.log(
      `        counties with real wells: ${[...countiesWithWells].join(", ") || "(none binned)"}`,
    );
    o.countiesWithRealWells = [...countiesWithWells];
    return o;
  }

  for (const b of binned) {
    const w = b.well;
    const sourceRef = `OK:${w.API}`;
    if (await siteRefExists(partner.id, sourceRef)) {
      o.skipped++;
      continue;
    }
    const wellLabel = w.Name?.trim() || `API ${w.API}`;
    const countyTag = b.county ? ` · ${b.county.split(",")[0]} County` : "";
    await db.insert(siteLocationsTable).values({
      partnerId: partner.id,
      name: `${partnerName} — ${wellLabel} (OK)`,
      address:
        `OK · API ${w.API}${countyTag} · lat ${w.Lat!.toFixed(5)}, lon ${w.Long!.toFixed(5)} ` +
        `· Source: OCC well record via FracTracker (CC-BY 4.0)`,
      latitude: w.Lat!,
      longitude: w.Long!,
      state: "OK",
      siteRadiusMeters: WELL_RADIUS_METERS,
      siteCode: generateSiteCode(),
      sourceType: "occ",
      sourceRef,
    });
    o.inserted++;
  }

  // Supersede ONLY the county anchors that received >=1 real well.
  for (const c of countiesWithWells) {
    o.superseded += await supersedeCountyAnchor(partner.id, c, "OK");
  }
  o.countiesWithRealWells = [...countiesWithWells];
  return o;
}

/**
 * TX per-well attribution path. Mirrors ingestOk:
 *   - Resolves the partner's RRC OPERATOR_NAME strings to a deduplicated
 *     list of API numbers via the pre-joined JSON.
 *   - Fetches the well rows for those APIs.
 *   - Bins each well into the closest seeded TX county (uses the well's
 *     own `county` field when present and seeded; otherwise falls back
 *     to nearest-centroid binning).
 *   - Inserts as sourceType='rrc', sourceRef='TX:<API>'.
 *   - Marks ONLY the area anchors for counties that received >=1 real
 *     well as supersededAt+hidden.
 */
async function ingestTxFromOperators(
  partnerName: string,
  operatorStrings: string[],
  countyHints: CountyKey[],
): Promise<Outcome> {
  const o = newOutcome(partnerName, "TX");
  const partner = await lookupPartner(partnerName);
  if (typeof partner === "string") {
    o.errors.push(partner);
    return o;
  }

  // Look up the partner's existing TX area anchors so we know which
  // counties are valid bins / candidates for supersession.
  const txAnchors = await db
    .select({ id: siteLocationsTable.id, name: siteLocationsTable.name })
    .from(siteLocationsTable)
    .where(
      and(
        eq(siteLocationsTable.partnerId, partner.id),
        eq(siteLocationsTable.sourceType, "area-anchor"),
        eq(siteLocationsTable.state, "TX"),
      ),
    );
  const candidateCounties: CountyKey[] = [];
  for (const a of txAnchors) {
    for (const key of Object.keys(COUNTY_CENTROIDS)) {
      if (!key.endsWith(", TX")) continue;
      const plain = key.split(",")[0]!.trim();
      if (a.name.includes(`${plain} County`)) {
        if (!candidateCounties.includes(key)) candidateCounties.push(key);
      }
    }
  }
  // If the partner has no seeded TX anchors, fall back to its disclosed
  // core counties (so we can still bin and supersede correctly).
  for (const key of countyHints) {
    if (!candidateCounties.includes(key) && COUNTY_CENTROIDS[key]) {
      candidateCounties.push(key);
    }
  }
  const binCandidates =
    candidateCounties.length > 0
      ? candidateCounties
      : Object.keys(COUNTY_CENTROIDS).filter((k) => k.endsWith(", TX"));

  // Resolve operator strings → API numbers via the pre-joined JSON.
  const apiNumbers = txApiNumbersForOperatorStrings(
    operatorStrings,
    MAX_WELLS_PER_OPERATOR_TX,
  );
  const collected = fetchTxWellsForApiNumbers(apiNumbers);
  o.fetched = collected.length;

  if (collected.length === 0) {
    o.errors.push(
      `no rows in rrc-tx-operator-wells.json match operator string(s): ${operatorStrings.join(", ")}`,
    );
    return o;
  }

  // Bin each well; honor the well's own county field when it matches a
  // seeded county; otherwise nearest-centroid bin.
  const countiesWithWells = new Set<CountyKey>();
  type Binned = { well: RrcTxOperatorWell; county: CountyKey | null };
  const binned: Binned[] = collected.map((w) => {
    let county: CountyKey | null = null;
    if (w.county) {
      const candidate = `${w.county}, TX` as CountyKey;
      if (binCandidates.includes(candidate)) county = candidate;
    }
    if (!county) {
      county = nearestCounty(
        { lat: w.lat, lon: w.lon },
        binCandidates,
        OK_COUNTY_BIN_MAX_KM,
      );
    }
    return { well: w, county };
  });
  for (const b of binned) if (b.county) countiesWithWells.add(b.county);

  if (DRY_RUN) {
    console.log(`  [DRY] TX: would insert ${collected.length} wells for "${partnerName}"`);
    console.log(
      `        counties with real wells: ${[...countiesWithWells].join(", ") || "(none binned)"}`,
    );
    console.log(`        TX-JSON source: ${_txDocSource}`);
    o.countiesWithRealWells = [...countiesWithWells];
    return o;
  }

  for (const b of binned) {
    const w = b.well;
    const sourceRef = `TX:${w.apiNumber}`;
    if (await siteRefExists(partner.id, sourceRef)) {
      o.skipped++;
      continue;
    }
    const countyTag = b.county ? ` · ${b.county.split(",")[0]} County` : "";
    const attributionTag =
      w.attribution === "rrc-dbf-join"
        ? "RRC wellbore.dbf ⨝ OPERATOR.dbf join (per-well operator)"
        : "FracTracker spatial fallback (county-disclosure attribution)";
    await db.insert(siteLocationsTable).values({
      partnerId: partner.id,
      name: `${partnerName} — RRC Pad ${w.apiNumber} (${
        b.county ? b.county.split(",")[0] : w.county ?? "TX"
      } Co, TX)`,
      address:
        `TX · API ${w.apiNumber} · OPERATOR_NUMBER ${w.operatorNumber} · ${w.operatorName}` +
        `${countyTag} · lat ${w.lat.toFixed(5)}, lon ${w.lon.toFixed(5)} ` +
        `· Source: ${attributionTag}`,
      latitude: w.lat,
      longitude: w.lon,
      state: "TX",
      siteRadiusMeters: WELL_RADIUS_METERS,
      siteCode: generateSiteCode(),
      sourceType: "rrc",
      sourceRef,
    });
    o.inserted++;
  }

  for (const c of countiesWithWells) {
    o.superseded += await supersedeCountyAnchor(partner.id, c, "TX");
  }
  o.countiesWithRealWells = [...countiesWithWells];
  return o;
}

/**
 * TX county-bbox fallback path. Used only when the partner has no `tx`
 * operator-name strings (or none of them resolved to wells in the JSON)
 * but does have a `tx_counties` block. This is the original pre-#444
 * behavior, kept as a safety net.
 */
async function ingestTxFromCounties(
  partnerName: string,
  countyKeys: CountyKey[],
): Promise<Outcome> {
  const o = newOutcome(partnerName, "TX");
  const partner = await lookupPartner(partnerName);
  if (typeof partner === "string") {
    o.errors.push(partner);
    return o;
  }

  const countiesWithWells = new Set<CountyKey>();
  type Pending = {
    county: CountyKey;
    well: TxWellAttrs;
    sourceRef: string;
  };
  const pending: Pending[] = [];
  const seenApis = new Set<number>();

  for (const county of countyKeys) {
    const c = COUNTY_CENTROIDS[county];
    if (!c) {
      o.errors.push(`unknown TX county key in mapping: "${county}"`);
      continue;
    }
    let wells: TxWellAttrs[];
    try {
      wells = await fetchTxWellsInBbox(
        { lat: c.lat, lon: c.lon },
        TX_BBOX_HALF_KM,
        MAX_WELLS_PER_COUNTY_TX * 4, // request extra; dedup may shrink
      );
    } catch (err) {
      o.errors.push(`TX bbox "${county}": ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    let countTaken = 0;
    for (const w of wells) {
      if (countTaken >= MAX_WELLS_PER_COUNTY_TX) break;
      if (w.API == null || w.Lat == null || w.Long == null) continue;
      if (seenApis.has(w.API)) continue;
      seenApis.add(w.API);
      pending.push({ county, well: w, sourceRef: `TX:${w.API}` });
      countiesWithWells.add(county);
      countTaken++;
    }
    o.fetched += countTaken;
  }

  if (pending.length === 0) return o;

  if (DRY_RUN) {
    console.log(`  [DRY] TX(fallback): would insert ${pending.length} wells for "${partnerName}"`);
    console.log(`        counties with real wells: ${[...countiesWithWells].join(", ")}`);
    o.countiesWithRealWells = [...countiesWithWells];
    return o;
  }

  for (const p of pending) {
    if (await siteRefExists(partner.id, p.sourceRef)) {
      o.skipped++;
      continue;
    }
    const countyName = p.county.split(",")[0]!.trim();
    const w = p.well;
    await db.insert(siteLocationsTable).values({
      partnerId: partner.id,
      name: `${partnerName} — RRC Pad ${w.API} (${countyName} Co, TX)`,
      address:
        `TX · API ${w.API} · ${countyName} County · lat ${w.Lat!.toFixed(5)}, lon ${w.Long!.toFixed(5)} ` +
        `· Source: RRC well record via FracTracker (CC-BY 4.0). Operator attribution by ` +
        `${partnerName}'s disclosed core county (10-K); per-well operator merge is a follow-on.`,
      latitude: w.Lat!,
      longitude: w.Long!,
      state: "TX",
      siteRadiusMeters: WELL_RADIUS_METERS,
      siteCode: generateSiteCode(),
      sourceType: "rrc",
      sourceRef: p.sourceRef,
    });
    o.inserted++;
  }

  for (const c of countiesWithWells) {
    o.superseded += await supersedeCountyAnchor(partner.id, c, "TX");
  }
  o.countiesWithRealWells = [...countiesWithWells];
  return o;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const mapping = loadMapping();
  const partnerNames = Object.keys(mapping).filter((n) =>
    PARTNER_FILTER ? n === PARTNER_FILTER : true,
  );
  if (partnerNames.length === 0) {
    console.error(
      `No partners to ingest. Mapping has ${Object.keys(mapping).length} partners; ` +
        `--partner filter "${PARTNER_FILTER}" matched none.`,
    );
    process.exit(1);
  }

  console.log(
    `Ingesting RRC/OCC well coordinates for ${partnerNames.length} partner(s)${
      DRY_RUN ? " [DRY-RUN]" : ""
    }${STATE_FILTER ? ` [state=${STATE_FILTER}]` : ""}…`,
  );
  console.log(`  OK cap per operator:    ${MAX_WELLS_PER_OPERATOR_OK}`);
  console.log(`  TX cap per county:      ${MAX_WELLS_PER_COUNTY_TX}`);
  console.log(`  TX bbox half-extent:    ${TX_BBOX_HALF_KM} km`);
  console.log(`  well geofence radius:   ${WELL_RADIUS_METERS} m`);
  console.log("");

  const outcomes: Outcome[] = [];
  for (const partnerName of partnerNames) {
    const m = mapping[partnerName]!;

    if ((!STATE_FILTER || STATE_FILTER === "OK") && m.ok && m.ok.length > 0) {
      console.log(`· ${partnerName}  (OK, via [${m.ok.join(", ")}])`);
      const r = await ingestOk(partnerName, m.ok);
      console.log(
        `    fetched=${r.fetched}  inserted=${r.inserted}  skipped=${r.skipped}  ` +
          `superseded=${r.superseded}  counties=${r.countiesWithRealWells.length}  errors=${r.errors.length}`,
      );
      for (const e of r.errors) console.log(`      ! ${e}`);
      outcomes.push(r);
    }

    if (!STATE_FILTER || STATE_FILTER === "TX") {
      const txOps = m.tx ?? [];
      const txCounties = m.tx_counties ?? [];
      // Prefer the per-well attribution path (RRC dbf join) when the
      // partner has operator-name strings AND the JSON has matching wells.
      let txRan = false;
      if (txOps.length > 0) {
        console.log(`· ${partnerName}  (TX per-well, via [${txOps.join(", ")}])`);
        const r = await ingestTxFromOperators(partnerName, txOps, txCounties);
        console.log(
          `    fetched=${r.fetched}  inserted=${r.inserted}  skipped=${r.skipped}  ` +
            `superseded=${r.superseded}  counties=${r.countiesWithRealWells.length}  errors=${r.errors.length}`,
        );
        for (const e of r.errors) console.log(`      ! ${e}`);
        outcomes.push(r);
        // If the per-well path produced nothing, fall back to the bbox path.
        txRan = r.fetched > 0;
      }
      if (!txRan && txCounties.length > 0) {
        console.log(`· ${partnerName}  (TX bbox fallback, ${txCounties.length} core counties)`);
        const r = await ingestTxFromCounties(partnerName, txCounties);
        console.log(
          `    fetched=${r.fetched}  inserted=${r.inserted}  skipped=${r.skipped}  ` +
            `superseded=${r.superseded}  counties=${r.countiesWithRealWells.length}  errors=${r.errors.length}`,
        );
        for (const e of r.errors) console.log(`      ! ${e}`);
        outcomes.push(r);
      }
    }
  }

  // ---- Final summary ----
  console.log("");
  console.log("Summary:");
  let tIns = 0, tSkip = 0, tSup = 0, tErr = 0, tFetch = 0;
  for (const o of outcomes) {
    tIns += o.inserted;
    tSkip += o.skipped;
    tSup += o.superseded;
    tErr += o.errors.length;
    tFetch += o.fetched;
  }
  console.log(
    `  fetched=${tFetch}  inserted=${tIns}  skipped(existing)=${tSkip}  ` +
      `area-anchors superseded=${tSup}  errors=${tErr}`,
  );
  if (DRY_RUN) console.log("  (DRY-RUN: no rows written)");

  if (!DRY_RUN) {
    const counts = await db
      .select({
        sourceType: siteLocationsTable.sourceType,
        n: sql<number>`COUNT(*)::int`.as("n"),
      })
      .from(siteLocationsTable)
      .groupBy(siteLocationsTable.sourceType);
    console.log(`  site_locations breakdown by source_type:`);
    for (const c of counts) console.log(`    ${c.sourceType}: ${c.n}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
