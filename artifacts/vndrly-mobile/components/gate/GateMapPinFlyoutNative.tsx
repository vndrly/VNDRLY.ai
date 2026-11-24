import React, { useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { useTranslation } from "react-i18next";
import DismissibleModal from "@/components/DismissibleModal";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { changeOverRequest } from "@/lib/change-over-api";

export type GateMapPin = { id: string; siteId: number; label: string; notes: string; latitude: number; longitude: number; createdAt: string; createdById: number };
export type GateMapPinForm = { pin: GateMapPin | null; latitude: number; longitude: number; siteId: number; sites: { id: number; name: string }[] };

export default function GateMapPinFlyoutNative({ form, onClose, onSaved }: { form: GateMapPinForm; onClose: () => void; onSaved: (pinId: string) => void }) {
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const es = i18n.language?.startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [id] = useState(() => form.pin?.id ?? Crypto.randomUUID());
  const [label, setLabel] = useState(form.pin?.label ?? "");
  const [notes, setNotes] = useState(form.pin?.notes ?? "");
  const [siteId, setSiteId] = useState(form.siteId);
  const [latitude, setLatitude] = useState(form.latitude.toFixed(6));
  const [longitude, setLongitude] = useState(form.longitude.toFixed(6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const lat = Number(latitude), lng = Number(longitude);
  const valid = label.trim().length > 0 && label.length <= 100 && notes.length <= 2000 && form.sites.some(site => site.id === siteId)
    && latitude.trim() !== "" && longitude.trim() !== "" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const field = { minHeight: 42, borderWidth: 1, borderColor: primary, borderRadius: 7, color: "#f4f4f4", paddingHorizontal: 10 } as const;
  const save = async () => {
    if (!valid || saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const changes = { id, siteId, label: label.trim(), notes, latitude: lat, longitude: lng };
      const expected = form.pin && { id: form.pin.id, siteId: form.pin.siteId, label: form.pin.label, notes: form.pin.notes, latitude: form.pin.latitude, longitude: form.pin.longitude };
      const result = await changeOverRequest<{ pin: GateMapPin }>(form.pin ? `/map-pins/${form.pin.id}/edit` : "/map-pins", form.pin ? { expected, changes } : changes);
      onSaved(result.pin.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : c("Pin could not be saved", "No se pudo guardar el pin")); }
    finally { saving.current = false; setBusy(false); }
  };
  return <DismissibleModal visible transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={{ flex: 1, backgroundColor: "#0009", justifyContent: "center", padding: 16 }}>
      <View style={{ maxHeight: "85%", borderWidth: 2, borderColor: primary, borderRadius: 14, backgroundColor: "#242426", padding: 16 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: "#f4f4f4", fontSize: 18, fontWeight: "700" }}>{form.pin ? c("Edit Pin Details", "Editar detalles del pin") : c("Drop Pin", "Agregar pin")}</Text>
          <Text style={{ color: "#ddd" }}>{c("Label", "Nombre")}</Text>
          <TextInput accessibilityLabel={c("Label", "Nombre")} value={label} onChangeText={setLabel} maxLength={100} editable={!busy} style={field} />
          <Text style={{ color: "#ddd" }}>{c("Site", "Sitio")}</Text>
          {form.sites.map(site => <Pressable key={site.id} accessibilityRole="radio" accessibilityState={{ checked: siteId === site.id }} disabled={busy} onPress={() => setSiteId(site.id)} style={{ minHeight: 38, justifyContent: "center", borderWidth: 1, borderColor: siteId === site.id ? primary : "#555", borderRadius: 7, paddingHorizontal: 10 }}><Text style={{ color: siteId === site.id ? primary : "#f4f4f4" }}>{site.name}</Text></Pressable>)}
          <Text style={{ color: "#ddd" }}>{c("Latitude", "Latitud")}</Text>
          <TextInput accessibilityLabel={c("Latitude", "Latitud")} value={latitude} onChangeText={setLatitude} keyboardType="numbers-and-punctuation" editable={!busy} style={field} />
          <Text style={{ color: "#ddd" }}>{c("Longitude", "Longitud")}</Text>
          <TextInput accessibilityLabel={c("Longitude", "Longitud")} value={longitude} onChangeText={setLongitude} keyboardType="numbers-and-punctuation" editable={!busy} style={field} />
          <Text style={{ color: "#ddd" }}>{c("Details", "Detalles")}</Text>
          <TextInput accessibilityLabel={c("Details", "Detalles")} value={notes} onChangeText={setNotes} maxLength={2000} multiline numberOfLines={3} editable={!busy} style={[field, { minHeight: 84, textAlignVertical: "top", paddingVertical: 8 }]} />
          <Text style={{ color: "#aaa", fontSize: 12 }}>{c("Shared with your company", "Compartido con su empresa")}</Text>
          {!!error && <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>{error}</Text>}
          <View style={{ flexDirection: "row", gap: 10 }}><TogglePillButton disabled={!valid || busy} onPress={() => void save()}>{busy ? c("Saving…", "Guardando…") : c("Save Pin", "Guardar pin")}</TogglePillButton><TogglePillButton disabled={busy} onPress={onClose}>{c("Cancel", "Cancelar")}</TogglePillButton></View>
        </ScrollView>
      </View>
    </View>
  </DismissibleModal>;
}
