import { expect, it } from "vitest";
import { gateVisitGpsEvidence } from "./gate-visit-gps";
const gate = { id: "gate", name: "Movable post", latitude: 35, longitude: -97, geofenceRadiusM: 100 };
it("records a match against the physical gate", () => expect(gateVisitGpsEvidence({ latitude: 35, longitude: -97 }, gate).status).toBe("verified"));
it("records discrepancy without rejecting the visit", () => expect(gateVisitGpsEvidence({ latitude: 36, longitude: -97 }, gate).status).toBe("mismatch"));
it("records missing and invalid GPS without inventing coordinates", () => {
  expect(gateVisitGpsEvidence({}, gate)).toMatchObject({ status: "unavailable", latitude: null, longitude: null });
  expect(gateVisitGpsEvidence({ latitude: NaN, longitude: 500 }, gate).status).toBe("unavailable");
});
it("does not substitute partner site coordinates for an unconfigured gate", () => expect(gateVisitGpsEvidence({ latitude: 35, longitude: -97 }, null).status).toBe("gate_unconfigured"));
