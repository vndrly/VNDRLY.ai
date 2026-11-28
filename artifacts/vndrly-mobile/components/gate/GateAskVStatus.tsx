import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import AskVConversation from "@/components/AskVConversation";
import AssistantMarkdown from "@/components/AssistantMarkdown";
import AskVRevenueChart from "@/components/AskVRevenueChart";
import DismissibleModal from "@/components/DismissibleModal";
import React, { useEffect, useState } from "react";
import { plainGateError, readGateVoiceDraft, subscribeGateVoiceDraft } from "@workspace/gate-booth";
import { Linking, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { useBrand } from "@/hooks/use-brand";
import { useGateCopy } from "./GateChrome";
import { iosPageLayout } from "@/lib/ios-page-layout";

/** Compact native readback shared by every workspace page; Gate keeps its check-in controls. */
export default function GateAskVStatus({ hidden = false, gatePage = true, pagePath = "", topInset = 0 }: { hidden?: boolean; gatePage?: boolean; pagePath?: string; topInset?: number }) {
  const voice = useAskVVoiceSession(), brand = useBrand(), c = useGateCopy(), { t, i18n } = useTranslation();
  const active = !voice.muted && ["connecting", "greeting", "listening", "thinking", "speaking"].includes(voice.state);
  const message = [...voice.assistant.messages].reverse().find(item => item.role === "assistant");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [more, setMore] = useState(false);
  const [details, setDetails] = useState("");
  const [request, setRequest] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const last = voice.assistant.messages.at(-1);
  const thinking = c("V is thinking…", "V está pensando…");
  // Paused, V stays connected and treats what she hears as background until she is called or resumed.
  const pausedHint = c("V is paused. Say “Hey V” or tap Resume.", "V está en pausa. Di «Hey V» o toca Reanudar.");
  const pauseToggle = ["listening", "thinking", "speaking"].includes(voice.state) && <Pressable accessibilityRole="button" accessibilityState={{ selected: voice.paused }} onPress={() => voice.setPaused(!voice.paused)} style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}><Text style={{ color: brand.primary }}>{voice.paused ? c("Resume", "Reanudar") : c("Pause", "Pausar")}</Text></Pressable>;
  // Why V is not available, in plain words: her own reason when she gave one.
  const errorText = !voice.error ? "" : i18n.exists(voice.error) ? t(voice.error) : plainGateError(voice.error, gatePage ? c("V could not connect. Your Gate form is still available. Tap AskV to retry.", "V no pudo conectarse. El formulario sigue disponible. Toca AskV para reintentar.") : c("V could not connect. Tap AskV to retry.", "V no pudo conectarse. Toca AskV para reintentar."));
  const shiftNote = voice.shiftNoteDraft;
  const panelKey = `${last?.id ?? voice.assistant.messages.length}:${voice.error ?? ""}:${shiftNote?.text ?? ""}:${shiftNote?.status ?? ""}`;
  const close = () => { setDismissed(panelKey); voice.setMuted(true); };
  useEffect(() => { if (!voice.muted) setDismissed(null); }, [voice.muted]);
  const [gateDraft, setGateDraft] = useState(readGateVoiceDraft);
  useEffect(() => subscribeGateVoiceDraft(() => queueMicrotask(() => setGateDraft(readGateVoiceDraft()))), []);
  const checkout = gateDraft?.checkoutReview as { firstName?: string; lastName?: string; company?: string; plateState?: string; vehiclePlate?: string } | undefined;
  const review = checkout ? { key: "checkout", firstName: checkout.firstName ?? "", lastName: checkout.lastName ?? "", company: checkout.company ?? "", plateState: checkout.plateState ?? "", vehiclePlate: checkout.vehiclePlate ?? "", ready: true, missing: [] } : voice.checkInReview;
  // Away from the Gate page the entry belongs to the operator's own watch; name that gate.
  const watchForm = gateDraft?.watchForm === true;
  const watchGate = watchForm && typeof gateDraft?.gateStationName === "string" ? gateDraft.gateStationName : "";
  const notSaved = voice.checkInError ?? "";
  const sendFocused = async () => {
    const text = request.trim();
    if (!text || sending || voice.assistant.streaming) return;
    setSending(true);
    try {
      if (shiftNote) await voice.sendShiftNoteText(text);
      else await voice.assistant.send(text, "ios_text", undefined, true);
      setRequest("");
    } finally { setSending(false); }
  };
  // After a save V sleeps with her panel closed, until she is called or tapped.
  if (hidden || voice.muted || voice.asleep) return null;
  // The entry shows once "check in" was said, before any detail is in it; an untouched Gate form shows nothing.
  const entryOpen = review && (checkout || voice.paused || notSaved || gateDraft?.silentCheckIn === true || [review.firstName, review.lastName, review.company, review.plateState, review.vehiclePlate].some(value => value.trim()));
  if (review && !entryOpen && !voice.error) return null;
  if (review && entryOpen) {
    const lines = [
      [review.firstName, review.lastName].filter(Boolean).join(" "),
      review.company,
      [review.plateState, review.vehiclePlate].filter(Boolean).join(" "),
    ].filter(Boolean);
    // What V said about the last attempt, or what a save now would be flagged for. Only a gate that is not chosen holds a save.
    const needed = { firstName: c("first name", "nombre"), lastName: c("last name", "apellido"), company: c("company", "empresa"), vehiclePlate: c("tag", "placa"), plateState: c("state", "estado") };
    const missing = (review.missing ?? []).flatMap(field => field === "gate" ? [] : [needed[field]]);
    const status = voice.checkInSaving ? c("Saving…", "Guardando…") : voice.checkInError || [
      (review.missing ?? []).some(field => field === "gate") ? c("Gate not chosen.", "Acceso no elegido.") : "",
      missing.length ? c("Missing: ", "Falta: ") + missing.join(", ") + "." : "",
    ].filter(Boolean).join(" ");
    const where = watchGate ? c(` at ${watchGate}`, ` en ${watchGate}`) : "";
    return (
      <View testID="gate-askv-check-in" style={{ backgroundColor: "#242426", paddingHorizontal: 12, paddingTop: topInset + 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: brand.primary, gap: 4 }}>
        <Text style={{ color: "#f5f5f5", fontSize: 14, fontWeight: "600" }}>{checkout ? c(`Check out${where}:`, `Registrar salida${where}:`) : c(`Check in${where}:`, `Registrar entrada${where}:`)}</Text>
        <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
          {lines.map((line, index) => <Text key={index} style={{ color: "#f5f5f5", fontSize: 14 }}>{line}</Text>)}
          {voice.paused && <Text style={{ color: "#f5f5f5", fontSize: 14 }}>{pausedHint}</Text>}
          {status ? <Text testID="gate-askv-check-in-status" style={{ color: "#f5f5f5", fontSize: 14 }}>{status}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 20 }}>
          <Pressable
            accessibilityRole="button"
            disabled={voice.checkInSaving}
            onPress={() => checkout ? void voice.assistant.send("Confirm", "ios_text", watchForm ? undefined : message?.confirmationReference, true) : void voice.confirmCheckIn(review.key)}
            style={{ minHeight: 44, justifyContent: "center", opacity: voice.checkInSaving ? 0.5 : 1 }}
          >
            <Text style={{ color: brand.primary, textDecorationLine: "underline" }}>{c("Confirm?", "¿Confirmar?")}</Text>
          </Pressable>
          {pauseToggle}
        </View>
      </View>
    );
  }
  if (dismissed === panelKey) return null;
  if (!active && !shiftNote && (!voice.error || voice.muted)) return null;
  const confirm = !shiftNote && last === message && message?.confirmationReference && !message.pending && !voice.assistant.streaming && submitted !== message.confirmationReference;
  const submit = async () => {
    if (!confirm || submitting || !message?.confirmationReference) return;
    setSubmitting(true);
    setSubmitted(message.confirmationReference);
    try {
      if (details.trim()) {
        await voice.assistant.send((gatePage ? c("Update this pending crossing with these additional details: ", "Actualiza este cruce pendiente con estos detalles: ") : c("Update this pending request with these additional details: ", "Actualiza esta solicitud pendiente con estos detalles: ")) + details.trim(), "ios_text", undefined, true);
        setDetails("");
      } else await voice.assistant.send(c("Confirmed", "Confirmado"), "ios_text", message.confirmationReference, true);
    } finally { setSubmitting(false); }
  };
  const composer = !confirm && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
    <TextInput accessibilityLabel={c("Ask V on this page", "Preguntar a V en esta página")} placeholder={c("Ask V…", "Pregunta a V…")} placeholderTextColor="#b8b8b8" value={request} onChangeText={setRequest} onSubmitEditing={() => void sendFocused()} returnKeyType="send" editable={!sending} style={{ flex: 1, minWidth: 0, minHeight: 40, color: "#f5f5f5", borderWidth: 1, borderColor: brand.primary, borderRadius: 8, paddingHorizontal: 10 }} />
    <Pressable accessibilityRole="button" accessibilityLabel={c("Send to V", "Enviar a V")} disabled={!request.trim() || sending || voice.assistant.streaming} onPress={() => void sendFocused()} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 8, opacity: !request.trim() || sending || voice.assistant.streaming ? 0.5 : 1 }}><Text style={{ color: brand.primary }}>{c("Send", "Enviar")}</Text></Pressable>
  </View>;
  const closeButton = <View style={{ flexDirection: "row", gap: 12 }}><Pressable accessibilityRole="button" onPress={() => { setOpened(true); setMore(true); }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: brand.primary }}>{c("More", "Más")}</Text></Pressable><Pressable accessibilityRole="button" onPress={close} style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}><Text style={{ color: brand.primary }}>{c("Close", "Cerrar")}</Text></Pressable></View>;
  const dialogue = <DismissibleModal visible={more} onRequestClose={() => setMore(false)} dismissLabel="close" animationType="slide" presentationStyle="fullScreen">{opened && <AskVConversation embedded onClose={() => setMore(false)} />}</DismissibleModal>;
  if (iosPageLayout && !message?.content && !voice.error && !shiftNote && !notSaved) return <><View testID="gate-askv-status" style={{ backgroundColor: "#242426", paddingHorizontal: 12, paddingTop: topInset, borderBottomWidth: 1, borderBottomColor: brand.primary, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Text numberOfLines={1} accessibilityLiveRegion="polite" style={{ flex: 1, minWidth: 0, color: "#f5f5f5", fontSize: 14 }}>
      {["connecting", "greeting"].includes(voice.state) ? c("Connecting to V…", "Conectando con V…") : voice.paused ? c("V is paused.", "V está en pausa.") : voice.state === "thinking" ? thinking : c("V is listening.", "V está escuchando.")}
    </Text>
    {pauseToggle}
    <Pressable accessibilityRole="button" onPress={() => voice.setMuted(true)} style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}><Text style={{ color: brand.primary }}>{c("Stop V", "Detener V")}</Text></Pressable>
    {closeButton}
  </View><View style={{ backgroundColor: "#242426", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: brand.primary }}>{composer}</View>{dialogue}</>;
  return <><View testID="gate-askv-status" style={{ backgroundColor: "#242426", paddingHorizontal: 12, paddingTop: topInset + 6, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: brand.primary }}>
    <ScrollView style={{ maxHeight: shiftNote ? 180 : 240 }} keyboardShouldPersistTaps="handled">
      {!shiftNote && !voice.error && message?.content ? <>
        <AssistantMarkdown text={message.content} />
        {!message.pending && <AskVRevenueChart calls={message.toolCalls} color={brand.primary} />}
      </> :
      <Text accessibilityLiveRegion="polite" style={{ color: "#f5f5f5", fontSize: 14 }}>
        {shiftNote ? (voice.error || `Shift note: ${shiftNote.text || "What should the note say?"}${shiftNote.status === "ready" ? " Confirm?" : shiftNote.status === "submitting" ? " Saving…" : shiftNote.status === "collecting" ? "" : " Preparing…"}`) : voice.error ? errorText : message?.content || (["connecting", "greeting"].includes(voice.state) ? c("Connecting to V…", "Conectando con V…") : voice.paused ? pausedHint : voice.state === "thinking" ? thinking : gatePage ? c("V is listening. Tell me who is checking in or out.", "V está escuchando. Dime quién entra o sale.") : c("V is listening. Tell me what to do on this page.", "V está escuchando. Dime qué hacer en esta página."))}
      </Text>}
    </ScrollView>
    {confirm && <View style={{ gap: 6 }}>
      <TextInput accessibilityLabel={c("Any other details?", "¿Otros detalles?")} placeholder={c("Any other details? (optional)", "¿Otros detalles? (opcional)")} placeholderTextColor="#b8b8b8" value={details} onChangeText={setDetails} style={{ color: "#f5f5f5", borderWidth: 1, borderColor: brand.primary, borderRadius: 8, minHeight: 44, paddingHorizontal: 10 }} />
      <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void submit()} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-end" }}><Text style={{ color: brand.primary }}>{details.trim() ? c("Review details", "Revisar detalles") : c("Submit", "Enviar")}</Text></Pressable>
    </View>}
    {composer}
    {voice.paused && !shiftNote && !voice.error && message?.content ? <Text accessibilityLiveRegion="polite" style={{ color: "#f5f5f5", fontSize: 14 }}>{pausedHint}</Text> : null}
    {notSaved ? <Text accessibilityLiveRegion="polite" style={{ color: "#f5f5f5", fontSize: 14 }}>{notSaved}</Text> : null}
    {voice.error === "askv.microphoneDenied" && <Pressable accessibilityRole="button" testID="gate-askv-open-settings" onPress={() => void Linking.openSettings()} style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}><Text style={{ color: brand.primary, textDecorationLine: "underline" }}>{c("Open Settings", "Abrir Ajustes")}</Text></Pressable>}
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <Pressable accessibilityRole="button" onPress={() => voice.setMuted(true)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: brand.primary }}>{c("Stop V", "Detener V")}</Text></Pressable>
        {pauseToggle}
      </View>
      {closeButton}
    </View>
  </View>{dialogue}</>;
}
