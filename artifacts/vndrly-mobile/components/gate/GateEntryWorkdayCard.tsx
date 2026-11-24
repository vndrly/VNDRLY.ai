import React from "react";
import { View } from "react-native";
import WorkdayControls from "@/components/WorkdayControls";
import GateSiteGateSelect from "@/components/GateSiteGateSelect";

export type GateEntryWorkdayData = {
  sites: { id: number; name: string }[];
  siteId: number;
  gateId: string;
  gateName: string;
  gpsStatus: "verified" | "mismatch" | "unavailable";
  gpsLabel: string;
  gpsDetail: string;
};

export default function GateEntryWorkdayCard({ data, onSelection }: { data: GateEntryWorkdayData; onSelection: (siteId: number, gateId: string) => void }) {
  return <WorkdayControls webCard watchControl={<View style={{ width: "100%", maxWidth: 394 }}><GateSiteGateSelect
    compact stationOnly sites={data.sites} siteId={data.siteId}
    gate={data.gateId ? { id: data.gateId, name: data.gateName } : undefined}
    gpsStatus={data.gpsStatus} gpsLabel={data.gpsLabel} gpsDetail={data.gpsDetail}
    onChange={onSelection}
  /></View>} />;
}
