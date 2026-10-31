import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import {
  canonicalServicesTable, canonicalServiceAliasesTable, serviceMappingsTable,
  vendorCapabilitiesTable, vendorServiceAreasTable, vendorPartnerServiceOffersTable,
  jobOffersTable, jobOfferAcceptanceSnapshotsTable, ticketsTable,
} from "@workspace/db/schema";

// Only trusted Drizzle metadata becomes SQL identifiers or expressions.
const marketplaceTables = [canonicalServicesTable, canonicalServiceAliasesTable,
  vendorCapabilitiesTable, vendorServiceAreasTable, vendorPartnerServiceOffersTable,
  serviceMappingsTable, jobOffersTable, jobOfferAcceptanceSnapshotsTable];
const ticketLineage = new Set(["canonical_service_id", "vendor_capability_id", "vendor_partner_service_offer_id", "job_offer_id"]);
const dialect = new PgDialect();
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const render = (value: SQL) => {
  const query = dialect.sqlToQuery(value);
  if (query.params.length) throw new Error("Migration metadata must not contain bound parameters");
  return query.sql;
};
const bare = (expression: string, table: string) => expression.replaceAll(`${quote(table)}.`, "");
const normalize = (value: string) => value.replaceAll('"', "").replace(/::text\b/g, "").replace(/[\s()]/g, "").toLowerCase();

function columnDefinition(column: PgColumn, verification = false): string {
  const type = column.getSQLType();
  // Verification tables need an integer, not a new sequence for serial IDs.
  let definition = `${quote(column.name)} ${verification && type === "serial" ? "integer" : type}`;
  if (column.notNull) definition += " NOT NULL";
  if (column.default !== undefined && type !== "serial") {
    const value = column.default;
    definition += ` DEFAULT ${value instanceof SQL ? render(value) : typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(value)}`;
  }
  return definition;
}

function columnsFor(table: PgTable) {
  return getTableConfig(table).columns.filter((column) => table !== ticketsTable || ticketLineage.has(column.name));
}

/** Validate reruns against types/defaults, constraints, ownership, indexes and RLS. */
export async function verifyMarketplaceSchema(client: pg.Client): Promise<void> {
  const verificationId = randomUUID().replaceAll("-", "").slice(0, 8);
  for (const table of [...marketplaceTables, ticketsTable]) {
    const config = getTableConfig(table);
    const expectedName = `marketplace_${verificationId}_${config.name}`;
    const columns = columnsFor(table);
    const checks = table === ticketsTable ? [] : config.checks;
    const definitions = [
      ...columns.map((column) => columnDefinition(column, true)),
      ...checks.map((check) => `CONSTRAINT ${quote(check.name)} CHECK (${bare(render(check.value), config.name)})`),
    ];
    // PostgreSQL canonicalizes expressions in this session-local reference table,
    // so a same-named but weakened live check cannot pass verification.
    await client.query(`CREATE TEMP TABLE ${quote(expectedName)} (${definitions.join(", ")})`);
    const result = await client.query(`
      SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
        pg_get_expr(d.adbin, d.adrelid) AS default_expression
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`, [`public.${config.name}`]);
    const expected = await client.query(`
      SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
        pg_get_expr(d.adbin, d.adrelid) AS default_expression
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`, [expectedName]);
    for (const column of columns) {
      const actual = result.rows.find((row) => row.attname === column.name);
      const wanted = expected.rows.find((row) => row.attname === column.name);
      if (!actual || actual.type !== wanted.type || actual.attnotnull !== wanted.attnotnull ||
        (column.getSQLType() === "serial" ? !actual.default_expression?.startsWith("nextval(") : actual.default_expression !== wanted.default_expression)) {
        throw new Error(`Marketplace column mismatch: ${config.name}.${column.name}`);
      }
    }
    const constraints = await client.query(`SELECT conname, contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = $1::regclass`, [`public.${config.name}`]);
    const expectedChecks = await client.query(`SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'`, [expectedName]);
    for (const wanted of expectedChecks.rows) {
      if (!constraints.rows.some((row) => row.conname === wanted.conname && row.definition === wanted.definition)) {
        throw new Error(`Marketplace check mismatch: ${config.name}.${wanted.conname}`);
      }
    }
    for (const fk of config.foreignKeys.filter((key) => table !== ticketsTable || key.reference().columns.some((col) => ticketLineage.has(col.name)))) {
      const ref = fk.reference();
      const target = getTableConfig(ref.foreignTable).name;
      const wanted = `FOREIGN KEY (${ref.columns.map((col) => quote(col.name)).join(", ")}) REFERENCES ${quote(target)}(${ref.foreignColumns.map((col) => quote(col.name)).join(", ")})`;
      const actual = constraints.rows.find((row) => row.conname === fk.getName().slice(0, 63));
      if (!actual || normalize(actual.definition) !== normalize(wanted)) {
        throw new Error(`Marketplace foreign key mismatch: ${config.name}.${fk.getName()}`);
      }
    }
    if (table !== ticketsTable) {
      const primary = constraints.rows.find((row) => row.contype === "p");
      if (normalize(primary?.definition ?? "") !== "primarykeyid") throw new Error(`Marketplace primary key mismatch: ${config.name}`);
      const rls = await client.query("SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass", [`public.${config.name}`]);
      if (!rls.rows[0]?.relrowsecurity) throw new Error(`Marketplace RLS missing: ${config.name}`);
    }
    for (const index of config.indexes.filter(index => table !== ticketsTable || index.config.columns.every(column => "name" in column && ticketLineage.has(column.name!)))) {
      const definition = index.config;
      const result = await client.query(`SELECT i.indisunique, i.indisvalid, i.indnkeyatts,
        pg_get_expr(i.indpred, i.indrelid) AS predicate,
        ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true) FROM generate_series(1, i.indnkeyatts) n) AS columns
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = $1::regclass AND c.relname = $2`, [`public.${config.name}`, definition.name]);
      const actual = result.rows[0];
      const wantedColumns = definition.columns.map((column) => {
        if (!("name" in column)) throw new Error("Marketplace expression index requires explicit migration support");
        return column.name;
      });
      const predicate = definition.where ? bare(render(definition.where), config.name) : "";
      if (!actual?.indisvalid || actual.indisunique !== definition.unique ||
        JSON.stringify(actual.columns) !== JSON.stringify(wantedColumns) || normalize(actual.predicate ?? "") !== normalize(predicate)) {
        throw new Error(`Marketplace index mismatch: ${config.name}.${definition.name}`);
      }
    }
  }
}

export async function migrateSemanticServiceMarketplace(client: pg.Client): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await client.query("SELECT pg_advisory_xact_lock(2026101801)");
    await client.query("SET LOCAL search_path = public, pg_catalog");
    const before = await client.query("SELECT count(*)::text AS count FROM tickets");
    for (const table of marketplaceTables) {
      const config = getTableConfig(table);
      const definitions = columnsFor(table).map((column) => `${columnDefinition(column)}${column.primary ? " PRIMARY KEY" : ""}`);
      definitions.push(...config.checks.map((check) => `CONSTRAINT ${quote(check.name)} CHECK (${bare(render(check.value), config.name)})`));
      await client.query(`CREATE TABLE IF NOT EXISTS public.${quote(config.name)} (${definitions.join(", ")})`);
      await client.query(`ALTER TABLE public.${quote(config.name)} ENABLE ROW LEVEL SECURITY`);
    }
    for (const column of columnsFor(ticketsTable)) {
      await client.query(`ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS ${columnDefinition(column)}`);
    }
    for (const table of [...marketplaceTables, ticketsTable]) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys.filter((key) => table !== ticketsTable || key.reference().columns.some((col) => ticketLineage.has(col.name)))) {
        const name = fk.getName().slice(0, 63);
        const existing = await client.query("SELECT 1 FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2", [`public.${config.name}`, name]);
        if (existing.rowCount) continue;
        const ref = fk.reference();
        await client.query(`ALTER TABLE public.${quote(config.name)} ADD CONSTRAINT ${quote(name)} FOREIGN KEY (${ref.columns.map((col) => quote(col.name)).join(", ")}) REFERENCES public.${quote(getTableConfig(ref.foreignTable).name)} (${ref.foreignColumns.map((col) => quote(col.name)).join(", ")})`);
      }
      for (const index of config.indexes.filter(index => table !== ticketsTable || index.config.columns.every(column => "name" in column && ticketLineage.has(column.name!)))) {
        const definition = index.config;
        const columns = definition.columns.map((column) => {
          if (!("name" in column) || !column.name) throw new Error("Marketplace expression index requires explicit migration support");
          return quote(column.name);
        });
        await client.query(`CREATE ${definition.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quote(definition.name!)} ON public.${quote(config.name)} (${columns.join(", ")})${definition.where ? ` WHERE ${bare(render(definition.where), config.name)}` : ""}`);
      }
    }
    await verifyMarketplaceSchema(client);
    const after = await client.query("SELECT count(*)::text AS count FROM tickets");
    if (before.rows[0].count !== after.rows[0].count) throw new Error("Ticket count changed during marketplace migration");
    await client.query("COMMIT");
    console.log(JSON.stringify({ marketplaceTables: marketplaceTables.length, ticketsPreserved: after.rows[0].count }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.APPLY_SEMANTIC_SERVICE_MARKETPLACE !== "1" || !process.env.DATABASE_URL) {
    throw new Error("Set APPLY_SEMANTIC_SERVICE_MARKETPLACE=1 and an explicit DATABASE_URL after target review");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await migrateSemanticServiceMarketplace(client);
  } finally {
    await client.end();
  }
}
