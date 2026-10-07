import { z } from "zod/v4";
export const FleetSiteActivityFilterSchema = z
  .object({
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.startsAt ||
      !value.endsAt ||
      Date.parse(value.endsAt) > Date.parse(value.startsAt),
    "End must follow start",
  );
export type FleetSiteActivity = {
  siteId: number;
  siteName: string;
  window: { startsAt: string; endsAt: string; dateBasis: "run_created_at" };
  records: {
    runId: string;
    vendorName: string;
    status: string;
    stops: {
      stopId: string;
      kind: string;
      events: {
        type: string;
        recordedAt: string;
        capturedAt: string | null;
        source: "user_report";
      }[];
    }[];
    loads: {
      loadId: string;
      commodity: string;
      quantity: number;
      unit: string;
      direction: "pickup" | "delivery" | "pickup_and_delivery";
      delivered: boolean;
    }[];
  }[];
  source: "recorded_fleet_events";
  coordinateDisclosure: false;
  unavailableMetrics: string[];
};
export type FleetSiteChoices = {
  sites: { siteId: number; name: string }[];
  capabilities: {
    canReadSiteActivity: true;
    canDispatch: false;
    canDrive: false;
  };
};
