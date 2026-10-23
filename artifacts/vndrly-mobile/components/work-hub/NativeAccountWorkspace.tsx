import React from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { FleetOverview } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope } from "@/lib/auth";
import { nativeAccountWorkspaces } from "@/lib/account-workspace-native";
export default function NativeAccountWorkspace() {
  const { user, activeMembership, activeMembershipId } = useAuth();
  const membership = activeMembership ?? user?.availableMemberships?.find(item => item.id === (activeMembershipId ?? user.activeMembershipId));
  const scope = captureAuthScope(), identity = JSON.stringify([user?.id, activeMembershipId ?? user?.activeMembershipId, user?.vendorId, user?.partnerId, user?.vendorRole, membership?.role, membership?.orgType, membership?.orgId]);
  return user?.id ? <Workspace key={`${identity}:${scope.generation}`} user={user} membership={membership} identity={identity} scope={scope} /> : null;
}
function Workspace({ user, membership, identity, scope }: { user: NonNullable<ReturnType<typeof useAuth>["user"]>; membership: ReturnType<typeof useAuth>["activeMembership"] | undefined; identity: string; scope: ReturnType<typeof captureAuthScope> }) {
  const colors = useColors(), { i18n } = useTranslation();
  const operations = useQuery({ queryKey: ["native-workforce-operations", identity, scope.generation], queryFn: async () => {
    const result = await apiFetch<{ vendorId: number; categories: string[] }>("/api/company-operations", {}, scope);
    if (result.vendorId !== user.vendorId || !Array.isArray(result.categories)) throw Error("Company context changed");
    return result;
  }, enabled: !!user.vendorId && membership?.orgType !== "partner", retry: false });
  const categories = operations.isSuccess ? operations.data.categories : [];
  const fleet = useQuery({ queryKey: ["native-account-fleet", identity, scope.generation], queryFn: () => apiFetch<FleetOverview>("/api/fleet/overview", {}, scope), enabled: !!user.vendorId && membership?.orgType !== "partner" && !user.managedSubcontractor && categories.includes("fleet"), retry: false });
  const cards = nativeAccountWorkspaces(user, categories, membership, fleet.isSuccess ? fleet.data : undefined, (en, es) => i18n.language.startsWith("es") ? es : en);
  return <View style={{ gap: 12 }}>{cards.map(card => <View key={card.title} style={{ backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingTop: 16 }}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}>{card.title}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12, paddingBottom: 14 }}>{card.subtitle}</Text>{card.actions.map(action => <Pressable key={action.href} accessibilityRole="button" accessibilityLabel={action.label} onPress={() => router.push(action.href as never)} style={{ borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 }}><Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>{action.label}</Text><Text style={{ color: colors.mutedForeground }}>›</Text></Pressable>)}</View>)}</View>;
}
