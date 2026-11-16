import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { useBrand } from "@/hooks/use-brand";
import { useGateCopy } from "./GateChrome";
import { iosPageLayout } from "@/lib/ios-page-layout";

/** Readback remains visible beside the Gate form; no modal traps the operator. */
export default function GateAskVStatus() {
  const voice = useAskVVoiceSession(), brand = useBrand(), c = useGateCopy(), { t } = useTranslation();
  const active = !voice.muted && ["connecting", "greeting", "listening", "thinking", "speaking"].includes(voice.state);
  const message = [...voice.assistant.messages].reverse().find(item => item.role === "assistant");
  if (!active && (!voice.error || voice.muted)) return null;
  const confirm = message?.confirmationReference && !message.pending && !voice.assistant.streaming;
  if (iosPageLayout && !message?.content && !voice.error) return <View testID="gate-askv-status" style={{ backgroundColor: "#242426", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: brand.primary, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Text numberOfLines={1} accessibilityLiveRegion="polite" style={{ flex: 1, minWidth: 0, color: "#f5f5f5", fontSize: 14 }}>
      {["connecting", "greeting"].includes(voice.state) ? c("Connecting to V…", "Conectando con V…") : c("V is listening.", "V está escuchando.")}
    </Text>
    <Pressable accessibilityRole="button" onPress={() => voice.setMuted(true)} style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}><Text style={{ color: brand.primary }}>{c("Stop V", "Detener V")}</Text></Pressable>
  </View>;
  return <View testID="gate-askv-status" style={{ backgroundColor: "#242426", paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.primary }}>
    <ScrollView style={{ maxHeight: 90 }} keyboardShouldPersistTaps="handled">
      <Text accessibilityLiveRegion="polite" style={{ color: "#f5f5f5", fontSize: 14 }}>
        {voice.error ? t(voice.error, { defaultValue: c("V could not connect. Your Gate form is still available. Tap AskV to retry.", "V no pudo conectarse. El formulario sigue disponible. Toca AskV para reintentar.") }) : message?.content || (["connecting", "greeting"].includes(voice.state) ? c("Connecting to V…", "Conectando con V…") : c("V is listening. Tell me who is checking in or out.", "V está escuchando. Dime quién entra o sale."))}
      </Text>
    </ScrollView>
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <Pressable accessibilityRole="button" onPress={() => voice.setMuted(true)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: brand.primary }}>{c("Stop V", "Detener V")}</Text></Pressable>
      {confirm && <Pressable accessibilityRole="button" onPress={() => void voice.assistant.send(c("Confirmed", "Confirmado"), "ios_text", message.confirmationReference)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: brand.primary }}>{c("Confirm", "Confirmar")}</Text></Pressable>}
    </View>
  </View>;
}
