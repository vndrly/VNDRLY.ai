import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/work-hub/[module].tsx"), "utf8");

describe("mobile Work Hub Gate scheduling", () => {
  it("keeps Gate staffing and work-start policy in the Calendar create flow", () => {
    for (const contract of [
      'accessibilityLabel="Gate shift"',
      'accessibilityLabel="Required gatekeepers"',
      'accessibilityLabel="Start work on site"',
      'accessibilityLabel="Paid travel starts work"',
      "siteLocationId",
      "gateStationId",
      "requiredStaffCount",
      "workStartPolicy",
    ]) {
      expect(source).toContain(contract);
    }
  });
});
