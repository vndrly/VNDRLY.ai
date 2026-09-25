import { expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { gateStationSchedulingFilter } from "./gate-location-policy";
it("requires the selected station to be active for a new or rescheduled assignment", () => {
  const query = new PgDialect().sqlToQuery(
    gateStationSchedulingFilter("gate-id"),
  );
  expect(query.sql).toContain('"gate_stations"."active"');
  expect(query.params).toEqual(["gate-id", true]);
});
it("allows cancelling an existing assignment after gate deactivation", () => {
  const query = new PgDialect().sqlToQuery(
    gateStationSchedulingFilter("gate-id", true),
  );
  expect(query.sql).toContain('"gate_stations"."id"');
  expect(query.sql).not.toContain('"active"');
  expect(query.params).toEqual(["gate-id"]);
});
