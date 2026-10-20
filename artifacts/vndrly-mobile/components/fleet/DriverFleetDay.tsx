import React from "react";
import { Text, View } from "react-native";
import type { FleetHomeProjection } from "@workspace/api-zod";
import FleetLegacyWorkspace from "@/components/FleetLegacyWorkspace";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useFleetHome } from "@/hooks/use-fleet-home";
import { useFleetCopy } from "@/lib/fleet-copy";

export default function DriverFleetDay({ initialRunId, projection: supplied, onOpenYard }: {
  initialRunId?: string;
  projection?: FleetHomeProjection | null;
  onOpenYard: (yardOrderId: string, runId?: string) => void;
}) {
  const colors = useColors();
  const copy = useFleetCopy();
  const home = useFleetHome(supplied === undefined);
  const projection = supplied === undefined ? home.projection : supplied;
  const capabilities = new Set(projection?.capabilities ?? []);
  const yardAction = projection?.nextAction?.kind === "report_yard_order" && projection.nextAction.yardOrderId ? projection.nextAction : null;
  const canWorkYard = capabilities.has("admin") || capabilities.has("yard") || capabilities.has("self_dispatch");
  const independent = capabilities.has("driver") && capabilities.has("self_dispatch");
  const card = { backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, gap: 10, padding: 16 } as const;

  return <View style={{ gap: 16 }}>
    <View style={card}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}>{copy("My Fleet Day")}</Text>
      <Text style={{ color: colors.mutedForeground }}>{copy("One next step from assigned work through return and closeout.")}</Text>
      {independent && <Text style={{ color: colors.text }}>{copy("You can prepare and run your own work without a separate Yard or Dispatch handoff.")}</Text>}
      {yardAction && canWorkYard && <>
        <Text style={{ color: colors.text }}>{copy("Complete the Yard hookup yourself, then return here to start the run.")}</Text>
        <TogglePillButton color="blue" accessibilityLabel={copy("Open assigned Yard Order")} onPress={() => onOpenYard(yardAction.yardOrderId!, yardAction.runId ?? undefined)}>{copy("Open assigned Yard Order")}</TogglePillButton>
      </>}
      {projection?.warnings.map(warning => <Text key={warning.id} accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(warning.message)}</Text>)}
      {!!projection?.warnings.length && <Text style={{ color: colors.text }}>{copy("Warnings affect the Fleet score but do not stop ticket work.")}</Text>}
      {supplied === undefined && home.state === "unavailable" && <><Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(home.error ?? "Driver Fleet Day is unavailable.")}</Text><TogglePillButton color="blue" onPress={home.retry}>{copy("Retry Driver Fleet Day")}</TogglePillButton></>}
    </View>
    {!yardAction && <FleetLegacyWorkspace embedded initialMode="my-day" initialRunId={initialRunId ?? projection?.nextAction?.runId ?? undefined} />}
  </View>;
}
