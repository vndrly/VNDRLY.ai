/**
 * Upload a square PNG to public object storage and point platform_settings
 * logo_url + logo_square_url at it (same asset for both preview surfaces).
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "@workspace/db";
import { platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getObjectStore } from "../src/lib/objectStore.js";

const fileAbs = path.resolve(process.argv[2] ?? "");
if (!fileAbs || !fs.existsSync(fileAbs)) {
  console.error("Usage: swap-platform-logo.ts <absolute-path-to-logo.png>");
  process.exit(1);
}

const body = fs.readFileSync(fileAbs);
const objectKey = "platform-logos/vndrly-square-preview.png";
const logoUrl = await getObjectStore().putPublicObject(objectKey, "image/png", body);

await db
  .update(platformSettingsTable)
  .set({
    logoUrl,
    logoSquareUrl: logoUrl,
    updatedAt: new Date(),
  })
  .where(eq(platformSettingsTable.id, 1));

console.log(`platform_settings logos → ${logoUrl}`);
