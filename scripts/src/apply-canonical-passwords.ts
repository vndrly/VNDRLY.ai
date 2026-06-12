/**
 * Re-apply demo passwords from docs/canonical-credentials.md.
 * Matches users by LOWER(COALESCE(email, username)), never by id.
 */
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const CANONICAL: Record<string, string> = {
  vndrly123: "admin@vndrly.com,admin",
  baker123: "baker@vndrly.com,baker",
  winchester2:
    "winchester@vndrly.com,Winchester@vndrly.com,winchester,joe.boggs@winchester.com",
  mach123: "mach@vndrly.com,mach",
  exxon123: "exxon@vndrly.com,exxon",
};

async function main() {
  let updated = 0;
  for (const [password, csv] of Object.entries(CANONICAL)) {
    const hash = await bcrypt.hash(password, 10);
    const keys = csv.split(",").map((s) => s.trim().toLowerCase());
    const inList = keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(",");
    const result = await db.execute(
      sql.raw(
        `UPDATE users SET password_hash = '${hash}', must_change_password = false WHERE LOWER(COALESCE(email, username)) IN (${inList}) RETURNING id, username, email`,
      ),
    );
    const rows = Array.isArray(result)
      ? result
      : ((result as { rows?: unknown[] }).rows ?? []);
    for (const row of rows as { id: number; username: string; email: string | null }[]) {
      console.log(`  ✓ ${row.username}${row.email ? ` (${row.email})` : ""} → ${password}`);
      updated += 1;
    }
  }
  console.log(`Done. Updated ${updated} user(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
