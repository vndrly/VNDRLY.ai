import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions, type DimensionValue } from "react-native";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import {useDailySummary} from "@/lib/daily-workspace";
type DailyWorkHubSummary={calendarCount:number|null;myWorkCount:number|null;attentionCount:number|null;safetyCount:number|null};
import NativeOperations from "@/components/work-hub/NativeOperations";
import NativeJournal from "@/components/work-hub/NativeJournal";
import NativeWorkforce from "@/components/work-hub/NativeWorkforce";
import NativeAccountWorkspace from "@/components/work-hub/NativeAccountWorkspace";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { mobileWorkHubModules, type MobileWorkHubCapabilities } from "@/lib/work-hub-mobile";

type HomeData = { tasks?: unknown[]; announcements?: unknown[]; shifts?: unknown[]; meetings?: unknown[]; capabilities?: MobileWorkHubCapabilities | null };
type TodayItemProps = { icon: React.ComponentProps<typeof Feather>["name"]; label: string; value: string; onPress: () => void };
function TodayItem({ icon, label, value, onPress }: TodayItemProps) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${label}`} onPress={onPress} style={({ pressed }) => ({ alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 11, opacity: pressed ? .7 : 1, paddingVertical: 13 })}>
    <Feather name={icon} size={19} color={colors.primary} />
    <Text style={{ color: colors.text, flex: 1, fontSize: 15, fontWeight: "600" }}>{label}</Text>
    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{value}</Text>
    <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
  </Pressable>;
}

function TodayCard({ title, width, myWorkTitle, daily, tasks }: { title: string; width: DimensionValue; myWorkTitle: string; daily?: DailyWorkHubSummary; tasks?: number }) {
  const colors = useColors();
  return <View style={{ backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, paddingHorizontal: 16, paddingTop: 16, ...(width === "100%" ? { width } : { flex: 1, minWidth: 0 }) }}>
    <View style={{ alignItems: "center", flexDirection: "row", gap: 10, paddingBottom: 14 }}>
      <View style={{ alignItems: "center", backgroundColor: `${colors.primary}22`, borderRadius: 12, height: 40, justifyContent: "center", width: 40 }}><Feather name="sun" size={21} color={colors.primary} /></View>
      <View><Text style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}>{title}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Your schedule, work, and priorities</Text></View>
    </View>
    <TodayItem label="Calendar" icon="calendar" value={daily?.calendarCount != null ? `${daily.calendarCount} upcoming` : "Unavailable"} onPress={() => openModule("calendar")} />
    <TodayItem label={myWorkTitle} icon="clock" value={daily?.myWorkCount != null ? `${daily.myWorkCount} items` : "Unavailable"} onPress={() => openModule("my-work")} />
    <TodayItem label="Needs Attention" icon="bell" value={daily?.attentionCount != null ? `${daily.attentionCount} items` : "Unavailable"} onPress={() => openModule("attention")} />
    <TodayItem label="Safety" icon="shield" value={daily?.safetyCount != null ? `${daily.safetyCount} items` : "Unavailable"} onPress={() => openModule("safety")} />
    <TodayItem label="Tasks & Forms" icon="check-square" value={tasks === undefined ? "Unavailable" : `${tasks} items`} onPress={() => openModule("tasks-forms")} />
  </View>;
}

function CommunicationsCard({ title, width, companyName, meetings }: { title: string; width: DimensionValue; companyName: string; meetings?: number }) {
  const colors = useColors();
  return <View style={{ backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, paddingHorizontal: 16, paddingTop: 16, ...(width === "100%" ? { width } : { flex: 1, minWidth: 0 }) }}>
    <View style={{ alignItems: "center", flexDirection: "row", gap: 10, paddingBottom: 14 }}>
      <View style={{ alignItems: "center", backgroundColor: `${colors.primary}22`, borderRadius: 12, height: 40, justifyContent: "center", width: 40 }}><Feather name="message-circle" size={21} color={colors.primary} /></View>
      <View><Text style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}>{title}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Chats, calls, and meetings</Text></View>
    </View>
    <TodayItem label="Chats" icon="message-square" value="Open" onPress={() => openModule("chat")} />
    <TodayItem label="Calls" icon="phone" value="Recent" onPress={() => openModule("calls")} />
    <TodayItem label="Meetings" icon="calendar" value={meetings === undefined ? "Unavailable" : `${meetings} upcoming`} onPress={() => openModule("meetings")} />
  </View>;
}

function openModule(key: string) { router.push({ pathname: "/work-hub/[module]", params: { module: key } } as never); }

export default function WorkHubScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const { user, activeMembershipId: selectedMembershipId, activeMembership } = useAuth();
  const { width } = useWindowDimensions();
  const summary = useDailySummary();
  const daily = summary.data;
  const identity = `${user?.id}:${selectedMembershipId ?? user?.activeMembershipId}:${activeMembership?.orgId ?? user?.vendorId}`;
  const membership = activeMembership ?? user?.availableMemberships?.find(item => item.id === (selectedMembershipId ?? user.activeMembershipId));
  const companyAdmin = user?.role === "admin" || membership?.role === "admin";
  const [homeState, setHomeState] = useState<{ identity: string; data: HomeData } | null>(null);
  const home = homeState && homeState.identity === identity ? homeState.data : null;
  const modules = mobileWorkHubModules(width >= 768, companyAdmin, membership?.orgName, home?.capabilities, t("filesInventory.title"));
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true; setError("");
    void apiFetch<HomeData>("/api/work-hub/home").then(value => { if (active) setHomeState({ identity, data: value }); }).catch(() => { if (active) setError("Unable to load current Work Hub summaries. Tap any card to open its records."); });
    return () => { active = false; };
  }, [identity]);
  const cardWidth = width >= 768 ? "auto" : "100%";
  const tasks = home?.tasks?.length, meetings = home?.meetings?.length;
  const myWorkTitle = user?.managedSubcontractor ? "My Hours" : "My Work";
  const utilityModules = [
    { key: "search", label: "Search", icon: "search" },
    { key: "files-notes", label: t("filesInventory.title"), icon: "folder" },
    { key: "implementation-exports", label: "Exports", icon: "download" },
    { key: "site-presence", label: "Site Presence", icon: "map-pin" },
    ...modules.filter(({ key }) => key === "operations-health"),
  ].filter(({ key }) => key !== "implementation-exports" ||
    Boolean(home?.capabilities?.canViewExports && home.capabilities.allowedExportDatasets.length > 0));
  return <ScreenSafeArea style={{ backgroundColor: colors.background }}><ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
    <WorkHubPageTitle title="Work Hub" />
    <NativeOperations compact />
    <NativeJournal />
    {!home && !error ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading Work Hub summaries" /> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.mutedForeground }}>{error}</Text> : null}
    <View style={{ flexDirection: width >= 768 ? "row" : "column", flexWrap: "wrap", gap: 12 }}>
      <TodayCard title="Today" width={cardWidth} myWorkTitle={myWorkTitle} daily={daily} tasks={tasks} />
      <CommunicationsCard title="Communications" width={cardWidth} companyName={membership?.orgName?.trim() || "Company"} meetings={meetings} />
    </View>
    <NativeWorkforce />
    <NativeAccountWorkspace />
    {utilityModules.length ? <View style={{ gap: 10 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>More tools</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{utilityModules.map(({ key, icon, label }) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Open ${label}`} onPress={() => openModule(key)} style={({ pressed }) => ({ alignItems: "center", backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 14, borderWidth: 2, flexDirection: "row", gap: 8, opacity: pressed ? .72 : 1, paddingHorizontal: 14, paddingVertical: 11 })}><Feather name={icon as React.ComponentProps<typeof Feather>["name"]} size={18} color={colors.primary} /><Text style={{ color: colors.text, fontWeight: "600" }}>{label}</Text></Pressable>)}</View></View> : null}
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Open Audio settings"
      onPress={() => router.push({ pathname: "/profile", params: { openSettings: "audio" } } as never)}
      style={({ pressed }) => ({ alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 7, opacity: pressed ? .7 : 1, paddingVertical: 6 })}
    >
      <Feather name="headphones" size={17} color={colors.primary} />
      <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "600" }}>Audio settings</Text>
      <Feather name="chevron-right" size={16} color={colors.primary} />
    </Pressable>
  </ScrollView></ScreenSafeArea>;
}
