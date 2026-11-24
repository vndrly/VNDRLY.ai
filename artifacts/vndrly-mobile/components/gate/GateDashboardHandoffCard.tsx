import React, { useEffect, useState } from "react";
import { Modal, Text, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useTranslation } from "react-i18next";
import type { ChangeOverState } from "@workspace/gate-booth";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";
import GateTaskHopperNative from "./GateTaskHopperNative";

type SignCommand = { operationId: string; expectedWatchId: string; expectedPreparationId: string | null; notes: string };
type NoteCommand = { operationId: string; expectedWatchId: string; text: string };
export interface GateDashboardHandoffCardProps {
  stationId?: string;
  current: ChangeOverState;
  ownWatch: boolean;
  gatekeeperOnDuty?: boolean;
  busy: boolean;
  online: boolean;
  readError: boolean;
  notes: string;
  onNotesChange: (text: string) => void;
  itemText: string;
  onItemTextChange: (text: string) => void;
  itemNotes: Record<string, string>;
  onItemNoteChange: (id: string, text: string) => void;
  onItemAction: (id: string, kind: "resolve" | "reopen") => void;
  onAddItem: () => void;
  onSave: () => void;
  onEditSave?: (notes: string) => Promise<void>;
  onSignHandoff?: (input: SignCommand) => Promise<void>;
  onAddNote?: (input: NoteCommand) => Promise<void>;
  onAssumeReviewed: () => void;
  pendingWatch: boolean;
  onRecoverWatch: () => void;
}

export default function GateDashboardHandoffCard(props: GateDashboardHandoffCardProps) {
  const { stationId, current, ownWatch, gatekeeperOnDuty = false, busy, online, readError, notes, onNotesChange, itemText, onItemTextChange, itemNotes, onItemNoteChange, onItemAction, onAddItem, onSave, onAssumeReviewed, pendingWatch, onRecoverWatch } = props;
  const { t, i18n } = useTranslation();
  const { primary } = useColors();
  const { width } = useWindowDimensions();
  const es = (i18n.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [itemView, setItemView] = useState<"open" | "resolved">("open");
  const [disclosure, setDisclosure] = useState<Record<string, boolean>>({});
  const [editingSigned, setEditingSigned] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState("");
  const [signCommand, setSignCommand] = useState<SignCommand | null>(null);
  const [newNote, setNewNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [noteCommand, setNoteCommand] = useState<NoteCommand | null>(null);
  const preparation = current.preparation;
  const signature = preparation?.summary.signature;
  const freshSaved = Boolean(preparation && !current.stale && current.snapshot?.revision && current.snapshot.revision === preparation.snapshot.revision);
  const ready = freshSaved && notes === preparation?.notes;
  const blocked = busy || !online || readError || pendingWatch;
  const mayEditItems = ownWatch || current.supervisor;
  const selectedItems = current.items.filter(item => item.status === itemView);
  useEffect(() => { if (signature) setEditingSigned(false); }, [preparation?.id, signature]);

  const label = { color: "#ececec", fontSize: 14, fontWeight: "600" as const };
  const muted = { color: "#b3b3b3", fontSize: 13 };
  const input = { color: "#ececec", backgroundColor: "#303034", borderColor: primary, borderWidth: 1, borderRadius: 7, padding: 9, minHeight: 44 };
  const panel = { backgroundColor: "#2b2b2f", borderColor: "#414145", borderWidth: 1, borderRadius: 10, padding: 12, gap: 10 } as const;
  const button = (text: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={text} disabled={disabled} onPress={onPress} style={{ alignSelf: "flex-start", paddingHorizontal: 11, paddingVertical: 9, borderWidth: 1, borderColor: "#515156", borderRadius: 8, backgroundColor: "#2b2b2f", opacity: disabled ? 0.5 : 1 }}><Text style={{ color: "#d1d1d1", fontSize: 13, fontWeight: "600" }}>{text}</Text></Pressable>;
  const section = (key: string, title: string, children: React.ReactNode) => <View style={{ borderTopColor: "#414145", borderTopWidth: 1, marginTop: 8 }}><Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: !!disclosure[key] }} onPress={() => setDisclosure(prior => ({ ...prior, [key]: !prior[key] }))} style={{ flexDirection: "row", alignItems: "center", minHeight: 44, gap: 5 }}><Text style={{ color: "#a3a3a3" }}>{disclosure[key] ? "▾" : "▸"}</Text><Text style={label}>{title}</Text></Pressable>{disclosure[key] && <View style={{ paddingBottom: 7, gap: 8 }}>{children}</View>}</View>;
  const sign = async () => {
    if (!current.shift || !props.onSignHandoff || signing) return;
    const command = signCommand ?? { operationId: Crypto.randomUUID(), expectedWatchId: current.shift.id, expectedPreparationId: preparation?.id ?? null, notes };
    setSignCommand(command); setSigning(true); setSignError("");
    try { await props.onSignHandoff(command); setSignCommand(null); setEditingSigned(false); }
    catch (error) { if ((error as { status?: number }).status && Number((error as { status?: number }).status) < 500) setSignCommand(null); setSignError(error instanceof Error ? error.message : t("changeOver.failed")); }
    finally { setSigning(false); }
  };
  const addNote = async () => {
    if (!current.shift || !props.onAddNote || !newNote.trim() || noteBusy) return;
    const command = noteCommand ?? { operationId: Crypto.randomUUID(), expectedWatchId: current.shift.id, text: newNote.trim() };
    setNoteCommand(command); setNoteBusy(true); setNoteError("");
    try { await props.onAddNote(command); setNewNote(""); setNoteCommand(null); setDisclosure(prior => ({ ...prior, review: true, savedNotes: true })); }
    catch (error) { if ((error as { status?: number }).status && Number((error as { status?: number }).status) < 500) setNoteCommand(null); setNoteError(error instanceof Error ? error.message : t("changeOver.failed")); }
    finally { setNoteBusy(false); }
  };
  const itemEditor = <View style={{ gap: 10 }}>
    <View style={{ flexDirection: "row", gap: 8 }}>{(["open", "resolved"] as const).map(view => button(t(view === "open" ? "changeOver.openItems" : "changeOver.resolvedItems"), () => setItemView(view)))}</View>
    {!selectedItems.length && <Text style={muted}>{t("changeOver.none")}</Text>}
    {selectedItems.map(item => <View key={item.id} style={{ borderWidth: 1, borderColor: "#4b4b50", borderRadius: 8, padding: 10, gap: 8 }}>
      <Text style={{ color: "#ececec", fontSize: 13 }}>{item.text}</Text>
      {mayEditItems && <><TextInput accessibilityLabel={t(item.status === "open" ? "changeOver.resolutionNote" : "changeOver.reopenNote")} placeholder={t(item.status === "open" ? "changeOver.resolutionNote" : "changeOver.reopenNote")} placeholderTextColor="#b3b3b3" maxLength={2000} editable={!blocked} value={itemNotes[item.id] ?? ""} onChangeText={value => onItemNoteChange(item.id, value)} style={input} />
        {button(t(item.status === "open" ? "changeOver.markResolved" : "changeOver.reopen"), () => onItemAction(item.id, item.status === "open" ? "resolve" : "reopen"), blocked || !itemNotes[item.id]?.trim())}</>}
    </View>)}
    {!stationId && itemView === "open" && mayEditItems && <><TextInput accessibilityLabel={t("changeOver.newItem")} placeholder={t("changeOver.newItem")} placeholderTextColor="#b3b3b3" maxLength={2000} multiline editable={!blocked} value={itemText} onChangeText={onItemTextChange} style={input} />{button(t("changeOver.addItem"), onAddItem, blocked || !itemText.trim())}</>}
  </View>;
  const savedReview = preparation && <View style={{ borderColor: "#414145", borderWidth: 1, borderRadius: 9, backgroundColor: "#2b2b2f", padding: 10, gap: 7 }}>
    <Text style={muted}>{t(preparation.summary.source === "ai_selected_facts" ? "handoffDesk.selectedFacts" : "handoffDesk.recordedFacts")} · {t("handoffDesk.savedAt")} {new Date(preparation.created_at).toLocaleString()} · {t("changeOver.asOf")} {new Date(preparation.snapshot.generatedAt).toLocaleString()}</Text>
    {signature && <Text style={muted}>{t("handoffDesk.signedBy", { name: signature.name })} · {new Date(signature.signedAt).toLocaleString()}</Text>}
    {section("savedFacts", `${t("handoffDesk.savedFacts")} · ${preparation.summary.facts.length}`, preparation.summary.facts.length ? preparation.summary.facts.map(fact => <Text key={fact.id} style={muted}>{fact.text}</Text>) : <Text style={muted}>{t("changeOver.none")}</Text>)}
    {section("savedActions", `${t("handoffDesk.savedActions")} · ${preparation.snapshot.openItems.length}`, preparation.snapshot.openItems.length ? preparation.snapshot.openItems.map(item => <Text key={item.id} style={muted}>{item.text}</Text>) : <Text style={muted}>{t("changeOver.none")}</Text>)}
    {section("savedNotes", t("handoffDesk.savedNotes"), <Text style={muted}>{preparation.notes || t("changeOver.none")}</Text>)}
  </View>;
  return <View accessibilityLabel={t("handoffDesk.title")} style={{ minWidth: 0, padding: 16, borderColor: primary, borderWidth: 1, borderRadius: 14, backgroundColor: "#242426", gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <Feather name="clipboard" size={20} color={primary} />
      <View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 17, fontWeight: "700" }}>{t("handoffDesk.title")}</Text><Text style={muted}>{t(ownWatch ? "handoffDesk.outgoingIntro" : "handoffDesk.incomingIntro")}</Text></View>
      {current.shift && ownWatch && props.onSignHandoff ? button(signature && !editingSigned ? t("handoffDesk.edit") : t("handoffDesk.signHandoff"), () => signature && !editingSigned ? setEditingSigned(true) : void sign(), blocked || signing)
        : current.shift && current.supervisor && props.onEditSave ? button(t("handoffDesk.editShift"), () => { setEditNotes(preparation?.notes ?? notes); setEditError(""); setEditing(true); }, blocked) : null}
    </View>
    {gatekeeperOnDuty && <View style={{ backgroundColor: "#2b2b2f", borderLeftWidth: 3, borderLeftColor: primary, padding: 9 }}><Text style={label}>{t("handoffDesk.nextActions")}</Text><Text style={muted}>{t(!ownWatch ? "handoffDesk.nextReview" : notes.trim() ? "handoffDesk.nextHandoff" : "handoffDesk.nextPrepare")}</Text></View>}
    {!!signError && <Text accessibilityRole="alert" style={muted}>{signError}</Text>}
    {(!online || readError || preparation && !freshSaved) && <Text style={muted}>{t(!online ? "changeOver.offline" : readError ? "handoffDesk.refreshRequired" : "handoffDesk.changed")}</Text>}
    {ownWatch && (!signature || editingSigned) ? <>
      <View style={{ flexDirection: width >= 640 ? "row" : "column", gap: 10 }}>
        <View style={[panel, { flex: 1 }]}><Text style={label}>▤  {t("changeOver.carryForward")}</Text>{stationId && <GateTaskHopperNative stationId={stationId} />}{(!stationId || current.items.length > 0) && itemEditor}</View>
        <View style={[panel, { flex: 1 }]}><Text style={label}>▤  {t("changeOver.outgoingNotes")}</Text><TextInput accessibilityLabel={t("changeOver.outgoingNotes")} placeholder={t("handoffDesk.notesHint")} placeholderTextColor="#b3b3b3" multiline maxLength={8000} editable={!blocked} value={notes} onChangeText={onNotesChange} style={[input, { minHeight: 100, textAlignVertical: "top" }]} />{!props.onSignHandoff && <>{button(t("handoffDesk.save"), onSave, blocked || !current.shift || !current.snapshot?.revision || ready)}<Text style={muted}>{t("handoffDesk.saveExplanation")}</Text></>}</View>
      </View>
      {section("review", t(preparation ? "handoffDesk.previewSaved" : "handoffDesk.draftPreview"), preparation ? savedReview : current.snapshot ? <><Text style={muted}>{t("handoffDesk.draftExplanation")} · {t("changeOver.asOf")} {new Date(current.snapshot.generatedAt).toLocaleString()}</Text>{current.snapshot.facts.map(fact => <Text key={fact.id} style={muted}>{fact.text}</Text>)}</> : <Text style={muted}>{t("changeOver.none")}</Text>)}
    </> : preparation ? savedReview : <Text style={muted}>{t(current.shift ? "handoffDesk.waiting" : "handoffDesk.noWatch", { name: current.shift?.operator_name })}</Text>}
    {stationId && current.items.length > 0 && (!ownWatch || signature && !editingSigned) && section("carry", t("changeOver.carryForward"), itemEditor)}
    {current.snapshot?.linkedScope?.groupId && section("linked", `${c("Linked gate handoffs", "Informes de accesos vinculados")} · ${(preparation?.snapshot ?? current.snapshot).linkedHandoffs?.length ?? 0}`, <>{((preparation?.snapshot ?? current.snapshot).linkedHandoffs ?? []).map(note => section(`linked:${note.id}`, `${note.siteName} | ${note.gateName}`, <><Text style={muted}>{note.operatorName} · {new Date(note.createdAt).toLocaleString()}</Text><Text style={muted}>{note.notes || t("changeOver.none")}</Text>{button(c("Open shift notes", "Abrir notas"), () => router.push(`/shift-notes?stationId=${note.stationId}&siteId=${note.siteId}` as never))}</>))}{!(preparation?.snapshot ?? current.snapshot).linkedHandoffs?.length && <Text style={muted}>{c("No other saved gate handoffs.", "No hay otros informes guardados.")}</Text>}</>)}
    {pendingWatch && <View style={{ backgroundColor: "#303034", padding: 8, gap: 8 }}><Text style={muted}>{t("handoffDesk.pendingWatch")}</Text>{button(t("handoffDesk.checkRequest"), onRecoverWatch, busy || !online)}</View>}
    {!ownWatch && (stationId || current.supervisor) && section("addTask", t("handoffDesk.addTaskToHopper"), stationId ? <GateTaskHopperNative stationId={stationId} /> : itemEditor)}
    {current.shift && props.onAddNote && (ownWatch || current.supervisor || gatekeeperOnDuty) && section("addNote", t("handoffDesk.addNewNote"), <><TextInput accessibilityLabel={t("handoffDesk.newNote")} multiline maxLength={2000} editable={!blocked && !noteBusy && !noteCommand} value={newNote} onChangeText={setNewNote} style={[input, { minHeight: 75 }]} />{ownWatch && notes !== (preparation?.notes ?? "") && <Text style={muted}>{t("handoffDesk.saveDraftFirst")}</Text>}{!!noteError && <Text accessibilityRole="alert" style={muted}>{noteError}</Text>}{button(t("handoffDesk.addNote"), () => void addNote(), blocked || noteBusy || !newNote.trim() || ownWatch && notes !== (preparation?.notes ?? ""))}</>)}
    {!ownWatch && <View style={{ borderTopWidth: 1, borderTopColor: "#414145", paddingTop: 8, gap: 8 }}><Text style={muted}>{t("handoffDesk.reviewExplanation")}</Text>{button(t("handoffDesk.assume"), onAssumeReviewed, blocked)}</View>}
    <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}><View style={{ flex: 1, justifyContent: "center", backgroundColor: "#0009", padding: 24 }}><View style={{ borderColor: primary, borderWidth: 2, borderRadius: 12, padding: 16, backgroundColor: "#fff", gap: 12 }}><Text style={{ color: "#111", fontWeight: "700", fontSize: 17 }}>{t("handoffDesk.editShift")}</Text><TextInput accessibilityLabel={t("handoffDesk.savedNotes")} multiline maxLength={8000} editable={!editBusy && !blocked} value={editNotes} onChangeText={setEditNotes} style={{ borderColor: primary, borderWidth: 1, borderRadius: 8, minHeight: 110, color: "#111", padding: 10 }} />{!!editError && <Text accessibilityRole="alert" style={{ color: "#b91c1c" }}>{editError}</Text>}{button(t("handoffDesk.save"), () => void (async () => { setEditBusy(true); setEditError(""); try { await props.onEditSave?.(editNotes); setEditing(false); } catch (error) { setEditError(error instanceof Error ? error.message : t("changeOver.failed")); } finally { setEditBusy(false); } })(), editBusy || blocked || editNotes === (preparation?.notes ?? notes) && freshSaved)}{button(c("Close", "Cerrar"), () => setEditing(false))}</View></View></Modal>
  </View>;
}
