/**
 * Seed partner branding (logo + brand colors) for every Permian/Mid-Con
 * operator we have a freely-usable corporate logo for.
 *
 * Strategy:
 *   1. Each spec has a canonical `partnerName` (matches the row created
 *      by seed-permian-basin.ts). For legacy/test rows we may also list
 *      `aliases` so this script remains idempotent across reruns and can
 *      finish renaming the historical demo seed rows.
 *   2. If a logo file exists under scripts/assets/<slug>.{png,jpg}, we
 *      upload it to public object storage and set partner.logoUrl.
 *      If the file is missing, we still set brand colors so the partner
 *      card has consistent branding via color alone — we do NOT fabricate
 *      a logo.
 *
 * Idempotent. Safe to run multiple times.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seed-partner-branding.ts
 */
import { Storage } from "@google-cloud/storage";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { db, partnersTable } from "@workspace/db";

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

type BrandSpec = {
  /** Canonical partner name (must match seed-permian-basin.ts). */
  partnerName: string;
  /** Earlier names this row may have (for legacy demo rows). */
  aliases?: string[];
  primary: string;
  accent: string;
  /** Slug; we look for `<slug>.png` then `<slug>.jpg` in scripts/assets/. */
  slug: string;
};

const SPECS: BrandSpec[] = [
  // Brand colors mirror seed-permian-basin.ts so the two scripts agree on
  // the canonical hex values for each operator. mergeBlanks-style guarding
  // lives in seed-permian-basin.ts; this script always sets brand colors so
  // existing partner rows that pre-date branding get filled.
  { partnerName: "ExxonMobil",                  primary: "#E1241B", accent: "#003B70", slug: "exxonmobil" },
  { partnerName: "Chevron",                     primary: "#0066B2", accent: "#ED1C24", slug: "chevron" },
  { partnerName: "ConocoPhillips",              primary: "#EE3124", accent: "#003366", slug: "conocophillips", aliases: ["Shell"] },
  { partnerName: "Pioneer Natural Resources",   primary: "#1F3A6D", accent: "#F2A900", slug: "pioneer-natural-resources" },
  { partnerName: "Diamondback Energy",          primary: "#1A1A1A", accent: "#C8A24B", slug: "diamondback-energy" },
  { partnerName: "Occidental Petroleum",        primary: "#E4002B", accent: "#5A6770", slug: "occidental-petroleum" },
  { partnerName: "Devon Energy",                primary: "#0033A0", accent: "#9CCB3B", slug: "devon-energy" },
  { partnerName: "EOG Resources",               primary: "#A6192E", accent: "#1B365D", slug: "eog-resources" },
  { partnerName: "APA Corporation (Apache)",    primary: "#003DA5", accent: "#E87722", slug: "apa-corporation" },
  { partnerName: "Coterra Energy",              primary: "#0E4D2A", accent: "#F7A800", slug: "coterra-energy" },
  { partnerName: "Permian Resources",           primary: "#1B365D", accent: "#D6A04A", slug: "permian-resources" },
  { partnerName: "BP America (BPX Energy)",     primary: "#006F51", accent: "#FFCB05", slug: "bp", aliases: ["BP", "Test Addr Partner 1"] },
  { partnerName: "Shell USA",                   primary: "#FBCE07", accent: "#DD1D21", slug: "shell" },
  { partnerName: "Marathon Oil",                primary: "#005CB9", accent: "#E4002B", slug: "marathon", aliases: ["Marathon", "Test Oil Corp"] },
  { partnerName: "Mach Natural Resources",      primary: "#0B2545", accent: "#D6A04A", slug: "mach-natural-resources" },
  { partnerName: "Endeavor Energy Resources",   primary: "#1A2F4B", accent: "#C5A572", slug: "endeavor-energy" },
  { partnerName: "Continental Resources",       primary: "#1B3F8B", accent: "#D7282F", slug: "continental-resources" },
  { partnerName: "Matador Resources",           primary: "#23335B", accent: "#B8862A", slug: "matador-resources" },
  { partnerName: "SM Energy",                   primary: "#0A2240", accent: "#F58220", slug: "sm-energy" },
  { partnerName: "Vital Energy",                primary: "#0E2C4E", accent: "#E2A724", slug: "vital-energy" },
  { partnerName: "Ovintiv",                     primary: "#0A1F3A", accent: "#7BB661", slug: "ovintiv" },
  { partnerName: "Civitas Resources",           primary: "#1F3F2E", accent: "#A0C846", slug: "civitas-resources" },
  { partnerName: "Ring Energy",                 primary: "#0E2746", accent: "#C9A227", slug: "ring-energy" },
  { partnerName: "Crownquest Operating",        primary: "#1A1A1A", accent: "#C8A24B", slug: "crownquest" },
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

export type PartnerBrandingSeedCounts = {
  logoFilled: number;
  logoSkippedExisting: number;
  logoMissing: number;
  colorsFilled: number;
  colorsSkippedExisting: number;
  notFound: string[];
};

export async function seedPartnerBranding(): Promise<PartnerBrandingSeedCounts> {
  const partners = await db.select().from(partnersTable);
  console.log(`Branding ${SPECS.length} partner specs against ${partners.length} DB rows…`);

  let logoFilled = 0;
  let logoSkippedExisting = 0;
  let logoMissing = 0;
  let colorsFilled = 0;
  let colorsSkippedExisting = 0;
  // Counter retained for log compatibility. The script no longer mutates
  // partner names (see fill-blanks-only contract above), so this stays at 0.
  const renamed = 0;
  let notFound: string[] = [];

  for (const spec of SPECS) {
    const candidates = [spec.partnerName, ...(spec.aliases || [])];
    const matches = partners.filter((p) => candidates.includes(p.name));
    if (matches.length === 0) {
      notFound.push(spec.partnerName);
      continue;
    }

    // Prefer a row that already matches the canonical name; otherwise pick
    // the lowest-id match so renames are deterministic across runs. If
    // we have BOTH a canonical row AND alias rows, that's a duplicate-row
    // situation we must not paper over by silently renaming an alias to
    // collide with the canonical — warn and only brand the canonical row.
    const canonical = matches.find((p) => p.name === spec.partnerName);
    const aliasMatches = matches.filter((p) => p.name !== spec.partnerName);
    if (canonical && aliasMatches.length > 0) {
      console.warn(
        `  ! DUPLICATE: canonical "${spec.partnerName}" (#${canonical.id}) coexists with alias rows ` +
          `(ids=${aliasMatches.map((p) => p.id).join(", ")}). Branding canonical only; ` +
          `alias rows must be deduped manually before rerun.`,
      );
    }
    const target = canonical ?? aliasMatches.sort((a, b) => a.id - b.id)[0]!;

    // Merge-blanks semantics: only fill columns that are currently null or
    // empty. Never overwrite user-entered branding values.
    const updates: Record<string, unknown> = {};
    const notes: string[] = [];

    if (!target.brandPrimaryColor) {
      updates.brandPrimaryColor = spec.primary;
      colorsFilled++;
    } else if (target.brandPrimaryColor !== spec.primary) {
      colorsSkippedExisting++;
      notes.push("primary kept");
    }
    if (!target.brandAccentColor) {
      updates.brandAccentColor = spec.accent;
    } else if (target.brandAccentColor !== spec.accent) {
      notes.push("accent kept");
    }

    // NOTE: This script intentionally does NOT rename matched alias rows to
    // the canonical name. Renaming would mutate a user-managed identity
    // field and violates the strict fill-blanks-only contract this seed
    // script is required to honor. Canonicalization (deduping/renaming
    // legacy alias rows) is an explicit admin operation and belongs in a
    // separate, opt-in dedupe migration script — not here.
    if (target.name !== spec.partnerName) {
      notes.push(`alias row name kept ("${target.name}")`);
    }

    const logo = findLogoFile(spec.slug);
    if (logo) {
      if (!target.logoUrl) {
        const objectKey = `partner-logos/${spec.slug}.${logo.ext}`;
        const logoUrl = await uploadPublicLogo(objectKey, logo.absPath, logo.ext);
        updates.logoUrl = logoUrl;
        logoFilled++;
        const note = notes.length ? ` (${notes.join(", ")})` : "";
        console.log(`  + ${spec.partnerName.padEnd(36)} ← ${logo.ext.toUpperCase()} ${path.basename(logo.absPath)}${note}`);
      } else {
        logoSkippedExisting++;
        console.log(`  = ${spec.partnerName.padEnd(36)} (logo already set, kept user value)`);
      }
    } else {
      logoMissing++;
      console.log(`  · ${spec.partnerName.padEnd(36)} (no logo file at scripts/assets/${spec.slug}.png)`);
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(partnersTable)
        .set(updates)
        .where(eq(partnersTable.id, target.id));
    }
  }

  console.log("");
  console.log(
    `Summary: ${logoFilled} logos filled, ${logoSkippedExisting} kept user logos, ${logoMissing} missing assets, ` +
      `${colorsFilled} primary colors filled, ${colorsSkippedExisting} kept user primary colors, ${renamed} rows renamed.`,
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

// Only run when invoked directly (e.g. `tsx scripts/seed-partner-branding.ts`),
// not when imported from the test suite.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (await import("node:url"))
    .pathToFileURL(process.argv[1])
    .href === import.meta.url;

if (invokedDirectly) {
  seedPartnerBranding()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Failed to seed partner branding", err);
      process.exit(1);
    });
}
