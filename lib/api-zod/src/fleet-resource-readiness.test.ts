import { expect, it } from "vitest";
import * as api from "./index";
const exports = api as unknown as Record<string, any>;
const truck = {
  kind: "vehicle",
  id: "22222222-2222-4222-8222-222222222222",
} as const;
const driver = { kind: "driver", id: 7 } as const;
const at = "2026-10-16T18:00:00Z";
const summary = (subject: typeof truck | typeof driver, status = "green") => ({
  subject,
  status,
  evaluatedAt: at,
  freshness: "current",
  reasons:
    status === "green"
      ? []
      : [
          {
            requirementId: "license",
            requirementVersion: 1,
            category: "driver_license",
            reason: "expired",
            label: "Recorded requirement expired",
          },
        ],
  dueSoon: [],
});
it("marks every selected component and driver independently, with unknown or cached evidence remaining red", () => {
  expect(exports.fleetResourceReadiness).toBeTypeOf("function");
  expect(
    exports.fleetResourceReadiness(
      [truck, driver],
      [summary(truck), summary(driver)],
    ),
  ).toMatchObject({ status: "green", reasons: [] });
  expect(
    exports.fleetResourceReadiness(
      [truck, driver],
      [summary(truck), summary(driver, "red")],
    ),
  ).toMatchObject({ status: "red", reasons: ["expired"] });
  expect(
    exports.fleetResourceReadiness([truck, driver], [summary(truck)]),
  ).toMatchObject({ status: "red", reasons: ["unverified"] });
  expect(
    exports.fleetResourceReadiness(
      [truck],
      [{ ...summary(truck), freshness: "cached" }],
    ),
  ).toMatchObject({ status: "red", reasons: ["unverified"] });
  expect(exports.fleetResourceReadiness([], []).status).toBe("red");
});
it("does not choose between contradictory duplicate assessments or pass raw private fields", () => {
  expect(exports.fleetResourceReadiness).toBeTypeOf("function");
  expect(
    exports.fleetResourceReadiness(
      [driver],
      [summary(driver), summary(driver, "red")],
    ).status,
  ).toBe("red");
  expect(() =>
    exports.fleetResourceReadiness(
      [driver],
      [{ ...summary(driver), licenseNumber: "PRIVATE" }],
    ),
  ).toThrow();
});
