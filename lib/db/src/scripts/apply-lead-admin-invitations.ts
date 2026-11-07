import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('vndrly:lead-admin-invitations'))");
  const { rows: existingColumns } = await client.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'owner_user_id'
      AND table_name IN ('vendors', 'partners')
  `);
  await client.query(`
    ALTER TABLE vendors ADD COLUMN IF NOT EXISTS owner_user_id integer REFERENCES users(id);
    ALTER TABLE partners ADD COLUMN IF NOT EXISTS owner_user_id integer REFERENCES users(id);
    CREATE TABLE IF NOT EXISTS lead_admin_invitations (
      token_hash text PRIMARY KEY,
      org_type text NOT NULL,
      org_id integer NOT NULL,
      invited_by integer NOT NULL REFERENCES users(id),
      email text NOT NULL,
      name text NOT NULL,
      phone text,
      expires_at timestamptz NOT NULL,
      accepted_at timestamptz
    );
    ALTER TABLE lead_admin_invitations ADD COLUMN IF NOT EXISTS make_owner boolean NOT NULL DEFAULT false;
    ALTER TABLE lead_admin_invitations ENABLE ROW LEVEL SECURITY;
  `);
  for (const [table, orgType] of [["vendors", "vendor"], ["partners", "partner"]] as const) {
    if (existingColumns.some(column => column.table_name === table)) continue;
    await client.query(`
      UPDATE ${table} org SET owner_user_id = candidate.user_id
      FROM (
        SELECT m.${orgType}_id AS org_id, MIN(m.user_id) AS user_id
        FROM user_org_memberships m JOIN users u ON u.id = m.user_id
        JOIN ${table} company ON company.id = m.${orgType}_id
        WHERE m.role = 'admin' AND m.org_type = $1 AND u.suspended_at IS NULL
          AND (
            lower(coalesce(u.email, u.username)) = lower(company.contact_email)
            OR (trim(company.contact_name) <> '' AND lower(trim(u.display_name)) = lower(trim(company.contact_name)))
          )
        GROUP BY m.${orgType}_id HAVING count(*) = 1
      ) candidate
      WHERE org.id = candidate.org_id AND org.owner_user_id IS NULL
    `, [orgType]);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
