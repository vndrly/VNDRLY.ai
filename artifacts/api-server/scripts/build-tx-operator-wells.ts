/**
 * One-shot batch that produces a per-well, operator-attributed roster of
 * Texas Railroad Commission (RRC) wells, written to:
 *
 *     scripts/data/rrc-tx-operator-wells.json
 *
 * Why this exists
 * ---------------
 *   The OK side of the well-ingestion pipeline (ingest-rrc-occ-wells.ts)
 *   has per-well operator attribution because the OCC tags each well with
 *   the operator name. The TX side does not — RRC's bulk wellbore.dbf
 *   only records an OPERATOR_NUMBER (the P-5 number). The actual operator
 *   name lives in a separate OPERATOR.dbf.
 *
 *   This script joins those two files and emits a flat JSON file with
 *   { apiNumber, operatorNumber, operatorName, lat, lon, county, state }
 *   per well, which the ingest pipeline consumes via
 *   fetchTxWellsForApiNumbers().
 *
 * Source files
 * ------------
 *   wellbore.dbf    Texas Railroad Commission, Digital Map Information
 *                   bulk wellbore download (statewide). Public records.
 *   OPERATOR.dbf    Texas Railroad Commission, Operator master file.
 *                   Joins to wellbore.dbf on OPERATOR_NUMBER (a.k.a.
 *                   "P-5 number"). Public records.
 *
 *   Both are published at https://mft.rrc.texas.gov/ under "Public
 *   Datasets" → "Oil and Gas". The portal requires interactive
 *   navigation to obtain the actual download URLs (an Alfresco-style
 *   share with rotating links), so this script accepts local file paths.
 *
 * Field assumptions (RRC schema, current as of 2026)
 * --------------------------------------------------
 *   wellbore.dbf
 *     API_NUMBER         text   (14-digit RRC API, e.g. "42301345670000")
 *     OPERATOR_NUMBER    text   (6-digit P-5)
 *     SURFACE_LATITUDE   number (decimal degrees, NAD83)
 *     SURFACE_LONGITUDE  number (decimal degrees, NAD83; usually negative)
 *     COUNTY_NAME        text   ("LOVING", "REEVES", ...; uppercase)
 *     WELL_STATUS        text   (optional)
 *
 *   OPERATOR.dbf
 *     OPERATOR_NUMBER    text   (join key)
 *     OPERATOR_NAME      text   ("EXXONMOBIL OIL CORP", ...)
 *
 *   The actual column names vary slightly between RRC dbf vintages
 *   (e.g. WELLBORE_API_NUMBER vs API_NUMBER). The script normalizes by
 *   accepting any of a small list of known aliases per field.
 *
 * Fallback path (no DBF available)
 * --------------------------------
 *   Some environments (CI, dev sandboxes) cannot reach the RRC MFT
 *   portal. To keep the JSON file populated with real coordinates in
 *   those cases, --fallback-source fractracker generates a best-effort
 *   roster by:
 *     1. Reading scripts/data/operator-name-mappings.json to find every
 *        partner that has both a `tx_counties` array (where their ops
 *        are publicly disclosed) AND a `tx_operators` array (their
 *        canonical RRC operator-name strings).
 *     2. For each disclosed core county, fetching real well coordinates
 *        from the FracTracker TX layer via a tight bbox query.
 *     3. Labeling each well with the partner's first canonical operator
 *        name. Each record carries `attribution: "fractracker-spatial"`
 *        so downstream consumers can distinguish.
 *
 *   When the real dbf join is run, it OVERWRITES the JSON with
 *   `attribution: "rrc-dbf-join"` records.
 *
 * Run with
 * --------
 *   # Real path: dbf files are already on disk
 *   pnpm --filter @workspace/api-server exec tsx scripts/build-tx-operator-wells.ts \
 *     --wellbore /path/to/wellbore.dbf \
 *     --operator /path/to/OPERATOR.dbf
 *
 *   # Fallback path: no dbf access (CI / sandbox)
 *   pnpm --filter @workspace/api-server exec tsx scripts/build-tx-operator-wells.ts \
 *     --fallback-source fractracker
 *
 * Idempotent: always overwrites scripts/data/rrc-tx-operator-wells.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DBFFile } from "dbffile";

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export type RrcTxOperatorWell = {
  apiNumber: string;
  operatorNumber: string;
  operatorName: string;
  lat: number;
  lon: number;
  county: string | null;
  state: "TX";
  attribution: "rrc-dbf-join" | "fractracker-spatial";
};

type OutputDoc = {
  _README: string;
  _generatedAt: string;
  _source: "rrc-dbf-join" | "fractracker-spatial";
  _recordCount: number;
  _operatorBreakdown: { operatorName: string; wells: number }[];
  wells: RrcTxOperatorWell[];
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
}

const WELLBORE_DBF = flag("--wellbore");
const OPERATOR_DBF = flag("--operator");
const FALLBACK_SOURCE = flag("--fallback-source"); // "fractracker"
const PER_OPERATOR_CAP = parseInt(flag("--cap") ?? "60", 10);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(HERE, "data", "rrc-tx-operator-wells.json");
const MAPPING_PATH = path.join(HERE, "data", "operator-name-mappings.json");

// ---------------------------------------------------------------------------
// DBF column-name aliases (RRC schema vintages differ)
// ---------------------------------------------------------------------------

const WELLBORE_FIELD_ALIASES = {
  apiNumber: ["API_NUMBER", "WELLBORE_API_NUMBER", "API_NO", "API"],
  operatorNumber: ["OPERATOR_NUMBER", "OPERATOR_NO", "OPER_NO", "OPNO"],
  lat: ["SURFACE_LATITUDE", "SURF_LAT", "LATITUDE", "LAT"],
  lon: ["SURFACE_LONGITUDE", "SURF_LON", "SURF_LONG", "LONGITUDE", "LON", "LONG"],
  county: ["COUNTY_NAME", "COUNTY"],
} as const;

const OPERATOR_FIELD_ALIASES = {
  operatorNumber: ["OPERATOR_NUMBER", "OPERATOR_NO", "OPER_NO", "OPNO"],
  operatorName: ["OPERATOR_NAME", "OPER_NAME", "NAME"],
} as const;

function pickField(
  row: Record<string, unknown>,
  aliases: readonly string[],
): unknown {
  for (const a of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, a) && row[a] != null) {
      return row[a];
    }
    // Some DBF readers lowercase field names.
    const lower = a.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(row, lower) && row[lower] != null) {
      return row[lower];
    }
  }
  return null;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Real path: parse + join two RRC dbf files
// ---------------------------------------------------------------------------

async function buildFromDbf(): Promise<RrcTxOperatorWell[]> {
  if (!WELLBORE_DBF || !OPERATOR_DBF) {
    throw new Error(
      "Both --wellbore and --operator paths are required for the dbf-join path. " +
        "Pass --fallback-source fractracker to use the FracTracker stand-in instead.",
    );
  }

  console.log(`Reading OPERATOR.dbf  : ${OPERATOR_DBF}`);
  const operatorDbf = await DBFFile.open(OPERATOR_DBF);
  const operatorById = new Map<string, string>();
  const operatorRows = await operatorDbf.readRecords();
  for (const row of operatorRows) {
    const r = row as Record<string, unknown>;
    const num = asString(pickField(r, OPERATOR_FIELD_ALIASES.operatorNumber));
    const name = asString(pickField(r, OPERATOR_FIELD_ALIASES.operatorName));
    if (!num || !name) continue;
    operatorById.set(num.padStart(6, "0"), name);
  }
  console.log(`  parsed ${operatorById.size} operator-name rows`);

  console.log(`Reading wellbore.dbf  : ${WELLBORE_DBF}`);
  const wellboreDbf = await DBFFile.open(WELLBORE_DBF);
  const wells: RrcTxOperatorWell[] = [];
  let scanned = 0;
  let kept = 0;
  let rejectedNoCoords = 0;
  let rejectedNoOperator = 0;
  // Stream records to avoid loading 1M+ rows at once.
  for await (const row of wellboreDbf) {
    scanned++;
    const r = row as Record<string, unknown>;
    const apiNumber = asString(pickField(r, WELLBORE_FIELD_ALIASES.apiNumber));
    const opNumRaw = asString(pickField(r, WELLBORE_FIELD_ALIASES.operatorNumber));
    const lat = asNumber(pickField(r, WELLBORE_FIELD_ALIASES.lat));
    const lon = asNumber(pickField(r, WELLBORE_FIELD_ALIASES.lon));
    const countyRaw = asString(pickField(r, WELLBORE_FIELD_ALIASES.county));
    if (!apiNumber || lat == null || lon == null) {
      rejectedNoCoords++;
      continue;
    }
    if (!opNumRaw) {
      rejectedNoOperator++;
      continue;
    }
    const operatorNumber = opNumRaw.padStart(6, "0");
    const operatorName = operatorById.get(operatorNumber);
    if (!operatorName) {
      rejectedNoOperator++;
      continue;
    }
    wells.push({
      apiNumber,
      operatorNumber,
      operatorName,
      lat,
      lon,
      county: countyRaw ? titleCaseCounty(countyRaw) : null,
      state: "TX",
      attribution: "rrc-dbf-join",
    });
    kept++;
  }
  console.log(
    `  parsed wellbore.dbf: scanned=${scanned} kept=${kept} ` +
      `noCoords=${rejectedNoCoords} noOperator=${rejectedNoOperator}`,
  );
  return wells;
}

function titleCaseCounty(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Fallback path: build operator-attributed wells from FracTracker TX layer
// using each partner's disclosed core counties.
// ---------------------------------------------------------------------------

const TX_FEATURE_SERVICE_URL =
  "https://services.arcgis.com/jDGuO8tYggdCCnUJ/arcgis/rest/services/FracTrackerNationalWells_Part3_TX/FeatureServer/0/query";

const TX_BBOX_HALF_KM = 12;
const PER_COUNTY_CAP = 6;

// Mirrors COUNTY_CENTROIDS in ingest-rrc-occ-wells.ts (TX subset).
const TX_COUNTY_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  "Loving, TX":     { lat: 31.847, lon: -103.578 },
  "Reeves, TX":     { lat: 31.252, lon: -103.696 },
  "Culberson, TX":  { lat: 31.367, lon: -104.518 },
  "Ward, TX":       { lat: 31.527, lon: -103.135 },
  "Winkler, TX":    { lat: 31.857, lon: -103.044 },
  "Pecos, TX":      { lat: 30.881, lon: -102.733 },
  "Midland, TX":    { lat: 31.870, lon: -102.029 },
  "Martin, TX":     { lat: 32.305, lon: -101.949 },
  "Andrews, TX":    { lat: 32.305, lon: -102.640 },
  "Ector, TX":      { lat: 31.870, lon: -102.541 },
  "Reagan, TX":     { lat: 31.366, lon: -101.521 },
  "Upton, TX":      { lat: 31.371, lon: -102.046 },
  "Glasscock, TX":  { lat: 31.870, lon: -101.518 },
  "Howard, TX":     { lat: 32.305, lon: -101.435 },
  "Borden, TX":     { lat: 32.745, lon: -101.435 },
  "Crockett, TX":   { lat: 30.722, lon: -101.413 },
  "Crane, TX":      { lat: 31.426, lon: -102.520 },
  "Yoakum, TX":     { lat: 33.174, lon: -102.825 },
  "Gaines, TX":     { lat: 32.745, lon: -102.638 },
  "Karnes, TX":     { lat: 28.901, lon: -97.858 },
  "DeWitt, TX":     { lat: 29.083, lon: -97.357 },
  "Atascosa, TX":   { lat: 28.895, lon: -98.527 },
  "Gonzales, TX":   { lat: 29.458, lon: -97.490 },
  "Webb, TX":       { lat: 27.762, lon: -99.331 },
  "Dimmit, TX":     { lat: 28.422, lon: -99.756 },
  "Maverick, TX":   { lat: 28.743, lon: -100.314 },
  "Hemphill, TX":   { lat: 35.834, lon: -100.270 },
  "Lipscomb, TX":   { lat: 36.278, lon: -100.275 },
  "Wheeler, TX":    { lat: 35.402, lon: -100.270 },
  "Roberts, TX":    { lat: 35.840, lon: -100.815 },
  "Ochiltree, TX":  { lat: 36.278, lon: -100.815 },
};

type TxFracAttrs = {
  OBJECTID: number;
  API: number | null;
  Lat: number | null;
  Long: number | null;
};

async function fetchTxWellsBbox(
  centroid: { lat: number; lon: number },
  halfKm: number,
  cap: number,
): Promise<TxFracAttrs[]> {
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
    outFields: "OBJECTID,API,Lat,Long",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: String(cap),
    orderByFields: "OBJECTID ASC",
  });
  const url = `${TX_FEATURE_SERVICE_URL}?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`FracTracker TX query failed ${res.status}`);
  const json = (await res.json()) as {
    features?: { attributes: TxFracAttrs }[];
    error?: { message: string };
  };
  if (json.error) throw new Error(`FracTracker TX error: ${json.error.message}`);
  return (json.features ?? []).map((f) => f.attributes);
}

type Mapping = Record<
  string,
  {
    ok?: string[];
    tx?: string[];          // operator-name strings (per-well attribution path)
    tx_counties?: string[]; // core counties (county-level fallback path)
    tx_operator_number?: string; // RRC P-5 number (optional, for the dbf path)
  }
>;

function loadMapping(): Mapping {
  const raw = JSON.parse(readFileSync(MAPPING_PATH, "utf8")) as Record<string, unknown>;
  const out: Mapping = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    out[k] = v as Mapping[string];
  }
  return out;
}

async function buildFromFractrackerFallback(): Promise<RrcTxOperatorWell[]> {
  const mapping = loadMapping();
  const wells: RrcTxOperatorWell[] = [];
  // Each API may be claimed by AT MOST ONE partner (first match wins).
  // FracTracker's Part3_TX has an Operator field but it's null for TX
  // wells, so we cannot verify per-well attribution from this source.
  // The single-claim rule prevents the same well lat/lon from showing
  // up under multiple partner badges, which would be a worse error
  // than under-coverage. The dbf-join path (no fallback) is the only
  // way to get true per-well attribution.
  const claimedApis = new Set<string>();

  // Build a 2D plan: for each partner, the largest county wells available.
  // Then iterate partners round-robin per county so early partners don't
  // monopolize wells in shared bbox areas like Loving / Reeves.
  type PartnerPlan = {
    partnerName: string;
    canonicalName: string;
    operatorNumber: string;
    counties: string[];
    fetched: Map<string, TxFracAttrs[]>;
    keptCount: number;
  };
  const plans: PartnerPlan[] = [];

  for (const [partnerName, m] of Object.entries(mapping)) {
    const operatorNames = m.tx ?? [];
    const counties = m.tx_counties ?? [];
    if (operatorNames.length === 0 || counties.length === 0) continue;
    const canonicalName = operatorNames[0]!;
    const operatorNumber = m.tx_operator_number ?? "000000";
    plans.push({
      partnerName,
      canonicalName,
      operatorNumber,
      counties,
      fetched: new Map<string, TxFracAttrs[]>(),
      keptCount: 0,
    });
    console.log(`· ${partnerName}  (counties=${counties.length}, op="${canonicalName}")`);
    for (const countyKey of counties) {
      const c = TX_COUNTY_CENTROIDS[countyKey];
      if (!c) {
        console.log(`    ! unknown county key: "${countyKey}"`);
        continue;
      }
      try {
        const batch = await fetchTxWellsBbox(c, TX_BBOX_HALF_KM, PER_COUNTY_CAP * 4);
        plans[plans.length - 1]!.fetched.set(countyKey, batch);
      } catch (err) {
        console.log(
          `    ! bbox "${countyKey}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Allocate wells: round-robin across partners, claiming up to
  // PER_COUNTY_CAP unique APIs per (partner, county). Skip APIs
  // already claimed by an earlier partner.
  const perPartnerCounty = new Map<string, number>(); // key: partner|county
  let madeProgress = true;
  let pass = 0;
  while (madeProgress && pass < 10) {
    madeProgress = false;
    pass++;
    for (const p of plans) {
      if (p.keptCount >= PER_OPERATOR_CAP) continue;
      for (const countyKey of p.counties) {
        if (p.keptCount >= PER_OPERATOR_CAP) break;
        const batch = p.fetched.get(countyKey);
        if (!batch) continue;
        const ckey = `${p.partnerName}|${countyKey}`;
        const countyKept = perPartnerCounty.get(ckey) ?? 0;
        if (countyKept >= PER_COUNTY_CAP) continue;
        // Claim the next-not-yet-claimed well in this county for this partner.
        for (const w of batch) {
          if (w.API == null || w.Lat == null || w.Long == null) continue;
          const apiStr = String(w.API);
          if (claimedApis.has(apiStr)) continue;
          claimedApis.add(apiStr);
          wells.push({
            apiNumber: apiStr,
            operatorNumber: p.operatorNumber,
            operatorName: p.canonicalName,
            lat: w.Lat,
            lon: w.Long,
            county: countyKey.split(",")[0]!.trim(),
            state: "TX",
            attribution: "fractracker-spatial",
          });
          p.keptCount++;
          perPartnerCounty.set(ckey, countyKept + 1);
          madeProgress = true;
          break; // one well per (partner, county) per round-robin pass
        }
      }
    }
  }

  for (const p of plans) {
    console.log(`  → ${p.keptCount} wells attributed to "${p.canonicalName}"`);
  }
  return wells;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let wells: RrcTxOperatorWell[];
  let source: OutputDoc["_source"];
  if (FALLBACK_SOURCE === "fractracker") {
    console.log("");
    console.log("================================================================");
    console.log(" WARNING: Using FALLBACK source (FracTracker spatial).");
    console.log(" The FracTracker TX layer's Operator field is null for all");
    console.log(" Texas wells, so per-well operator attribution CANNOT be");
    console.log(" verified from this source. Each well is assigned to AT MOST");
    console.log(" ONE partner (first-claim wins by partner order in the");
    console.log(" mapping file) — this prevents the same well lat/lon from");
    console.log(" appearing under multiple partner badges, but it remains a");
    console.log(" county-level proxy. The ONLY way to get true per-well");
    console.log(" attribution is the dbf-join path (no --fallback-source flag,");
    console.log(" with --wellbore and --operator pointing at the RRC bulk");
    console.log(" wellbore.dbf and OPERATOR.dbf files).");
    console.log("================================================================");
    console.log("");
    wells = await buildFromFractrackerFallback();
    source = "fractracker-spatial";
  } else {
    console.log("Using REAL source (RRC wellbore.dbf + OPERATOR.dbf join)…");
    wells = await buildFromDbf();
    source = "rrc-dbf-join";
  }

  // Sanity gate: no API may be claimed by two operators.
  const apiToOps = new Map<string, Set<string>>();
  for (const w of wells) {
    if (!apiToOps.has(w.apiNumber)) apiToOps.set(w.apiNumber, new Set());
    apiToOps.get(w.apiNumber)!.add(w.operatorName);
  }
  const dupApis: string[] = [];
  for (const [api, ops] of apiToOps) if (ops.size > 1) dupApis.push(api);
  if (dupApis.length > 0) {
    console.error(
      `\nERROR: ${dupApis.length} API number(s) are claimed by >1 operator. ` +
        `This would mis-attribute wells. Refusing to write the JSON.\n` +
        `First few duplicates:`,
    );
    for (const api of dupApis.slice(0, 5)) {
      console.error(`  ${api}: ${[...apiToOps.get(api)!].join(", ")}`);
    }
    process.exit(1);
  }

  // ---- Operator breakdown for sanity-checking ----
  const byOp = new Map<string, number>();
  for (const w of wells) byOp.set(w.operatorName, (byOp.get(w.operatorName) ?? 0) + 1);
  const breakdown = [...byOp.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([operatorName, n]) => ({ operatorName, wells: n }));

  const doc: OutputDoc = {
    _README:
      "Per-well, operator-attributed roster of Texas Railroad Commission wells, " +
      "consumed by ingest-rrc-occ-wells.ts via fetchTxWellsForApiNumbers(). " +
      "Generated by scripts/build-tx-operator-wells.ts. See that script's header " +
      "for source documentation. Idempotent: each run overwrites this file.",
    _generatedAt: new Date().toISOString(),
    _source: source,
    _recordCount: wells.length,
    _operatorBreakdown: breakdown,
    wells,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");

  console.log("");
  console.log(`Wrote ${wells.length} wells → ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  console.log(`Source: ${source}`);
  console.log(`Distinct operators: ${byOp.size}`);
  console.log("Top operators by well count:");
  for (const { operatorName, wells: n } of breakdown.slice(0, 20)) {
    console.log(`  ${n.toString().padStart(5, " ")}  ${operatorName}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("build-tx-operator-wells failed:", err);
  process.exit(1);
});
