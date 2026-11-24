import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/work-hub/[module].tsx"), "utf8");
const scheduling = readFileSync(resolve(process.cwd(), "components/ShiftScheduling.tsx"), "utf8");

describe("mobile Work Hub Gate scheduling", () => {
  it("opens Calendar through the restored companion page", () => {
    expect(source).toContain('import GateWebPage from "@/components/GateWebPage"');
    expect(source).toContain('/work-hub/${encodeURIComponent(companion)}');
  });
  it("retains localized Gate staffing and both work-start policies in the mounted controls", () => {
    for (const contract of [
      't("shiftScheduling.gate")',
      'accessibilityLabel={t("shiftScheduling.required")}',
      '"shiftScheduling.on_site"',
      '"shiftScheduling.paid_travel"',
      "siteLocationId: siteId",
      "gateStationId: stationId",
      "requiredStaffCount: Number(required)",
      "workStartPolicy: policy",
    ]) expect(scheduling).toContain(contract);
  });
});
