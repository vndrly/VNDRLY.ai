/**
 * Resolve site situs tax snapshot from coordinates + state rubric (TX, OK, NM, NJ).
 *
 * Rate priority:
 *   1. tax_rates row for the state (when present)
 *   2. State rubric default + county-seat ZIP proxy for situs label
 *
 * Geocoding uses Census county lookup and Nominatim (free); no paid rate APIs.
 */
import { eq } from "drizzle-orm";
import {
  buildJurisdictionLabel,
  getStateRubric,
  type SiteTaxSnapshot,
} from "@workspace/db";
import { db, siteLocationsTable, taxRatesTable } from "@workspace/db";
import { lookupCountyPrimaryTaxZip } from "./county-primary-tax-zips";
import { logger } from "./logger";

export type ResolvedTaxJurisdiction = SiteTaxSnapshot;

type GeocodedPostal = {
  postalCode: string;
  county: string | null;
  city: string | null;
};

const CENSUS_GEO_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

function normalizeZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

function titleCaseCounty(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  return name.trim();
}

function extractZipFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : null;
}

function addRates(stateRate: string, localRate: string): string {
  const combined = parseFloat(stateRate) + parseFloat(localRate);
  return combined.toFixed(4);
}

async function reverseGeocodeCountyFromCensus(
  latitude: number,
  longitude: number,
): Promise<{ county: string | null; city: string | null } | null> {
  const url = new URL(CENSUS_GEO_URL);
  url.searchParams.set("x", String(longitude));
  url.searchParams.set("y", String(latitude));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return null;
    const data = (await res.json()) as {
      result?: { geographies?: Record<string, Array<Record<string, string>>> };
    };
    const geos = data.result?.geographies ?? {};
    const county =
      geos.Counties?.[0]?.NAME ??
      geos["2020 Census Counties"]?.[0]?.NAME ??
      null;
    return { county: titleCaseCounty(county), city: null };
  } catch (err) {
    logger.warn({ err, latitude, longitude }, "census county lookup failed");
    return null;
  }
}

async function reverseGeocodeNominatim(
  latitude: number,
  longitude: number,
): Promise<GeocodedPostal | null> {
  const url = new URL(NOMINATIM_REVERSE);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "VNDRLY/1.0 (tax-jurisdiction)",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: {
        postcode?: string;
        county?: string;
        city?: string;
        town?: string;
        village?: string;
      };
    };
    const postalCode = normalizeZip(data.address?.postcode);
    const city =
      data.address?.city ?? data.address?.town ?? data.address?.village ?? null;
    if (!postalCode && !data.address?.county) return null;
    return {
      postalCode: postalCode ?? "",
      county: titleCaseCounty(data.address?.county),
      city: city?.trim() || null,
    };
  } catch (err) {
    logger.warn({ err, latitude, longitude }, "nominatim reverse geocode failed");
    return null;
  }
}

async function loadStateRateFromDb(stateHint: string | null): Promise<string | null> {  if (!stateHint?.trim()) return null;
  const [row] = await db
    .select({ rate: taxRatesTable.rate })
    .from(taxRatesTable)
    .where(eq(taxRatesTable.state, stateHint.trim().toUpperCase()));
  return row?.rate ?? null;
}

async function resolvePostalProxy(args: {
  latitude: number;
  longitude: number;
  stateHint: string | null;
  addressHint?: string | null;
}): Promise<GeocodedPostal | null> {
  const zipFromAddress = extractZipFromAddress(args.addressHint);
  if (zipFromAddress) {
    return { postalCode: zipFromAddress, county: null, city: null };
  }

  const countySeat = lookupCountyPrimaryTaxZip(args.addressHint, args.stateHint);
  if (countySeat) return countySeat;

  const nominatim = await reverseGeocodeNominatim(args.latitude, args.longitude);
  if (nominatim?.postalCode) return nominatim;

  const censusCounty = await reverseGeocodeCountyFromCensus(
    args.latitude,
    args.longitude,
  );
  if (censusCounty?.county) {
    return { postalCode: "", county: censusCounty.county, city: censusCounty.city };
  }

  return nominatim;
}

export async function resolveTaxJurisdictionFromCoordinates(args: {
  latitude: number;
  longitude: number;
  stateHint: string | null;
  addressHint?: string | null;
}): Promise<ResolvedTaxJurisdiction | null> {
  const rubric = getStateRubric(args.stateHint);
  if (!rubric) {
    logger.warn({ state: args.stateHint }, "unsupported tax state for site situs");
    return null;
  }

  const geo = await resolvePostalProxy(args);
  const dbStateRate = await loadStateRateFromDb(args.stateHint);
  let stateTaxRate = dbStateRate ?? rubric.defaultStateRate;

  let localTaxRate = "0.0000";
  let combinedTaxRate = stateTaxRate;
  let county = geo?.county ?? null;
  let city = geo?.city ?? null;
  const postalCode = geo?.postalCode || null;
  let provider: SiteTaxSnapshot["provider"] = "rubric_fallback";

  if (geo?.postalCode) {
    provider = "county_seat";
  }

  combinedTaxRate = addRates(stateTaxRate, localTaxRate);

  const jurisdictionLabel = buildJurisdictionLabel({
    state: args.stateHint,
    county,
    city,
    localTaxRate,
    combinedTaxRate,
  });

  return {
    state: args.stateHint!.trim().toUpperCase(),
    postalCode,
    county,
    city,
    jurisdictionLabel,
    stateTaxRate,
    localTaxRate,
    combinedTaxRate,
    provider,
  };
}

export async function persistSiteTaxJurisdiction(
  siteId: number,
  latitude: number,
  longitude: number,
  stateHint: string | null,
  addressHint?: string | null,
): Promise<ResolvedTaxJurisdiction | null> {
  const resolved = await resolveTaxJurisdictionFromCoordinates({
    latitude,
    longitude,
    stateHint,
    addressHint,
  });
  if (!resolved) return null;

  await db
    .update(siteLocationsTable)
    .set({
      taxJurisdictionPostalCode: resolved.postalCode,
      taxJurisdictionCounty: resolved.county,
      taxJurisdictionCity: resolved.city,
      taxJurisdictionLabel: resolved.jurisdictionLabel,
      stateTaxRate: resolved.stateTaxRate,
      localTaxRate: resolved.localTaxRate,
      combinedTaxRate: resolved.combinedTaxRate,
      merchandiseTaxRate: resolved.combinedTaxRate,
      laborTaxRate: resolved.stateTaxRate,
      taxJurisdictionResolvedAt: new Date(),
      taxProvider: resolved.provider,
    })
    .where(eq(siteLocationsTable.id, siteId));

  return resolved;
}

export {
  computeTicketTaxPreview,
  isLaborLineType,
  isMerchandiseLineType,
  resolveLineTaxability,
  getStateRubric,
  STATE_TAX_RUBRICS,
} from "@workspace/db";
