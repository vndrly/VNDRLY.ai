import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { fleetYardsTable } from "../../../../lib/db/src/schema/fleetYards";
import { fleetPersonCapabilitiesTable } from "../../../../lib/db/src/schema/fleetPersonCapabilities";
import { fleetYardOrdersTable, fleetYardOrderAssignmentsTable, fleetYardOrderEventsTable } from "../../../../lib/db/src/schema/fleetYardOrders";
import { fleetAssetCustodyTable, fleetAssetCustodyEventsTable } from "../../../../lib/db/src/schema/fleetAssetCustody";

describe("Fleet mobile fresh-schema CHECK parity", () => {
  it("declares every migration CHECK in Drizzle's schema", () => {
    for (const [table, expected] of [
      [fleetYardsTable, ["version"]],
      [fleetPersonCapabilitiesTable, ["version", "values", "self_dispatch"]],
      [fleetYardOrdersTable, ["version", "status", "report", "report_presence", "findings"]],
      [fleetYardOrderAssignmentsTable, ["time"]],
      [fleetYardOrderEventsTable, ["version", "detail"]],
      [fleetAssetCustodyTable, ["version", "state", "method", "coordinates", "coordinates_pair"]],
      [fleetAssetCustodyEventsTable, ["version", "state", "method", "coordinates", "coordinates_pair"]],
    ] as const) {
      const config = getTableConfig(table);
      expect(config.checks.map((check) => check.name).sort()).toEqual(
        expected.map((suffix) => `${config.name}_${suffix}_check`).sort(),
      );
    }
  });
});
