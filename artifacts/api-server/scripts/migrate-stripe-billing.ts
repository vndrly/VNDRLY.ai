import { pool } from "@workspace/db";

/** Private billing state: additive columns only, no customer or Stripe mutations. */
async function main() {
  await pool.query("ALTER TABLE vendors ADD COLUMN IF NOT EXISTS stripe_billing_state jsonb");
  await pool.query("ALTER TABLE partners ADD COLUMN IF NOT EXISTS stripe_billing_state jsonb");
  console.log("Stripe billing additive columns ready");
}
main().then(() => pool.end()).catch(() => { console.error("Stripe billing migration failed"); process.exitCode = 1; return pool.end(); });
