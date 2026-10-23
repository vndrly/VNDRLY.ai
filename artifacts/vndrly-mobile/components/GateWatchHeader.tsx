import React from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import type { ChangeOverState } from "@workspace/gate-booth";
import WatchPassControl from "@/components/WatchPassControl";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { captureAuthScope } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

/** Watch custody is changed only through the existing review/handover flow. */
export default function GateWatchHeader({ siteId, stationId }: { siteId: number | null; stationId?: string }) {
  const { user, activeMembershipId } = useAuth();
  const { t } = useTranslation();
  const colors = useColors();
  const authScope = captureAuthScope();
  const state = useQuery({
    queryKey: ["change-over-state", user?.id, activeMembershipId, authScope.generation, stationId],
    queryFn: ({ signal }) => apiFetch<ChangeOverState>(`/api/gate-change-over/${stationId}/state`, { signal }, authScope),
    enabled: Boolean(user && stationId), retry: false, refetchInterval: 15_000,
  });
  const own = Boolean(state.data?.shift && state.data.shift.operator_id === user?.id);
  if (!stationId) return null;
  return <View testID="gate-watch-summary" style={{ alignItems: "center", gap: 2, flexShrink: 0, maxWidth: 190, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, borderRadius: 8 }}>
    {state.data?.shift ? <Text style={{ color: colors.foreground, fontSize: 10 }}>{state.data.shift.operator_name} · {new Date(state.data.shift.started_at).toLocaleTimeString()}</Text> : null}
    <WatchPassControl compact active={own} disabled={!state.data || state.isError} label={t(own ? "watch.handover" : "watch.assume")} onPress={() => router.push({ pathname: "/(tabs)/change-over", params: { siteId: String(siteId), stationId } } as never)} />
  </View>;
}
