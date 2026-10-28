/** Gate-only operational disclosure; never serialize a complete FleetRun here. */
export type GateArrival = {
  id: string;
  runId: string;
  ticketId: number;
  ticketNumber: string;
  title: string;
  driverName: string | null;
  vehicleLabel: string | null;
  companyName: string;
  status: string;
  phase: string | null;
  etaMinutes: number | null;
  etaUnavailableReason: string | null;
  observedAt: string | null;
  destinationName: string;
  siteLocationId: number;
  physicalProofVerified: false;
};
export type GateArrivalsResponse = { arrivals: GateArrival[]; truncated: boolean; generatedAt: string };
/** A currently shared driver-phone position for an authorized incoming run. */
export type GateMapVehicle = GateArrival & {
  latitude: number; longitude: number; accuracyMeters: number | null;
  speedMph: number | null; headingDegrees: number | null; originName: string | null;
};
export type GateArrivalDetail = GateArrival & {
  detailScope: "selected_site";
  runComplete: boolean;
  stops: { id: string; kind: string; destinationName: string; state: "pending" | "current" | "visited" }[];
  loads: { id: string; commodity: string; quantity: number; unit: string; deliveredAt: string | null }[];
  events: { type: string; recordedAt: string }[];
  linkedVisitIds: number[];
};
