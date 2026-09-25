import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { gateStationsTable } from "@workspace/db/schema";
import { readFileSync } from "node:fs";
import { validateGateLocationMigration } from "../../scripts/migrate-gate-locations";
describe("gate location additive storage", () => {
  it("keeps independent nullable coordinates and versioned active station defaults", () => {
    const columns = getTableConfig(gateStationsTable).columns;
    for (const name of [
      "latitude",
      "longitude",
      "geofence_radius_m",
      "active",
      "version",
    ])
      expect(columns.find((c) => c.name === name)).toBeDefined();
    expect(columns.find((c) => c.name === "latitude")?.notNull).toBe(false);
    expect(columns.find((c) => c.name === "version")?.default).toBe(1);
  });
  it("refuses unsafe migration statements before any database connection", () => {
    expect(() =>
      validateGateLocationMigration("UPDATE site_locations SET latitude=1;"),
    ).toThrow();
    expect(() =>
      validateGateLocationMigration(
        "ALTER TABLE gate_stations ADD COLUMN latitude double precision;",
      ),
    ).toThrow();
    expect(() =>
      validateGateLocationMigration(
        "CREATE INDEX IF NOT EXISTS x ON gate_stations(id); DROP TABLE gate_stations;",
      ),
    ).toThrow();
  });
  it("runs gate locations after its base table migration during deployment", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/deploy-api.yml", import.meta.url),
      "utf8",
    );
    expect(workflow.indexOf("run migrate:gate-locations")).toBeGreaterThan(
      workflow.indexOf("run migrate:gate-change-over"),
    );
  });
  it("allows replay using only guarded additions without changing existing station or partner rows", () => {
    const migration = readFileSync(
      new URL(
        "../../../../lib/db/drizzle/gate_location_management.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(() => validateGateLocationMigration(migration)).not.toThrow();
    const statements = migration
      .split(";")
      .map((s) => s.replace(/--[^\n]*/g, "").trim())
      .filter(Boolean);
    expect(statements.length).toBe(6);
    for (const statement of statements)
      expect(statement).toMatch(
        /^(ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS|CREATE INDEX IF NOT EXISTS)/,
      );
    expect(migration).not.toMatch(
      /\b(?:UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i,
    );
  });
});
