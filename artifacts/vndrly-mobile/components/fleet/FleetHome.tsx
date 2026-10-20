import React from "react";
import { Feather } from "@expo/vector-icons";
import { Text, View, useWindowDimensions } from "react-native";
import type { FleetHomeProjection } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import type { FleetModuleId } from "./FleetShell";

type ModuleState = FleetHomeProjection["moduleStates"][number]["state"];
type Card = { id: string; label: string; helper: string; icon: string; module: FleetModuleId; state?: ModuleState };
export type FleetHomeVisibility = Partial<Record<FleetModuleId, boolean>>;

export default function FleetHome({ projection, onOpen, visibility = {} }: {
  projection: FleetHomeProjection;
  onOpen: (module: FleetModuleId, runId?: string) => void;
  visibility?: FleetHomeVisibility;
}) {
  const colors = useColors();
  const copy = useFleetCopy();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const capabilities = new Set(projection.capabilities);
  const admin = capabilities.has("admin");
  const dispatch = admin || capabilities.has("dispatch") || capabilities.has("self_dispatch");
  const yard = admin || capabilities.has("yard") || capabilities.has("dispatch") || capabilities.has("self_dispatch");
  const office = admin || capabilities.has("office");
  const driver = capabilities.has("driver");
  const state = (module: string) => projection.moduleStates.find(item => item.module === module)?.state;
  const independent = projection.mode === "my_fleet_day";
  const cards: Card[] = independent ? [
    { id: "route", label: "Route and return", helper: "Open your assigned run and next stop", icon: "navigation", module: "driver" },
    { id: "ticket", label: "Ticket state", helper: "Review the linked work and closeout", icon: "file-text", module: "driver" },
  ] : [
    ...(office ? [{ id: "attention", label: "Needs Attention", helper: "Review exceptions and closeouts", icon: "bell", module: "office" as const, state: state("compliance") }] : []),
    ...(dispatch ? [{ id: "dispatch", label: "Dispatch Board", helper: "Plan Details and release runs", icon: "truck", module: "dispatch" as const, state: state("dispatch") }] : []),
    ...(yard ? [{ id: "yard", label: "Yard Board", helper: "Assigned orders and Detail readiness", icon: "package", module: "yard" as const, state: state("yard") }] : []),
    ...(driver ? [{ id: "day", label: "My Fleet Day", helper: "Assigned run and next stop", icon: "user", module: "driver" as const }] : []),
    ...(driver || dispatch || office ? [{ id: "runs", label: "Active Runs", helper: "Current assignments and progress", icon: "repeat", module: (driver && !dispatch && !office ? "driver" : "runs") as FleetModuleId, state: state("history") }] : []),
    ...(office ? [{ id: "office", label: "Office", helper: "Commercial review and ticket state", icon: "briefcase", module: "office" as const }] : []),
    ...(admin ? [{ id: "setup", label: "Fleet Setup", helper: "Roles, resource pools, and module visibility", icon: "settings", module: "setup" as const }] : []),
    ...(admin || office || dispatch ? [{ id: "compliance", label: "Compliance", helper: "Advisory score and improvements", icon: "shield", module: "compliance" as const, state: state("compliance") }] : []),
    ...(admin || dispatch ? [{ id: "map", label: "Fleet Map", helper: "Live operational locations", icon: "map", module: "map" as const, state: state("map") }] : []),
  ];
  const shown = cards.filter(card => visibility[card.module] !== false || card.id === "setup");
  const primary = projection.nextAction;
  const actionModule = primary?.kind === "report_yard_order" ? "yard" : primary?.kind === "review_closeout" || primary?.kind === "review_ticket" || primary?.kind === "finalize_ticket" ? "office" : primary?.kind === "prepare_detail" ? "dispatch" : "driver";

  return <View style={{ gap: 16 }}>
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{copy(independent ? "My Fleet Day" : "Operations")}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{copy(independent ? "Your next job, route, and return" : "Your Fleet priorities and workspaces")}</Text>
    </View>
    {primary && <View testID="fleet-home-next" style={{ backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, gap: 10, padding: 16 }}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{copy("Next action")}</Text>
      <TogglePillButton solid accessibilityLabel={copy(primary.label)} onPress={() => onOpen(actionModule, primary.runId ?? undefined)}>{copy(primary.label)}</TogglePillButton>
    </View>}
    {projection.warnings.map(warning => <Text key={warning.id} accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(warning.message)}</Text>)}
    <View testID="fleet-home-cards" style={{ flexDirection: wide ? "row" : "column", flexWrap: "wrap", gap: 12 }}>
      {shown.map(card => <View key={card.id} testID={`fleet-home-${card.id}`} style={{ width: wide ? "48%" : "100%", minWidth: 0, backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, gap: 12, padding: 16 }}>
        <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
          <View style={{ alignItems: "center", backgroundColor: `${colors.primary}22`, borderRadius: 12, height: 40, justifyContent: "center", width: 40 }}><Feather name={card.icon as React.ComponentProps<typeof Feather>["name"]} size={21} color={colors.primary} /></View>
          <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}>{copy(card.label)}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{copy(card.helper)}</Text></View>
        </View>
        {card.state === "unavailable" && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(`${card.label} unavailable`)}</Text>}
        {card.state === "warning" && <Text style={{ color: colors.destructive }}>{copy(`${card.label} needs attention`)}</Text>}
        <TogglePillButton color="blue" accessibilityLabel={copy(`Open ${card.label}`)} onPress={() => onOpen(card.module)}>{copy(`Open ${card.label}`)}</TogglePillButton>
      </View>)}
    </View>
  </View>;
}
