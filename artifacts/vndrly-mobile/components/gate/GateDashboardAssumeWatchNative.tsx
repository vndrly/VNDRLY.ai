import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import DismissibleModal from "@/components/DismissibleModal";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type GateDashboardAssumeWatchData = {
  title: string; description: string; closeLabel: string;
  loading: boolean; loadError: boolean; loadingLabel: string; loadErrorLabel: string; retryLabel: string;
  siteGate: string; calendarLabel: string; wrongCalendarGate: string; calendarNotCurrent: string;
  watchLabel: string; handoverTitle: string; handoverFacts: string[]; handoverNotes: string; handoverOpenItems: string[];
  showCurrentActivity: boolean; currentActivityTitle: string; staleMessage: string; currentFacts: string[];
  areaTitle: string; areas: { area: string; count: number }[]; areaError: string;
  ownMessage: string; changedMessage: string;
  discrepancyAvailable: boolean; discrepancyTitle: string; discrepancyLabel: string; discrepancy: string;
  discrepancyDisabled: boolean; saveDiscrepancyLabel: string; saveDiscrepancyDisabled: boolean;
  error: string; reportSavedMessage: string; pendingMessage: string; confirmLabel: string; confirmDisabled: boolean;
};

export default function GateDashboardAssumeWatchNative({ data, onAction, onDiscrepancyChange }: {
  data: GateDashboardAssumeWatchData;
  onAction: (action: "close" | "retry" | "save-discrepancy" | "confirm") => void;
  onDiscrepancyChange: (value: string) => void;
}) {
  const colors = useColors();
  const [discrepancy, setDiscrepancy] = useState(data.discrepancy);
  const [discrepancyOpen, setDiscrepancyOpen] = useState(false);
  useEffect(() => setDiscrepancy(data.discrepancy), [data.discrepancy]);
  const body = { color: colors.foreground, fontSize: 14 } as const;
  const muted = { color: colors.mutedForeground, fontSize: 14 } as const;
  const heading = { color: colors.foreground, fontSize: 15, fontWeight: "700" } as const;
  const action = { borderWidth: 1, borderColor: colors.primary, borderRadius: 6, paddingHorizontal: 15, paddingVertical: 8, alignSelf: "flex-end" } as const;
  const lines = (items: string[]) => items.map((item, index) => <Text key={`${index}:${item}`} style={[body, { marginLeft: 15 }]}>• {item}</Text>);
  return <DismissibleModal visible transparent animationType="fade" onRequestClose={() => onAction("close")}>
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={data.closeLabel} onPress={() => onAction("close")} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#000a" }} />
      <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 460, maxHeight: "82%", padding: 18, gap: 12, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, backgroundColor: "#242424" }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}><View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "700", fontSize: 18 }}>{data.title}</Text><Text style={[muted, { marginTop: 4 }]}>{data.description}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={data.closeLabel} onPress={() => onAction("close")} style={{ padding: 4 }}><Text style={{ color: colors.mutedForeground, fontSize: 22 }}>×</Text></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 9 }}>
          {data.loading ? <Text accessibilityRole="alert" style={muted}>{data.loadingLabel}</Text> : data.loadError ? <><Text accessibilityRole="alert" style={{ color: colors.destructive }}>{data.loadErrorLabel}</Text><Pressable accessibilityRole="button" onPress={() => onAction("retry")} style={action}><Text style={body}>{data.retryLabel}</Text></Pressable></> : !!data.siteGate && <>
            <Text style={heading}>{data.siteGate}</Text>
            {!!data.calendarLabel && <Text style={muted}>{data.calendarLabel}</Text>}
            {!!data.wrongCalendarGate && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{data.wrongCalendarGate}</Text>}
            {!!data.calendarNotCurrent && <Text style={muted}>{data.calendarNotCurrent}</Text>}
            {!!data.watchLabel && <Text style={muted}>{data.watchLabel}</Text>}
            <Text style={heading}>{data.handoverTitle}</Text>
            {lines(data.handoverFacts)}
            {!!data.handoverNotes && <Text style={body}>{data.handoverNotes}</Text>}
            {lines(data.handoverOpenItems)}
            {data.showCurrentActivity && <><Text style={heading}>{data.currentActivityTitle}</Text>{!!data.staleMessage && <Text style={muted}>{data.staleMessage}</Text>}{lines(data.currentFacts)}</>}
            {data.areas.length > 0 && <><Text style={heading}>{data.areaTitle}</Text>{data.areas.map(item => <Text key={item.area} style={[body, { marginLeft: 15 }]}>• {item.area} · {item.count}</Text>)}</>}
            {!!data.areaError && <Text style={muted}>{data.areaError}</Text>}
            {!!data.ownMessage && <Text style={muted}>{data.ownMessage}</Text>}
            {!!data.changedMessage && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{data.changedMessage}</Text>}
            {data.discrepancyAvailable && <><Pressable accessibilityRole="button" accessibilityState={{ expanded: discrepancyOpen }} onPress={() => setDiscrepancyOpen(open => !open)} style={{ paddingVertical: 6 }}><Text style={body}>{discrepancyOpen ? "▾" : "▸"} {data.discrepancyTitle}</Text></Pressable>{discrepancyOpen && <><Text style={body}>{data.discrepancyLabel}</Text><TextInput accessibilityLabel={data.discrepancyLabel} value={discrepancy} maxLength={2000} multiline editable={!data.discrepancyDisabled} onChangeText={value => { setDiscrepancy(value); onDiscrepancyChange(value); }} style={{ minHeight: 76, color: colors.foreground, borderColor: colors.primary, borderWidth: 1, borderRadius: 6, padding: 8, textAlignVertical: "top" }} /><Pressable accessibilityRole="button" disabled={data.saveDiscrepancyDisabled} accessibilityState={{ disabled: data.saveDiscrepancyDisabled }} onPress={() => onAction("save-discrepancy")} style={[action, { opacity: data.saveDiscrepancyDisabled ? 0.45 : 1 }]}><Text style={body}>{data.saveDiscrepancyLabel}</Text></Pressable></>}</>}
          </>}
          {!!data.error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{data.error}</Text>}
          {!!data.reportSavedMessage && <Text style={muted}>{data.reportSavedMessage}</Text>}
          {!!data.pendingMessage && <Text style={muted}>{data.pendingMessage}</Text>}
        </ScrollView>
        <View style={{ borderTopColor: "#444", borderTopWidth: 1, paddingTop: 12 }}><Pressable accessibilityRole="button" disabled={data.confirmDisabled} accessibilityState={{ disabled: data.confirmDisabled }} onPress={() => onAction("confirm")} style={[action, { opacity: data.confirmDisabled ? 0.45 : 1 }]}><Text style={[body, { fontWeight: "700" }]}>{data.confirmLabel}</Text></Pressable></View>
      </View>
    </View>
  </DismissibleModal>;
}
