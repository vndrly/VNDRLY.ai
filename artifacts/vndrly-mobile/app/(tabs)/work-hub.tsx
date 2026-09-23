import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions, type DimensionValue } from "react-native";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubDeviceSettings from "@/components/WorkHubDeviceSettings";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { mobileWorkHubModules } from "@/lib/work-hub-mobile";

type HomeData = { tasks?: unknown[]; announcements?: unknown[]; shifts?: unknown[]; meetings?: unknown[] };
type CardProps = { icon: React.ComponentProps<typeof Feather>["name"]; title: string; value: string; detail: string; onPress: () => void; width: DimensionValue };

function SummaryCard({ icon, title, value, detail, onPress, width }: CardProps) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={onPress} style={({ pressed }) => ({ width, minHeight: 132, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16, gap: 10, opacity: pressed ? .72 : 1, backgroundColor: colors.card })}>
    <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
      <View style={{ alignItems: "center", backgroundColor: `${colors.primary}22`, borderRadius: 12, height: 40, justifyContent: "center", width: 40 }}><Feather name={icon} size={21} color={colors.primary} /></View>
      <Text style={{ color: colors.text, flex: 1, fontSize: 17, fontWeight: "700" }}>{title}</Text>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </View>
    <Text style={{ color: colors.text, fontSize: 24, fontWeight: "700" }}>{value}</Text>
    <Text numberOfLines={2} style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 18 }}>{detail}</Text>
  </Pressable>;
}

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

function TodayCard({ title, width, myWorkTitle, shifts, meetings, announcements, tasks }: { title: string; width: DimensionValue; myWorkTitle: string; shifts: number; meetings: number; announcements: number; tasks: number }) {
  const colors = useColors();
  return <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingTop: 16, width }}>
    <View style={{ alignItems: "center", flexDirection: "row", gap: 10, paddingBottom: 14 }}>
      <View style={{ alignItems: "center", backgroundColor: `${colors.primary}22`, borderRadius: 12, height: 40, justifyContent: "center", width: 40 }}><Feather name="sun" size={21} color={colors.primary} /></View>
      <View><Text style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}>{title}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Your schedule, work, and priorities</Text></View>
    </View>
    <TodayItem label="Calendar" icon="calendar" value={`${shifts + meetings} upcoming`} onPress={() => openModule("calendar")} />
    <TodayItem label={myWorkTitle} icon="clock" value={`${shifts} shifts`} onPress={() => openModule("payroll-documents")} />
    <TodayItem label="Activity" icon="bell" value={`${announcements} updates`} onPress={() => openModule("activity")} />
    <TodayItem label="Tasks & Forms" icon="check-square" value={`${tasks} items`} onPress={() => openModule("tasks-forms")} />
  </View>;
}

function CommunicationsCard({ title, width, companyName, meetings }: { title: string; width: DimensionValue; companyName: string; meetings: number }) {
  const colors = useColors();
  return <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingTop: 16, width }}>
    <View style={{ alignItems: "center", flexDirection: "row", gap: 10, paddingBottom: 14 }}>
      <View style={{ alignItems: "center", backgroundColor: `${colors.primary}22`, borderRadius: 12, height: 40, justifyContent: "center", width: 40 }}><Feather name="message-circle" size={21} color={colors.primary} /></View>
      <View><Text style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}>{title}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Messages, calls, and invitations</Text></View>
    </View>
    <TodayItem label="Chats" icon="message-square" value="Open" onPress={() => openModule("chat")} />
    <TodayItem label="Calls" icon="phone" value="Recent" onPress={() => openModule("calls")} />
    <TodayItem label="Invitations" icon="mail" value={`${meetings} upcoming`} onPress={() => openModule("meetings")} />
    <TodayItem label={`${companyName} Conversations`} icon="users" value="Recent" onPress={() => openModule("chat")} />
  </View>;
}

function openModule(key: string) { router.push({ pathname: "/work-hub/[module]", params: { module: key } } as never); }

export default function WorkHubScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const membership = user?.availableMemberships?.find(item => item.id === user.activeMembershipId);
  const companyAdmin = user?.role === "admin" || membership?.role === "admin";
  const modules = mobileWorkHubModules(width >= 768, companyAdmin, membership?.orgName);
  const [home, setHome] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true; setError("");
    void apiFetch<HomeData>("/api/work-hub/home").then(value => { if (active) setHome(value); }).catch(() => { if (active) setError("Unable to load current Work Hub summaries. Tap any card to open its records."); });
    return () => { active = false; };
  }, [user?.activeMembershipId]);
  const cardWidth = width >= 768 ? "48.5%" : "100%";
  const tasks = home?.tasks?.length ?? 0, announcements = home?.announcements?.length ?? 0, shifts = home?.shifts?.length ?? 0, meetings = home?.meetings?.length ?? 0;
  const myWorkTitle = user?.managedSubcontractor ? "My Hours" : "My Work";
  const utilityModules = modules.filter(({ key }) => ["search", "implementation-exports", "operations-health"].includes(key));
  return <ScreenSafeArea style={{ backgroundColor: colors.background }}><ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
    <WorkHubPageTitle title="Work Hub" />
    {!home && !error ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading Work Hub summaries" /> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.mutedForeground }}>{error}</Text> : null}
    <View style={{ flexDirection: width >= 768 ? "row" : "column", flexWrap: "wrap", gap: 12 }}>
      <TodayCard title="Today" width={cardWidth} myWorkTitle={myWorkTitle} shifts={shifts} meetings={meetings} announcements={announcements} tasks={tasks} />
      <CommunicationsCard title="Communications" width={cardWidth} companyName={membership?.orgName?.trim() || "Company"} meetings={meetings} />
      <SummaryCard title="Site & Safety" icon="shield" value="Your assignments" detail="Authorized site presence, coverage, and open safety information." onPress={() => openModule("site-presence")} width={cardWidth} />
      <SummaryCard title="Files & Inventory" icon="folder" value="Recent records" detail="Your authorized files, notes, and assigned equipment." onPress={() => openModule("files-notes")} width={cardWidth} />
    </View>
    {utilityModules.length ? <View style={{ gap: 10 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>More tools</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{utilityModules.map(({ key, icon, label }) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Open ${label}`} onPress={() => openModule(key)} style={({ pressed }) => ({ alignItems: "center", backgroundColor: colors.card, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 8, opacity: pressed ? .72 : 1, paddingHorizontal: 14, paddingVertical: 11 })}><Feather name={icon as React.ComponentProps<typeof Feather>["name"]} size={18} color={colors.primary} /><Text style={{ color: colors.text, fontWeight: "600" }}>{label}</Text></Pressable>)}</View></View> : null}
    <WorkHubDeviceSettings />
  </ScrollView></ScreenSafeArea>;
}
