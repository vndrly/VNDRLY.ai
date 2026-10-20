import { describe, expect, it } from "vitest";
import { isFleetMigrationMain } from "../../scripts/migrate-fleet-mobile-workflows";

describe("Fleet mobile migration entry point", () => {
  it("runs the main function for a POSIX script path", () => {
    expect(isFleetMigrationMain(
      "file:///home/vndrly/app/artifacts/api-server/scripts/migrate-fleet-mobile-workflows.ts",
      "/home/vndrly/app/artifacts/api-server/scripts/migrate-fleet-mobile-workflows.ts",
      "linux",
    )).toBe(true);
  });
  it("does not run main when the module is imported", () => {
    expect(isFleetMigrationMain(
      "file:///home/vndrly/app/artifacts/api-server/scripts/migrate-fleet-mobile-workflows.ts",
      "/home/vndrly/app/artifacts/api-server/src/services/test.ts",
      "linux",
    )).toBe(false);
  });
});
