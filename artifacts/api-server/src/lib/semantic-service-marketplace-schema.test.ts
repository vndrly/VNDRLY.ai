import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableName, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";

const dialect = new PgDialect();
const render = (sql: SQL) => dialect.sqlToQuery(sql).sql;
const tables = [
  ["canonicalServicesTable", "canonical_services"],
  ["canonicalServiceAliasesTable", "canonical_service_aliases"],
  ["serviceMappingsTable", "service_mappings"],
  ["vendorCapabilitiesTable", "vendor_capabilities"],
  ["vendorServiceAreasTable", "vendor_service_areas"],
  ["vendorPartnerServiceOffersTable", "vendor_partner_service_offers"],
  ["jobOffersTable", "job_offers"],
  ["jobOfferAcceptanceSnapshotsTable", "job_offer_acceptance_snapshots"],
] as const;
const table = (key: string) => (schema as unknown as Record<string, PgTable>)[key]!;
const config = (key: string) => getTableConfig(table(key));
const checks = (key: string) => config(key).checks.map((check) => render(check.value)).join(" ");
const foreignKeys = (key: string) => config(key).foreignKeys.map((fk) => {
  const ref = fk.reference();
  return [ref.columns.map((col) => col.name).join(","), getTableName(ref.foreignTable)];
});

describe("semantic service marketplace schema contract", () => {
  it("keeps durable legacy selection lineage without preventing catalog removal or replacement", () => {
    const offer = config("vendorPartnerServiceOffersTable");
    expect(offer.columns.find(column => column.name === "source_vendor_work_type_id")?.getSQLType()).toBe("integer");
    expect(offer.foreignKeys.some(key => key.reference().columns.some(column => column.name === "source_vendor_work_type_id"))).toBe(false);
  });
  it.each(tables)("exports %s as %s", (key, name) => {
    expect(table(key), `Missing ${key}`).toBeDefined();
    expect(getTableName(table(key))).toBe(name);
  });

  it("persists the shared mapping and offer lifecycle values", () => {
    expect(schema.SERVICE_MAPPING_SUBJECT_TYPES).toEqual(["partner_work_type", "vendor_capability"]);
    expect(schema.SERVICE_MAPPING_STATUSES).toEqual(["active", "review_required", "rejected", "superseded"]);
    expect(schema.JOB_OFFER_STATUSES).toEqual(["draft", "offered", "vendor_reviewing", "accepted", "declined", "expired", "withdrawn"]);
  });

  it("retains mapping subject ownership and only one current active mapping", () => {
    expect(foreignKeys("serviceMappingsTable")).toEqual(expect.arrayContaining([
      ["canonical_service_id", "canonical_services"], ["work_type_id", "work_types"],
      ["vendor_capability_id", "vendor_capabilities"], ["actor_user_id", "users"],
    ]));
    const current = config("serviceMappingsTable").indexes.find((index) => index.config.name === "service_mappings_current_active_unique")!;
    expect(current.config.unique).toBe(true);
    expect(current.config.columns.map((col) => "name" in col ? col.name : null)).toEqual(["subject_type", "subject_id"]);
    expect(render(current.config.where!)).toContain("'active'");
    expect(render(current.config.where!)).toMatch(/superseded_at.*is null/i);
    expect(checks("serviceMappingsTable")).toMatch(/confidence.*>= 0.*confidence.*<= 1/);
    expect(checks("serviceMappingsTable")).toContain("partner_work_type");
    expect(checks("serviceMappingsTable")).toContain("vendor_capability");
  });

  it("owns vendor supply, geographic coverage, and partner-specific rates", () => {
    expect(foreignKeys("vendorCapabilitiesTable")).toContainEqual(["vendor_id", "vendors"]);
    expect(foreignKeys("vendorServiceAreasTable")).toContainEqual(["vendor_capability_id", "vendor_capabilities"]);
    expect(foreignKeys("vendorPartnerServiceOffersTable")).toEqual(expect.arrayContaining([
      ["partner_id", "partners"], ["work_type_id", "work_types"], ["vendor_capability_id", "vendor_capabilities"],
    ]));
    const unique = config("vendorPartnerServiceOffersTable").indexes.find((index) => index.config.unique)!;
    expect(unique.config.columns.map((col) => "name" in col ? col.name : null)).toEqual(["vendor_capability_id", "partner_id", "work_type_id"]);
    expect(checks("vendorCapabilitiesTable")).toMatch(/capacity.*> 0/);
    expect(checks("vendorServiceAreasTable")).toMatch(/radius_miles.*> 0/);
    expect(config("vendorServiceAreasTable").columns.find((col) => col.name === "latitude")!.getSQLType()).toBe("double precision");
    expect(config("vendorServiceAreasTable").columns.find((col) => col.name === "radius_miles")!.getSQLType()).toMatch(/^numeric/);
  });

  it("prevents duplicate offers, tickets and acceptance snapshots", () => {
    const uniqueColumns = (key: string) => config(key).indexes.filter((index) => index.config.unique)
      .map((index) => index.config.columns.map((col) => "name" in col ? col.name : null));
    expect(uniqueColumns("jobOffersTable")).toContainEqual(["partner_id", "idempotency_key"]);
    expect(uniqueColumns("jobOffersTable")).toContainEqual(["created_ticket_id"]);
    expect(uniqueColumns("ticketsTable")).toContainEqual(["job_offer_id"]);
    expect(uniqueColumns("jobOfferAcceptanceSnapshotsTable")).toContainEqual(["job_offer_id"]);
    expect(foreignKeys("jobOffersTable")).toContainEqual(["site_location_id", "site_locations"]);
    expect(foreignKeys("jobOffersTable")).toContainEqual(["created_ticket_id", "tickets"]);
    expect(config("jobOffersTable").columns.find((col) => col.name === "commercial_snapshot")!.getSQLType()).toBe("jsonb");
    for (const name of ["canonical_service_id", "vendor_capability_id", "job_offer_id"]) {
      expect(config("ticketsTable").columns.find((col) => col.name === name)?.notNull).toBe(false);
    }
    expect(foreignKeys("ticketsTable")).toEqual(expect.arrayContaining([
      ["canonical_service_id", "canonical_services"], ["vendor_capability_id", "vendor_capabilities"], ["job_offer_id", "job_offers"],
    ]));
  });

  it("ships an opt-in, transactional additive migration and guarded deployment", () => {
    const migration = readFileSync(new URL("../../scripts/migrate-semantic-service-marketplace.ts", import.meta.url), "utf8");
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/i);
    expect(migration).toContain("APPLY_SEMANTIC_SERVICE_MARKETPLACE");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain('"BEGIN"');
    expect(migration).toContain('"COMMIT"');
    expect(migration).toContain('"ROLLBACK"');
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS");
    expect(migration).toContain("verifyMarketplaceSchema");
    const workflow = readFileSync(new URL("../../../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
    expect(workflow).toContain("APPLY_SEMANTIC_SERVICE_MARKETPLACE=1 pnpm --filter @workspace/api-server run migrate:semantic-service-marketplace");
  });
});
