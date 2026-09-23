import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { apiFetch } from "@/lib/api";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { mobileWorkHubModules } from "@/lib/work-hub-mobile";
import WorkHubDeviceSettings from "@/components/WorkHubDeviceSettings";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";

export default function WorkHubScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const membership = user?.availableMemberships?.find(x => x.id === user.activeMembershipId);
  const modules = mobileWorkHubModules(
    width >= 768,
    user?.role === "admin" || membership?.role === "admin",
    membership?.orgName,
  );
  const [status, setStatus] = useState("Loading your workspace…");
  useEffect(() => {
    let active = true;
    apiFetch("/api/work-hub/home").then(() => { if (active) setStatus("Your workspace is ready"); }).catch(() => { if (active) setStatus("Unable to load Work Hub. Check your connection and try again."); });
    return () => { active = false; };
  }, []);
  return <ScreenSafeArea style={{ backgroundColor: colors.background }}><ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
    <View style={{ gap: 8 }}><WorkHubPageTitle title="Work Hub" /><Text accessibilityLiveRegion="polite" style={{ color: colors.mutedForeground }}>{status}</Text></View>
    <View style={{ gap: 12, flexDirection: width >= 768 ? "row" : "column", flexWrap: "wrap" }}>{modules.map(({ key, icon, label }) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Open ${label}`} onPress={() => key === "askv" ? router.push("/work-hub/askv" as never) : router.push({ pathname: "/work-hub/[module]", params: { module: key } } as never)} style={({ pressed }) => ({ width: width >= 768 ? "48%" : "100%", minHeight: 68, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, opacity: pressed ? .7 : 1, backgroundColor: colors.card })}><Feather name={icon as React.ComponentProps<typeof Feather>["name"]} size={22} color={colors.primary}/><Text style={{ color: colors.text, fontSize: 17, fontWeight: "600" }}>{label}</Text></Pressable>)}</View>
    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Full billing, payroll processing and company setup are available in the VNDRLY web workspace.</Text>
    <WorkHubDeviceSettings />
  </ScrollView></ScreenSafeArea>;
}
