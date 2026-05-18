# api-server scripts

One-off backfills, seeds, and ingest pipelines that run against the
VNDRLY operational database. Each script is idempotent unless noted
otherwise. Run them with:

```sh
pnpm --filter @workspace/api-server exec tsx scripts/<script>.ts
```

---

## Site-location ingestion: real wells from RRC + OCC

The original `seed-permian-site-locations.ts` and
`seed-mach-site-locations.ts` populate **county-level area anchors** —
one row per (operator, play, county) anchored at the US Census TIGER
county centroid with a 30 km geofence radius. Useful as a starting
point, but not precise enough for visit assignment, route planning, or
geofencing in the field.

The pipeline below replaces those anchors with individual well/pad
rows pulled from public Texas Railroad Commission (RRC) and Oklahoma
Corporation Commission (OCC) well records, for **all 23 partners**
that were seeded with county anchors.

### Architecture

```
┌────────────────────────────────────┐        ┌──────────────────────────────┐
│ Texas Railroad Commission (RRC)    │        │ FracTracker Alliance         │
│   wellbore.dbf + OPERATOR.dbf      │ ─┐ ┌─▶ │ National Wells AGOL services │
│   bulk downloads (TX)              │  │ │   │   Part2_OH_WY  (OK + others) │
│                                    │  │ │   │   Part3_TX     (TX, fallback)│
│ Oklahoma Corporation Commission    │ ─┼─┘   └──────────────┬───────────────┘
│   well data download (OK)          │  │                    │
└────────────────────────────────────┘  ▼                    │
                                ┌────────────────────────┐   │
                                │ build-tx-operator-     │   │
                                │ wells.ts               │   │
                                │ (dbf-join, or          │   │
                                │  --fallback-source     │◀──┘
                                │   fractracker)         │
                                └──────────┬─────────────┘
                                           ▼
                          scripts/data/rrc-tx-operator-wells.json
                          (per-well: API #, operator name, lat/lon, county)

                          scripts/data/operator-name-mappings.json
                          (VNDRLY partner → { ok: <OPERATOR strings>,
                                              tx: <RRC OPERATOR_NAME strings>,
                                              tx_counties: <core county keys> })
                                           │
                                           ▼
                                ┌──────────────────────────────────────┐
                                │ ingest-rrc-occ-wells.ts              │
                                │  • OK: per-operator AGOL queries     │
                                │  • TX: per-well via the JSON         │
                                │      └─ fetchTxWellsForApiNumbers()  │
                                │  • TX legacy fallback: per-county    │
                                │      bbox (only when no JSON entry)  │
                                │  • idempotent inserts via DB-level   │
                                │    partial unique index              │
                                │  • per-(partner, county) supersession│
                                └──────────────┬───────────────────────┘
                                               ▼
                              site_locations
                                sourceType='occ' (OK wells, operator-attributed)
                                sourceType='rrc' (TX wells, operator-attributed
                                  per-well via the dbf join)
                                area-anchor rows hidden+supersededAt for the
                                  specific (operator, county) pairs that received
                                  >=1 real well; counties without real wells keep
                                  their anchor visible
```

### Data sources

| Source | What | Use in this pipeline |
| ------ | ---- | -------------------- |
| **Texas Railroad Commission (RRC)** — Digital Map Information bulk wellbore download | Surface- and bottom-hole locations + RRC API number for every well in TX | `ingest-rrc-occ-wells.ts` TX path, via FracTracker `Part3_TX` |
| **Oklahoma Corporation Commission (OCC)** — Oil & Gas Conservation Division well data download | Operator name, well name, API #, lat/long for every well in OK | `ingest-rrc-occ-wells.ts` OK path, via FracTracker `Part2_OH_WY` |
| **FracTracker Alliance — National Wells AGOL feature services** | Compiles the two state agency downloads above into queryable ArcGIS Feature Services | Live HTTPS source for both paths |

The original RRC and OCC well records are **public records** under the
respective state public-information acts; no licensing restriction.
FracTracker's compiled feature services are published under
**CC-BY 4.0** (Creative Commons Attribution 4.0). Attribution is
recorded in each row's `address` field and in the script header.

### Operator attribution per state

| State | Per-well operator? | Attribution method |
| ----- | ------------------ | ------------------ |
| OK    | ✅ Yes (OCC tags every well with an OPERATOR string) | Direct: query FracTracker for wells whose `Operator` matches one of the partner's mapped strings |
| TX    | ✅ Yes (via the RRC `wellbore.dbf` ↔ `OPERATOR.dbf` join — see "Texas (RRC) coverage" below) | Direct: pre-built `scripts/data/rrc-tx-operator-wells.json` lists every (RRC API #, operator name, lat/lon) tuple, and `ingest-rrc-occ-wells.ts` resolves each partner's canonical RRC OPERATOR_NAME strings → API numbers → individual wells. |

### Texas (RRC) coverage

TX attribution is a two-stage pipeline:

1. **Build** — `scripts/build-tx-operator-wells.ts` produces
   `scripts/data/rrc-tx-operator-wells.json`. Two source modes:

   | Flag | Source | Notes |
   | ---- | ------ | ----- |
   | (default) | `wellbore.dbf` ↔ `OPERATOR.dbf` join | **True per-well operator attribution.** Requires the two `.dbf` files (download from the RRC Digital Map Information / MFT bulk wellbore + operator extracts; pass via `--wellbore` and `--operator`). Each well row gets `attribution: "rrc-dbf-join"`. |
   | `--fallback-source fractracker` | FracTracker `Part3_TX` per-county bbox queries seeded by each partner's `tx_counties` | **County-level proxy.** The FracTracker TX layer's `Operator` field is null for every TX well, so per-well attribution cannot be verified from this source. Each well is assigned to **at most one** partner (first-claim wins by partner order in the mapping file) — this prevents the same well lat/lon from showing up under multiple partner badges, but the attribution remains a county-level proxy and should be replaced by a `rrc-dbf-join` regeneration as soon as the dbf files are obtained. Each row gets `attribution: "fractracker-spatial"`. The script asserts API-number uniqueness across operators and refuses to write the JSON if any well is claimed by two operators. |

   Re-running the script overwrites the JSON. The dbf-join mode is the
   canonical source — check the JSON's top-level `_source` field to know
   which mode produced the file currently on disk.

2. **Ingest** — `ingest-rrc-occ-wells.ts` (TX path) reads the JSON via
   the in-memory `loadTxWellsJson()` cache and exposes
   `fetchTxWellsForApiNumbers(apiNumbers: string[])`. For each partner
   it: (a) maps the `tx` array of canonical OPERATOR_NAME strings →
   API numbers via the JSON, (b) caps at `MAX_WELLS_PER_OPERATOR_TX`
   (30) and `MAX_WELLS_PER_COUNTY_TX` (5/county), (c) inserts rows
   with `sourceType='rrc'`, `sourceRef='TX:<API>'`, and (d) marks
   each affected (partner, county) area-anchor as
   `supersededAt=now()` + `hidden=true`.

   When no per-well JSON entry is available for a partner (e.g. a
   partner only has `tx_counties` mapped), the legacy bbox fallback
   (`ingestTxFromCounties()`) still runs. This keeps the pipeline
   working during the rollout.

### Refresh cadence

- **RRC bulk wellbore.dbf** — RRC re-publishes per-county files monthly.
- **OCC well data download** — OCC refreshes weekly.
- **FracTracker National Wells layers** — recompiled roughly quarterly.
- **`ingest-rrc-occ-wells.ts`** — re-run quarterly (or on-demand). The
  script is idempotent at the DB level (partial unique index on
  `(partner_id, source_ref)` — see schema notes below); existing
  rows are skipped, and only newly-spudded wells discovered since the
  last run are inserted.

### Schema additions (`lib/db/src/schema/siteLocations.ts`)

The pipeline depends on three columns added to `site_locations`:

| Column | Type | Purpose |
| ------ | ---- | ------- |
| `sourceType`   | `text NOT NULL DEFAULT 'manual'` | One of `'manual'`, `'area-anchor'`, `'occ'`, `'rrc'` |
| `sourceRef`    | `text NULL` | External reference, e.g. `'OK:24061'` or `'TX:42301345670000'` (state + RRC/OCC API number) |
| `supersededAt` | `timestamptz NULL` | Set when the row is replaced by more specific data |

Plus a partial unique index for DB-level idempotency:

```sql
CREATE UNIQUE INDEX site_locations_partner_source_ref_uniq
  ON site_locations (partner_id, source_ref)
  WHERE source_ref IS NOT NULL;
```

(The partial index leaves manual / area-anchor rows — `source_ref IS
NULL` — unaffected.)

`sourceType='area-anchor'` rows that have a value in `supersededAt`
are also flagged `hidden=true` so the field UI ignores them by
default.

### Order of operations

```sh
# 1. Sync the schema additions (sourceType, sourceRef, supersededAt + the
#    partial unique index). This is a non-destructive change.
pnpm --filter @workspace/db push

# 2. (one-time) Tag existing county-area-anchor rows so the pipeline
#    knows which rows it is allowed to supersede.
pnpm --filter @workspace/api-server exec tsx scripts/backfill-site-source-types.ts

# 3. Build the TX per-well operator JSON (committed to the repo, but
#    re-build whenever RRC publishes a new wellbore.dbf / OPERATOR.dbf,
#    or whenever operator-name-mappings.json changes).
pnpm --filter @workspace/api-server exec tsx scripts/build-tx-operator-wells.ts
#   Or, if RRC bulk dbf access isn't available in this environment:
pnpm --filter @workspace/api-server exec tsx scripts/build-tx-operator-wells.ts --fallback-source fractracker

# 4. Pull real OK + TX wells and supersede the matching per-county
#    area anchors. Safe to re-run.
pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts

# Useful flags
pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts --dry-run
pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts --state OK
pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts --state TX
pnpm --filter @workspace/api-server exec tsx scripts/ingest-rrc-occ-wells.ts --partner "Mach Natural Resources"
```

### Operator-name / county mapping

`scripts/data/operator-name-mappings.json` covers all 23 seeded
partners. Each entry has three arrays:

```json
{
  "ExxonMobil":  {
    "ok": [],
    "tx": ["XTO ENERGY INC.", "EXXONMOBIL OIL CORP", "EXXON MOBIL CORPORATION"],
    "tx_counties": ["Loving, TX", "Reeves, TX", ...]
  },
  "Continental Resources": { "ok": ["CONTINENTAL RESOURCES INC"], "tx": [], "tx_counties": [] },
  "Mach Natural Resources": {
    "ok": ["BCE-MACH LLC", "BCE-MACH II LLC", "BCE-MACH III LLC"],
    "tx": ["BCE-MACH LLC", "BCE-MACH II LLC", "BCE-MACH III LLC"],
    "tx_counties": ["Hemphill, TX", "Lipscomb, TX", ...]
  }
}
```

- `ok` — OPERATOR strings (case-insensitive exact match) used by the
  FracTracker OK layer. A single VNDRLY partner can map to multiple
  legal-entity strings (e.g. Mach → three BCE-MACH LLCs); the script
  de-duplicates by API number across variants.
- `tx` — canonical RRC `OPERATOR_NAME` strings used by both
  `build-tx-operator-wells.ts` (to filter the dbf-join output for that
  partner) and the per-well TX ingest path
  (`txApiNumbersForOperatorStrings()` resolves them → API numbers via
  the JSON).
- `tx_counties` — county keys (matching `COUNTY_CENTROIDS` in
  `ingest-rrc-occ-wells.ts`) where the partner publicly discloses
  operations. Used by (a) the FracTracker fallback build mode to seed
  per-county bbox queries, and (b) the legacy bbox ingest path that
  runs only when no per-well JSON entry exists for the partner.

To add a new partner:

1. Find the FracTracker OPERATOR string(s) for that company in OK (if
   they have OK ops). Example query (top OPERATOR strings matching a
   substring):
   ```
   https://services.arcgis.com/jDGuO8tYggdCCnUJ/arcgis/rest/services/FracTrackerNationalWells_Part2_OH_WY/FeatureServer/0/query?
       where=State='OK'+AND+UPPER(Operator)+like+'%MARATHON%'
       &outFields=Operator&groupByFieldsForStatistics=Operator
       &outStatistics=[{"statisticType":"count","onStatisticField":"Operator","outStatisticFieldName":"cnt"}]
       &orderByFields=cnt+desc&f=json
   ```
2. List the partner's TX core counties (from their latest 10-K) using
   the keys already in `COUNTY_CENTROIDS`. If a needed county isn't in
   `COUNTY_CENTROIDS`, add it (US Census TIGER centroids are public
   geographic facts).
3. Add a `"<Partner Name>": { "ok": [...], "tx": [...] }` block.
4. Re-run `ingest-rrc-occ-wells.ts` (optionally with `--partner` to
   limit the run).

### Tunables (`ingest-rrc-occ-wells.ts`)

| Constant | Default | What it controls |
| -------- | ------- | ---------------- |
| `MAX_WELLS_PER_OPERATOR_OK` | `30`  | Cap on OK rows inserted per partner |
| `MAX_WELLS_PER_OPERATOR_TX` | `30`  | Cap on TX rows inserted per partner via the per-well JSON path |
| `MAX_WELLS_PER_COUNTY_TX`   | `5`   | Cap on TX rows inserted per (partner, county) |
| `WELL_RADIUS_METERS`        | `500` | Geofence radius for individual well/pad rows |
| `TX_BBOX_HALF_KM`           | `12`  | Half-extent of the TX spatial bbox around each county centroid (build script + legacy fallback ingest) |
| `PAGE_SIZE`                 | `200` | OK pagination chunk size; FracTracker's max is ~2000 |

### Per-county supersession

Supersession is at the **(operator, county)** level, not state-level.
The flow per partner:

1. Wells fetched in the run are binned to a county.
   - **OK**: closest-centroid bin against the partner's seeded OK
     county anchors.
   - **TX**: each well already comes from a county-specific bbox
     query, so binning is direct.
2. Wells are inserted (or skipped if `(partner_id, source_ref)`
   already exists thanks to the partial unique index).
3. For each county that received ≥1 real well in this run, the
   partner's `area-anchor` row whose name contains "<County> County"
   is marked `supersededAt=now()` and `hidden=true`.

Counties for which no real wells could be sourced **keep their
visible area anchor** — the anchor remains the best info we have for
that county.

### Current state

After running the full pipeline against the freshly-seeded database
(`build-tx-operator-wells.ts --fallback-source fractracker` →
`backfill-site-source-types.ts` → `ingest-rrc-occ-wells.ts`):

| sourceType    | state | rows | hidden? |
| ------------- | ----- | ---- | ------- |
| `occ`         | OK    | 132  | no      |
| `rrc`         | TX    | 403  | no  (per-well, attributed via `tx` operator strings → API #s for all 23 partners with TX ops, including the 13 TX-only partners) |
| `area-anchor` | TX    | 109  | yes (superseded by real RRC wells in their county) |
| `area-anchor` | TX    | ~4   | no  (TX counties without per-well coverage in the JSON — anchors retained) |
| `area-anchor` | OK    | 3    | yes (Continental: Blaine; Mach: Major + Kingfisher) |
| `area-anchor` | OK    | 15   | no  (OK counties without close-enough OCC wells — anchors retained) |
| `manual`      | TX/OK | 4    | no      |

The remaining visible TX area-anchors are counties present in
`tx_counties` but for which the current `rrc-tx-operator-wells.json`
has no entry (e.g. the FracTracker fallback couldn't find wells
within the 12 km bbox, or the partner's `tx` operator strings don't
yet match a row in the dbf join). They remain visible as the best
available info until the next JSON refresh.

The remaining 15 visible OK area anchors are counties where the bound
operator's OCC wells didn't land within `OK_COUNTY_BIN_MAX_KM` (50 km)
of the seeded county centroid — they remain visible as the best
available info until either (a) the next FracTracker refresh adds
closer wells, (b) the threshold is widened, or (c) the partner's OK
mapping is expanded with additional OPERATOR strings.

Re-running is a no-op (everything is matched on `(partner_id,
source_ref)`).
