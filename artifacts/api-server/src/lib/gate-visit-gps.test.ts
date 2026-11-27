import { expect, it } from "vitest";
import { gateVisitGpsEvidence } from "./gate-visit-gps";
const gate = { id: "gate", name: "Movable post", latitude: 35, longitude: -97, geofenceRadiusM: 100 };
it("records a match against the physical gate", () => expect(gateVisitGpsEvidence({ latitude: 35, longitude: -97 }, gate).status).toBe("verified"));
it("records discrepancy without rejecting the visit", () => expect(gateVisitGpsEvidence({ latitude: 36, longitude: -97 }, gate).status).toBe("mismatch"));
it("records missing and invalid GPS without inventing coordinates", () => {
  expect(gateVisitGpsEvidence({}, gate)).toMatchObject({ status: "unavailable", latitude: null, longitude: null });
  expect(gateVisitGpsEvidence({ latitude: NaN, longitude: 500 }, gate).status).toBe("unavailable");
});
it("widens the boundary only for the one user and site holding a testing allowance, and marks the record", () => {
  // About 1.7 km north of the gate: outside its 500 m radius, inside the 2,000 m allowance.
  const longhorn = { ...gate, siteId: 414, geofenceRadiusM: 500 }, home = { latitude: 35.0153, longitude: -97 };
  expect(gateVisitGpsEvidence(home, longhorn, 1066)).toMatchObject({ status: "verified", radiusMeters: 2000, allowance: "testing", distanceMeters: 1701 });
  const other = gateVisitGpsEvidence(home, longhorn, 7);
  expect(other).toMatchObject({ status: "mismatch", radiusMeters: 500 });
  expect(other).not.toHaveProperty("allowance");
  expect(gateVisitGpsEvidence(home, { ...longhorn, siteId: 411 }, 1066).status).toBe("mismatch");
  expect(gateVisitGpsEvidence({ latitude: 35.03, longitude: -97 }, longhorn, 1066).status).toBe("mismatch");
});
it("does not substitute partner site coordinates for an unconfigured gate", () => expect(gateVisitGpsEvidence({ latitude: 35, longitude: -97 }, null).status).toBe("gate_unconfigured"));
