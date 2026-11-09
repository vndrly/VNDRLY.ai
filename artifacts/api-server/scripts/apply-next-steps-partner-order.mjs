import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Next Steps migration");
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  const { rows } = await client.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vendors' AND column_name='next_steps_partner_order'
  `);
  if (rows.length && rows[0].data_type !== "jsonb") throw new Error("Unexpected vendors.next_steps_partner_order type");
  if (!rows.length) {
    await client.query("SET lock_timeout='5s'");
    await client.query("ALTER TABLE vendors ADD COLUMN IF NOT EXISTS next_steps_partner_order jsonb NOT NULL DEFAULT '[]'::jsonb");
  }
} finally {
  await client.end();
}
