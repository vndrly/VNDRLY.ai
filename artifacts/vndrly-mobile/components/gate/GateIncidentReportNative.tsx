import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import DismissibleModal from "@/components/DismissibleModal";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

export type GateIncidentReportData = {
  title: string;
  description: string;
  formTitle: string;
  siteLabel: string;
  siteId: string;
  sites: { id: string; name: string }[];
  eventTypes: { id: string; label: string; selected: boolean }[];
  incidentTitleLabel: string;
  incidentTitle: string;
  descriptionLabel: string;
  incidentDescription: string;
  anonymousLabel: string;
  anonymous: boolean;
  stopWorkLabel: string;
  stopWork: boolean;
  submitLabel: string;
  submitting: boolean;
  error: string;
  requiredMessage: string;
};

export default function GateIncidentReportNative({ data, onField, onEventType, onSubmit, onClose }: {
  data: GateIncidentReportData;
  onField: (field: "site" | "title" | "description" | "anonymous" | "stopWork", value?: string) => void;
  onEventType: (id: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { primary } = useColors();
  const [title, setTitle] = useState(data.incidentTitle);
  const [description, setDescription] = useState(data.incidentDescription);
  const [siteId, setSiteId] = useState(data.siteId);
  const [siteOpen, setSiteOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  useEffect(() => setTitle(data.incidentTitle), [data.incidentTitle]);
  useEffect(() => setDescription(data.incidentDescription), [data.incidentDescription]);
  useEffect(() => setSiteId(data.siteId), [data.siteId]);
  useEffect(() => { if (data.error) setLocalError(""); }, [data.error]);
  const field = { minHeight: 44, borderWidth: 1, borderColor: primary, borderRadius: 8, backgroundColor: "#303034", color: "#ececec", paddingHorizontal: 10 } as const;
  const action = { minHeight: 40, borderWidth: 1, borderColor: primary, borderRadius: 8, paddingHorizontal: 10, justifyContent: "center" } as const;
  const submit = () => { if (!title.trim() || !siteId) { setLocalError(data.requiredMessage); return; } setLocalError(""); onSubmit(); };
  return <DismissibleModal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, alignItems: "flex-end", backgroundColor: "#000b" }}>
      <View style={{ width: "100%", maxWidth: 560, height: "100%", backgroundColor: "#242426", borderLeftColor: primary, borderLeftWidth: 1 }}>
        <View style={{ borderBottomColor: "#444", borderBottomWidth: 1, padding: 18, flexDirection: "row", alignItems: "flex-start", gap: 12 }}><View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 18, fontWeight: "700" }}>{data.title}</Text><Text style={{ color: "#b3b3b3", fontSize: 13, paddingTop: 4 }}>{data.description}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close incident report" disabled={data.submitting} onPress={onClose} style={action}><Text style={{ color: "#ececec" }}>×</Text></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 13, padding: 18, paddingBottom: 36 }}>
          <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 16, fontWeight: "700" }}>{data.formTitle}</Text>
          <Text style={{ color: "#ececec" }}>{data.siteLabel}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={data.siteLabel} accessibilityState={{ expanded: siteOpen }} onPress={() => setSiteOpen(open => !open)} style={action}><Text style={{ color: "#ececec" }}>{data.sites.find(site => site.id === siteId)?.name || data.siteLabel} ⌄</Text></Pressable>
          {siteOpen && data.sites.map(site => <Pressable key={site.id} accessibilityRole="radio" accessibilityState={{ checked: siteId === site.id }} onPress={() => { setSiteId(site.id); setSiteOpen(false); setLocalError(""); onField("site", site.id); }} style={[action, { borderColor: siteId === site.id ? primary : "#555" }]}><Text style={{ color: "#ececec" }}>{site.name}</Text></Pressable>)}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>{data.eventTypes.map(type => <Pressable key={type.id} accessibilityRole="radio" accessibilityState={{ checked: type.selected }} onPress={() => onEventType(type.id)} style={[action, { borderColor: type.selected ? primary : "#555" }]}><Text style={{ color: "#ececec" }}>{type.label}</Text></Pressable>)}</View>
          <Text style={{ color: "#ececec" }}>{data.incidentTitleLabel}</Text>
          <TextInput accessibilityLabel={data.incidentTitleLabel} value={title} onChangeText={value => { setTitle(value); setLocalError(""); onField("title", value); }} editable={!data.submitting} style={field} />
          <Text style={{ color: "#ececec" }}>{data.descriptionLabel}</Text>
          <TextInput accessibilityLabel={data.descriptionLabel} value={description} onChangeText={value => { setDescription(value); onField("description", value); }} editable={!data.submitting} multiline style={[field, { minHeight: 92, paddingVertical: 8, textAlignVertical: "top" }]} />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: data.anonymous }} onPress={() => onField("anonymous")} style={action}><Text style={{ color: "#ececec" }}>{data.anonymous ? "☑" : "□"} {data.anonymousLabel}</Text></Pressable>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: data.stopWork }} onPress={() => onField("stopWork")} style={action}><Text style={{ color: "#ececec" }}>{data.stopWork ? "☑" : "□"} {data.stopWorkLabel}</Text></Pressable>
          {!!(data.error || localError) && <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>{data.error || localError}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel={data.submitLabel} accessibilityState={{ disabled: data.submitting }} disabled={data.submitting} onPress={submit} style={[action, { backgroundColor: primary }]}><Text style={{ color: "#111", fontWeight: "700" }}>{data.submitLabel}</Text></Pressable>
        </ScrollView>
      </View>
    </View>
  </DismissibleModal>;
}
