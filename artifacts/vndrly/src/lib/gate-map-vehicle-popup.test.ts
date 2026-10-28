import { expect, it } from "vitest";
import type { GateMapVehicle } from "@workspace/api-zod";
import { gateMapVehiclePopup } from "./gate-map-vehicle-popup";

it("escapes operational text and shows speed, route, ETA, heading and observation details", () => {
  const html = gateMapVehiclePopup({ vehicleLabel: '<img onerror="alert(1)">', driverName: "Driver", companyName: "Fleet & Co", title: "Haul", ticketNumber: "T1", speedMph: 45.6, originName: "Yard", destinationName: "Gate", etaMinutes: 12.1, headingDegrees: 91.2, accuracyMeters: 8, observedAt: "2026-10-28T12:00:00Z" } as GateMapVehicle);
  expect(html).not.toContain('<img onerror=');
  expect(html).toContain("&lt;img");
  expect(html).toContain("Fleet &amp; Co");
  for (const value of ["46 mph", "Yard", "Gate", "~13 min", "91°", "±8 m", "Last update"]) expect(html).toContain(value);
});
