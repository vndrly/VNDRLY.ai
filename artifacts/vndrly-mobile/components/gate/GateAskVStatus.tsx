import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import AskVConversation from "@/components/AskVConversation";
import DismissibleModal from "@/components/DismissibleModal";
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { useBrand } from "@/hooks/use-brand";
import { useGateCopy } from "./GateChrome";
import { iosPageLayout } from "@/lib/ios-page-layout";

/** Readback remains visible beside the Gate form; no modal traps the operator. */
export default function GateAskVStatus({ hidden = false }: { hidden?: boolean }) {
  const voice = useAskVVoiceSession(), brand = useBrand(), c = useGateCopy(), { t } = useTranslation();
  const active = !voice.muted && ["connecting", "greeting", "listening", "thinking", "speaking"].includes(voice.state);
  const message = [...voice.assistant.messages].reverse().find(item => item.role === "assistant");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [more, setMore] = useState(false);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const last = voice.assistant.messages.at(-1);
  const panelKey = `${voice.muted}:${last?.id ?? voice.assistant.messages.length}:${voice.error ?? ""}`;
  const close = () => setDismissed(panelKey);
  const review = voice.checkInReview;
  if (hidden) return null;
  if (review) {
    const lines = [
      [review.firstName, review.lastName].filter(Boolean).join(" "),
      review.company,
      [review.vehiclePlate, review.plateState].filter(Boolean).join(" · "),
      review.destinationName,
      ...review.details,
    ].filter(Boolean);
    return (
      <View testID="gate-askv-check-in" style={{ backgroundColor: "#242426", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.primary, gap: 4 }}>
        <Text style={{ color: "#f5f5f5", fontSize: 14, fontWeight: "600" }}>{c("Check in", "Registrar entrada")}</Text>
        <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
          {lines.map((line, index) => <Text key={index} style={{ color: "#f5f5f5", fontSize: 14 }}>{line}</Text>)}
        </View>
        {review.destinationNeedsReview && <Text style={{ color: "#b8b8b8" }}>{c("No matching secure destination. This will save in Notes.", "No hay un destino seguro que coincida. Se guardará en Notas.")}</Text>}
        {voice.checkInError && <Text accessibilityRole="alert" style={{ color: "#ffb7b7" }}>{voice.checkInError}</Text>}
        <Pressable
          accessibilityRole="button"
          disabled={!review.ready || voice.checkInSaving}
          onPress={() => void voice.confirmCheckIn(review.key)}
          style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-end", paddingHorizontal: 12, opacity: !review.ready || voice.checkInSaving ? 0.5 : 1 }}
        >
          <Text style={{ color: brand.primary }}>{voice.checkInSaving ? c("Saving…", "Guardando…") : c("Confirm", "Confirmar")}</Text>
        </Pressable>
      </View>
    );
  }
  if (dismissed === panelKey) return null;
  if (!active && (!voice.error || voice.muted)) return null;
  const confirm = last === message && message?.confirmationReference && !message.pending && !voice.assistant.streaming && submitted !== message.confirmationReference;
  const submit = async () => {
    if (!confirm || submitting || !message?.confirmationReference) return;
    setSubmitting(true);
    setSubmitted(message.confirmationReference);
    try {
      if (details.trim()) {
        await voice.assistant.send(c("Update this pending crossing with these additional details: ", "Actualiza este cruce pendiente con estos detalles: ") + details.trim(), "ios_text");
        setDetails("");
      } else await voice.assistant.send(c("Confirmed", "Confirmado"), "ios_text", message.confirmationReference);
    } finally { setSubmitting(false); }
  };
  const closeButton = <View style={{ flexDirection: "row", gap: 12 }}><Pressable accessibilityRole="button" onPress={() => { setOpened(true); setMore(true); }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: brand.primary }}>{c("More", "Más")}</Text></Pressable><Pressable accessibilityRole="button" onPress={close} style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}><Text style={{ color: brand.primary }}>{c("Close", "Cerrar")}</Text></Pressable></View>;
  const dialogue = <DismissibleModal visible={more} onRequestClose={() => setMore(false)} dismissLabel="close" animationType="slide" presentationStyle="fullScreen">{opened && <AskVConversation embedded onClose={() => setMore(false)} />}</DismissibleModal>;
  if (iosPageLayout && !message?.content && !voice.error) return <><View testID="gate-askv-status" style={{ backgroundColor: "#242426", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: brand.primary, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Text numberOfLines={1} accessibilityLiveRegion="polite" style={{ flex: 1, minWidth: 0, color: "#f5f5f5", fontSize: 14 }}>
      {["connecting", "greeting"].includes(voice.state) ? c("Connecting to V…", "Conectando con V…") : c("V is listening.", "V está escuchando.")}
    </Text>
    <Pressable accessibilityRole="button" onPress={() => voice.setMuted(true)} style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}><Text style={{ color: brand.primary }}>{c("Stop V", "Detener V")}</Text></Pressable>
    {closeButton}
  </View>{dialogue}</>;
  return <><View testID="gate-askv-status" style={{ backgroundColor: "#242426", paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.primary }}>
    <ScrollView style={{ maxHeight: 90 }} keyboardShouldPersistTaps="handled">
      <Text accessibilityLiveRegion="polite" style={{ color: "#f5f5f5", fontSize: 14 }}>
        {voice.error ? t(voice.error, { defaultValue: c("V could not connect. Your Gate form is still available. Tap AskV to retry.", "V no pudo conectarse. El formulario sigue disponible. Toca AskV para reintentar.") }) : message?.content || (["connecting", "greeting"].includes(voice.state) ? c("Connecting to V…", "Conectando con V…") : c("V is listening. Tell me who is checking in or out.", "V está escuchando. Dime quién entra o sale."))}
      </Text>
    </ScrollView>
    {confirm && <View style={{ gap: 6 }}>
      <TextInput accessibilityLabel={c("Any other details?", "¿Otros detalles?")} placeholder={c("Any other details? (optional)", "¿Otros detalles? (opcional)")} placeholderTextColor="#b8b8b8" value={details} onChangeText={setDetails} style={{ color: "#f5f5f5", borderWidth: 1, borderColor: brand.primary, borderRadius: 8, minHeight: 44, paddingHorizontal: 10 }} />
      <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void submit()} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-end" }}><Text style={{ color: brand.primary }}>{details.trim() ? c("Review details", "Revisar detalles") : c("Submit", "Enviar")}</Text></Pressable>
    </View>}
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <Pressable accessibilityRole="button" onPress={() => voice.setMuted(true)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: brand.primary }}>{c("Stop V", "Detener V")}</Text></Pressable>
      {closeButton}
    </View>
  </View>{dialogue}</>;
}
