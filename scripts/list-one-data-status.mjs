import "./load-env-local.mjs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { Client } = require("pg");
const client = process.env.DATABASE_URL ? new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 15000 }) : null;
try {
  if (!client) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const base = process.env.SUPABASE_URL;
    if (!key || !base) throw new Error("Database configuration missing");
    const read = async (table, params) => {
      const response = await fetch(`${base}/rest/v1/${table}?${new URLSearchParams(params)}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Object.assign(new Error("Database read unavailable"), { code: `HTTP_${response.status}` });
      return response.json();
    };
    const vendorRows = await read("vendors", { select: "id,name,federal_tax_id,coi_document_url,insurance_expiration_date", name: "ilike.*midcon*" });
    const vendors = vendorRows.map((row) => ({
      id: row.id, name: row.name,
      hasTaxId: Boolean(row.federal_tax_id?.trim()),
      hasInsuranceDocument: Boolean(row.coi_document_url?.trim()),
      insuranceCurrent: Boolean(row.insurance_expiration_date && row.insurance_expiration_date >= new Date().toISOString().slice(0, 10)),
    }));
    const partners = await read("partners", { select: "id,name", or: "(name.ilike.*warwick*,name.ilike.*flywheel*)" });
    const relationships = vendors.length && partners.length ? await read("partner_vendor_relationships", {
      select: "id,vendor_id,partner_id,status", vendor_id: `in.(${vendors.map((row) => row.id).join(",")})`, partner_id: `in.(${partners.map((row) => row.id).join(",")})`,
    }) : [];
    console.log(JSON.stringify({ vendors, partners, relationships }, null, 2));
  } else {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const result = await client.query(`
    SELECT v.id AS vendor_id, v.name AS vendor, p.id AS partner_id, p.name AS partner,
           r.id AS relationship_id, r.status
    FROM vendors v CROSS JOIN partners p
    LEFT JOIN partner_vendor_relationships r ON r.vendor_id=v.id AND r.partner_id=p.id
    WHERE lower(v.name) LIKE '%midcon%'
      AND (lower(p.name) LIKE '%warwick%' OR lower(p.name) LIKE '%flywheel%')
    ORDER BY v.id,p.id`);
  const counts = await client.query(`SELECT
    (SELECT count(*) FROM partners)::int AS partners,
    (SELECT count(*) FROM work_types WHERE partner_id IS NULL)::int AS global_services,
    (SELECT count(*) FROM work_types WHERE partner_id IS NOT NULL)::int AS partner_services,
    (SELECT count(*) FROM vendor_notes)::int AS vendor_notes`);
  console.log(JSON.stringify({ relationships: result.rows, counts: counts.rows[0] }, null, 2));
  await client.query("ROLLBACK");
  }
} catch (error) {
  console.error("Read-only List One data check failed", error.code ?? error.name);
  process.exitCode = 1;
} finally { await client?.end(); }
