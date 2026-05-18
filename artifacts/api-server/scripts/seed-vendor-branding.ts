/**
 * Seed vendor branding (logo + brand colors) for every Permian/Mid-Con
 * oilfield service vendor we have a freely-usable corporate logo for.
 *
 * Mirrors seed-partner-branding.ts but operates on vendorsTable. Vendors
 * carry the same `brandPrimaryColor` / `brandAccentColor` columns as
 * partners do, so this script seeds both colors and (when an asset file
 * exists) the logo with merge-blanks semantics.
 *
 * If a logo file is missing under scripts/assets/<slug>.{png,jpg}, the
 * vendor row still has its colors filled — we do NOT fabricate a logo.
 *
 * Idempotent. Safe to run multiple times.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seed-vendor-branding.ts
 */
import { Storage } from "@google-cloud/storage";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { db, vendorsTable } from "@workspace/db";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "assets");

type VendorBrandSpec = {
  /** Canonical vendor name (must match seed-permian-basin.ts). */
  vendorName: string;
  /** Slug; we look for `<slug>.png` then `<slug>.jpg` in scripts/assets/. */
  slug: string;
  /** Hex string like "#1A1A1A". Filled into brandPrimaryColor when blank. */
  primary: string;
  /** Hex string like "#C8A24B". Filled into brandAccentColor when blank. */
  accent: string;
};

// Colors are pulled from the vendors' own corporate brand guidelines /
// public marketing materials. Where a vendor publishes a single brand
// hue we pair it with a complementary neutral that matches their
// printed collateral so cards still feel branded.
const SPECS: VendorBrandSpec[] = [
  { vendorName: "Halliburton",                       slug: "halliburton",            primary: "#D2232A", accent: "#1A1A1A" },
  { vendorName: "SLB (Schlumberger)",                slug: "slb",                    primary: "#005EB8", accent: "#0A1F3A" },
  { vendorName: "Baker Hughes",                      slug: "baker-hughes",           primary: "#00B388", accent: "#1A1A1A" },
  { vendorName: "Weatherford International",         slug: "weatherford",            primary: "#E4002B", accent: "#1A1A1A" },
  { vendorName: "Liberty Energy",                    slug: "liberty-energy",         primary: "#0A2240", accent: "#C8102E" },
  { vendorName: "ProPetro Holding",                  slug: "propetro",               primary: "#003DA5", accent: "#FDB927" },
  { vendorName: "NOV Inc.",                          slug: "nov",                    primary: "#003C71", accent: "#0099D8" },
  { vendorName: "Patterson-UTI Energy",              slug: "patterson-uti",          primary: "#00558C", accent: "#E87722" },
  { vendorName: "Nabors Industries",                 slug: "nabors",                 primary: "#C8102E", accent: "#1A1A1A" },
  { vendorName: "Helmerich & Payne",                 slug: "helmerich-payne",        primary: "#003DA5", accent: "#F26522" },
  { vendorName: "ChampionX",                         slug: "championx",              primary: "#0033A0", accent: "#7AB800" },
  { vendorName: "Cactus Inc.",                       slug: "cactus",                 primary: "#1B5E20", accent: "#C5A572" },
  { vendorName: "Solaris Oilfield Infrastructure",   slug: "solaris",                primary: "#F58220", accent: "#1A1A1A" },
  { vendorName: "Select Water Solutions",            slug: "select-water",           primary: "#0072CE", accent: "#7BB661" },
  { vendorName: "ProFrac Holding",                   slug: "profrac",                primary: "#0A2240", accent: "#E4002B" },
  { vendorName: "U.S. Silica Holdings",              slug: "us-silica",              primary: "#1B365D", accent: "#C8A24B" },
  { vendorName: "Pason Systems",                     slug: "pason",                  primary: "#005CAB", accent: "#F2A900" },
  { vendorName: "Stallion Infrastructure Services",  slug: "stallion-infrastructure",primary: "#1A1A1A", accent: "#C8A24B" },
  // NexTier merged with Patterson-UTI Energy in 2022 and the NexTier
  // brand has been retired, but we keep the legacy row branded with
  // the historical NexTier wordmark/colors so it visually matches what
  // field users still see on equipment and paperwork.
  { vendorName: "NexTier Oilfield Solutions",        slug: "nextier",                primary: "#0033A0", accent: "#E4002B" },
];

function findLogoFile(slug: string): { absPath: string; ext: "png" | "jpg" } | null {
  for (const ext of ["png", "jpg"] as const) {
    const candidate = path.join(ASSETS_DIR, `${slug}.${ext}`);
    if (fs.existsSync(candidate)) return { absPath: candidate, ext };
  }
  return null;
}

async function uploadPublicLogo(objectKey: string, fileAbsPath: string, ext: "png" | "jpg"): Promise<string> {
  const publicSearchPaths = (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (publicSearchPaths.length === 0) {
    throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not set");
  }
  const basePath = publicSearchPaths[0];
  const fullPath = `${basePath}/${objectKey}`.replace(/^\//, "");
  const [bucketName, ...rest] = fullPath.split("/");
  const objectName = rest.join("/");
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);
  const contentType = ext === "jpg" ? "image/jpeg" : "image/png";
  await file.save(fs.readFileSync(fileAbsPath), {
    contentType,
    resumable: false,
    metadata: { cacheControl: "public, max-age=3600" },
  });
  return `/api/storage/public-objects/${objectKey}`;
}

export type VendorBrandingSeedCounts = {
  logoFilled: number;
  logoSkippedExisting: number;
  logoMissing: number;
  colorsFilled: number;
  colorsSkippedExisting: number;
  notFound: string[];
};

export async function seedVendorBranding(): Promise<VendorBrandingSeedCounts> {
  const vendors = await db.select().from(vendorsTable);
  console.log(`Branding ${SPECS.length} vendor specs against ${vendors.length} DB rows…`);

  let logoFilled = 0;
  let logoSkippedExisting = 0;
  let logoMissing = 0;
  let colorsFilled = 0;
  let colorsSkippedExisting = 0;
  let notFound: string[] = [];

  for (const spec of SPECS) {
    // After the dedupe-vendors.ts cleanup there is at most one row per
    // canonical name, but we still match by name (not id) so this seed
    // stays robust if a fresh demo seed re-introduces duplicates.
    const matches = vendors.filter((v) => v.name === spec.vendorName);
    if (matches.length === 0) {
      notFound.push(spec.vendorName);
      continue;
    }

    // Merge-blanks semantics for colors: only fill columns that are
    // currently null/empty so we never overwrite values an admin typed
    // in. Apply across every matching row (in case of legacy duplicates).
    let anyColorFilled = false;
    for (const v of matches) {
      const updates: Record<string, unknown> = {};
      if (!v.brandPrimaryColor) updates.brandPrimaryColor = spec.primary;
      if (!v.brandAccentColor) updates.brandAccentColor = spec.accent;
      if (Object.keys(updates).length > 0) {
        await db.update(vendorsTable).set(updates).where(eq(vendorsTable.id, v.id));
        anyColorFilled = true;
      }
    }
    if (anyColorFilled) colorsFilled++;
    else colorsSkippedExisting++;

    const logo = findLogoFile(spec.slug);
    if (!logo) {
      logoMissing++;
      const colorNote = anyColorFilled ? " (colors filled, no logo file)" : ` (no logo file at scripts/assets/${spec.slug}.png)`;
      console.log(`  · ${spec.vendorName.padEnd(36)}${colorNote}`);
      continue;
    }

    // Same merge-blanks rule for logoUrl: never overwrite a vendor
    // logo a user uploaded.
    const blankRows = matches.filter((v) => !v.logoUrl);
    const populatedRows = matches.filter((v) => v.logoUrl);
    if (blankRows.length === 0) {
      logoSkippedExisting++;
      const colorNote = anyColorFilled ? ", colors filled" : "";
      console.log(`  = ${spec.vendorName.padEnd(36)} (logo already set on all ${matches.length} row(s), kept user values${colorNote})`);
      continue;
    }
    const objectKey = `vendor-logos/${spec.slug}.${logo.ext}`;
    const logoUrl = await uploadPublicLogo(objectKey, logo.absPath, logo.ext);
    for (const v of blankRows) {
      await db.update(vendorsTable).set({ logoUrl }).where(eq(vendorsTable.id, v.id));
    }
    logoFilled++;
    const note: string[] = [];
    if (blankRows.length > 1) note.push(`${blankRows.length} blank rows filled`);
    if (populatedRows.length > 0) note.push(`${populatedRows.length} kept`);
    if (anyColorFilled) note.push("colors filled");
    const noteStr = note.length ? ` (${note.join(", ")})` : "";
    console.log(`  + ${spec.vendorName.padEnd(36)} ← ${logo.ext.toUpperCase()} ${path.basename(logo.absPath)}${noteStr}`);
  }

  console.log("");
  console.log(
    `Summary: ${logoFilled} vendors got new logos, ${logoSkippedExisting} kept user logos, ${logoMissing} missing logo assets, ` +
      `${colorsFilled} vendors got colors filled, ${colorsSkippedExisting} already fully colored.`,
  );
  if (notFound.length) {
    console.log(`Not found in DB (run seed-permian-basin.ts first): ${notFound.join(", ")}`);
  }
  return {
    logoFilled,
    logoSkippedExisting,
    logoMissing,
    colorsFilled,
    colorsSkippedExisting,
    notFound,
  };
}

// Only run when invoked directly (e.g. `tsx scripts/seed-vendor-branding.ts`),
// not when imported from the test suite.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (await import("node:url"))
    .pathToFileURL(process.argv[1])
    .href === import.meta.url;

if (invokedDirectly) {
  seedVendorBranding()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Failed to seed vendor branding", err);
      process.exit(1);
    });
}
