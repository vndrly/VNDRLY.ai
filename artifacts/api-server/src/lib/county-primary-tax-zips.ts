/**
 * Primary tax ZIP for US county-level site anchors.
 *
 * County centroids often fall outside any ZCTA, so reverse geocoders return
 * no postcode. For addresses shaped like "Reeves County, TX" we use the
 * county seat / largest city ZIP as the merchandise tax jurisdiction.
 */
export type CountyPrimaryTaxZip = {
  postalCode: string;
  city: string;
};

/** Key format: `"<CountyName>, <ST>"` (no "County" suffix in the name). */
export const COUNTY_PRIMARY_TAX_ZIPS: Record<string, CountyPrimaryTaxZip> = {
  // Texas — Delaware Basin
  "Loving, TX": { postalCode: "79754", city: "Mentone" },
  "Reeves, TX": { postalCode: "79772", city: "Pecos" },
  "Culberson, TX": { postalCode: "79855", city: "Van Horn" },
  "Ward, TX": { postalCode: "79756", city: "Monahans" },
  "Winkler, TX": { postalCode: "79745", city: "Kermit" },
  "Pecos, TX": { postalCode: "79735", city: "Fort Stockton" },
  // Texas — Midland Basin
  "Midland, TX": { postalCode: "79701", city: "Midland" },
  "Martin, TX": { postalCode: "79782", city: "Stanton" },
  "Andrews, TX": { postalCode: "79714", city: "Andrews" },
  "Ector, TX": { postalCode: "79761", city: "Odessa" },
  "Reagan, TX": { postalCode: "76932", city: "Big Lake" },
  "Upton, TX": { postalCode: "79752", city: "McCamey" },
  "Glasscock, TX": { postalCode: "79739", city: "Garden City" },
  "Howard, TX": { postalCode: "79720", city: "Big Spring" },
  "Borden, TX": { postalCode: "79738", city: "Gail" },
  "Crockett, TX": { postalCode: "76943", city: "Ozona" },
  // Texas — Central Basin Platform
  "Crane, TX": { postalCode: "79731", city: "Crane" },
  "Yoakum, TX": { postalCode: "79355", city: "Plains" },
  "Gaines, TX": { postalCode: "79360", city: "Seminole" },
  // Texas — Eagle Ford
  "Karnes, TX": { postalCode: "78118", city: "Karnes City" },
  "DeWitt, TX": { postalCode: "77954", city: "Cuero" },
  "Atascosa, TX": { postalCode: "78026", city: "Jourdanton" },
  "Gonzales, TX": { postalCode: "78629", city: "Gonzales" },
  "Webb, TX": { postalCode: "78040", city: "Laredo" },
  "Dimmit, TX": { postalCode: "78834", city: "Carrizo Springs" },
  "Maverick, TX": { postalCode: "78852", city: "Eagle Pass" },
  // Texas — Panhandle (Mach Western Anadarko)
  "Hemphill, TX": { postalCode: "79014", city: "Canadian" },
  "Lipscomb, TX": { postalCode: "79056", city: "Lipscomb" },
  "Wheeler, TX": { postalCode: "79096", city: "Wheeler" },
  "Roberts, TX": { postalCode: "79059", city: "Miami" },
  "Ochiltree, TX": { postalCode: "79070", city: "Perryton" },
  // Oklahoma — Anadarko SCOOP/STACK
  "Kingfisher, OK": { postalCode: "73750", city: "Kingfisher" },
  "Canadian, OK": { postalCode: "74425", city: "Canadian" },
  "Major, OK": { postalCode: "73737", city: "Fairview" },
  "Blaine, OK": { postalCode: "73772", city: "Watonga" },
  "Dewey, OK": { postalCode: "73667", city: "Taloga" },
  "Custer, OK": { postalCode: "73096", city: "Weatherford" },
  "Grady, OK": { postalCode: "73018", city: "Chickasha" },
  "Garvin, OK": { postalCode: "73075", city: "Pauls Valley" },
  "Stephens, OK": { postalCode: "73533", city: "Duncan" },
};

export type CountyGeocodedPostal = {
  postalCode: string;
  county: string | null;
  city: string | null;
};

/** Parse `"Reeves County, TX"` (or the same fragment from a longer site name). */
export function parseCountyAddress(
  text: string | null | undefined,
): { county: string; state: string } | null {
  if (!text?.trim()) return null;
  const match = text.match(/([A-Za-z .'-]+)\s+County,\s*([A-Z]{2})\b/i);
  if (!match) return null;
  return {
    county: match[1].trim(),
    state: match[2].toUpperCase(),
  };
}

export function lookupCountyPrimaryTaxZip(
  addressHint: string | null | undefined,
  stateHint: string | null,
): CountyGeocodedPostal | null {
  const parsed = parseCountyAddress(addressHint);
  if (!parsed) return null;
  if (stateHint && stateHint.trim().toUpperCase() !== parsed.state) return null;

  const key = `${parsed.county}, ${parsed.state}`;
  const row = COUNTY_PRIMARY_TAX_ZIPS[key];
  if (!row) return null;

  return {
    postalCode: row.postalCode,
    county: `${parsed.county} County`,
    city: row.city,
  };
}
