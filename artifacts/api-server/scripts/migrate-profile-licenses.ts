import pg from 'pg';
import { guardAdditiveReplay } from '../../../scripts/guard-additive-replay.mjs';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(guardAdditiveReplay(`CREATE TABLE IF NOT EXISTS employee_licenses (
    id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES vendor_people(id),
    details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
  ); CREATE INDEX IF NOT EXISTS employee_licenses_employee_idx ON employee_licenses(employee_id);`));
  console.log('Profile license storage ready; existing credentials unchanged.');
} finally { await client.end(); }
