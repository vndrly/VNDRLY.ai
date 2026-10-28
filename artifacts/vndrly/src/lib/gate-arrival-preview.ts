import type { GateArrivalDetail, GateArrivalsResponse } from "@workspace/api-zod";

/** Explicit development preview only. Never creates runs, GPS proof or passage permission. */
export function isGateArrivalPreview() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get("sampleArrivals") === "1";
}

export function sampleGateArrivals(siteId: number): GateArrivalsResponse {
  return {
    generatedAt: new Date().toISOString(), truncated: false,
    arrivals: [
      ["Mason Cole", "Red River Hauling", "Truck 24 · TX KMT4821", "Produced-water delivery", 6],
      ["Elena Ruiz", "Prairie Star Logistics", "Vac truck 12 · OK JPV703", "Return haul · load 2 of 3", 14],
      ["Travis Bennett", "Basin Transport", "Truck 38 · TX RHB2196", "Fresh-water delivery", 22],
      ["Nina Patel", "Permian Supply Co.", "Flatbed 17 · NM RDK517", "Pipe and fittings delivery", 28],
      ["Caleb Brooks", "High Plains Services", "Service truck 9 · TX VSN6402", "Generator maintenance", 35],
    ].map(([driver, company, vehicle, title, eta], index) => ({
      id: `sample-inbound-${siteId}-${index + 1}`, runId: `sample-inbound-${siteId}-${index + 1}`,
      ticketId: 4101 + index, ticketNumber: `SAMPLE-${4101 + index}`, title: String(title),
      driverName: String(driver), companyName: String(company), vehicleLabel: String(vehicle),
      status: "in_progress", phase: "traveling_to_next_stop", etaMinutes: Number(eta),
      etaUnavailableReason: null, observedAt: new Date().toISOString(), destinationName: "Selected site",
      siteLocationId: siteId, physicalProofVerified: false,
    })),
  };
}

export function sampleGateArrivalDetail(siteId: number, runId: string): GateArrivalDetail | undefined {
  const arrival = sampleGateArrivals(siteId).arrivals.find(row => row.runId === runId);
  return arrival ? { ...arrival, detailScope: "selected_site", runComplete: false,
    stops: [], loads: [], events: [], linkedVisitIds: [] } : undefined;
}
