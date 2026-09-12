import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import WorkHubAudioRoom from "@/components/WorkHubAudioRoom";
import { useColors } from "@/hooks/useColors";

type ActiveMeeting = { occurrenceId: string; title: string; hostMuted: boolean; hostMuteGeneration: number };
type MeetingCompanion = { active: ActiveMeeting | null; activate: (meeting: ActiveMeeting) => void; clear: () => void };
const Context = createContext<MeetingCompanion | null>(null);

export function MeetingCompanionProvider({ children }: { children: ReactNode }) {
  const colors = useColors();
  const [active, setActive] = useState<ActiveMeeting | null>(null);
  const activate = useCallback((meeting: ActiveMeeting) => setActive((current) => current && current.occurrenceId === meeting.occurrenceId && current.title === meeting.title && current.hostMuted === meeting.hostMuted && current.hostMuteGeneration === meeting.hostMuteGeneration ? current : meeting), []);
  const clear = useCallback(() => setActive(null), []);
  const value = useMemo(() => ({ active, activate, clear }), [active, activate, clear]);
  return <Context.Provider value={value}><View style={{ flex: 1 }}>{children}</View>{active && <View accessibilityLabel="Active meeting companion" style={{ position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 100, padding: 12, gap: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card }}><View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}><Text numberOfLines={1} style={{ color: colors.text, fontWeight: "700", flex: 1 }}>{active.title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Return to meeting" onPress={() => router.push(`/work-hub/meeting/${active.occurrenceId}` as never)}><Text style={{ color: colors.primary, fontWeight: "700" }}>Return to meeting</Text></Pressable></View><WorkHubAudioRoom occurrenceId={active.occurrenceId} hostMuted={active.hostMuted} hostMuteGeneration={active.hostMuteGeneration} /></View>}</Context.Provider>;
}

export function useMeetingCompanion() { return useContext(Context); }
