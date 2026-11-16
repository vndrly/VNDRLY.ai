import React, { useEffect, useRef, useState } from "react";
import { AppState, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import DismissibleModal from "@/components/DismissibleModal";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { captureAuthScope, isAuthScopeCurrent, type StoredUser } from "@/lib/auth";
import { offlinePeople, type OfflineGateSnapshot, type OfflinePerson, type OfflineGatePayload } from "@/lib/gate-offline";
import { readOfflineGate, refreshOfflineGate } from "@/lib/gate-offline-runtime";
import { enqueueNativeOperation, readNativeJournal, retryRefusedNativeOperation } from "@/lib/native-operation-journal-runtime";
import type { JournalEntry } from "@/lib/native-operation-journal";
import { nativeUuid } from "@/lib/native-uuid";

const empty = { firstName: "", lastName: "", company: "", plateState: "", plate: "", notes: "" };
export default function GateOfflineLog({ user, pageFailed, onRetry }: {
  user: StoredUser; pageFailed: boolean; onRetry(): void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const [open, setOpen] = useState(false), [outage, setOutage] = useState(false);
  const [snapshot, setSnapshot] = useState<OfflineGateSnapshot | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [draft, setDraft] = useState(empty), [review, setReview] = useState(false);
  const [exit, setExit] = useState<OfflinePerson | null>(null);
  const [section, setSection] = useState<"entry" | "exit">("entry"), [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const working = useRef(false), polling = useRef(false);
  const pending = entries.filter(e => e.domain === "gate" && e.state !== "synced");
  const uploaded = entries.filter(e => e.domain === "gate" && e.state === "synced");
  const people = snapshot ? offlinePeople(snapshot, entries) : [];
  const label = (key: string, values?: Record<string, unknown>) => t(`gateOffline.${key}`, values);
  const text = { color: colors.text, fontSize: 16 };
  const button = { minHeight: 44 };
  const draftGate = useRef<string | null>(null);
  async function show() {
    const scope = captureAuthScope();
    setOpen(true);
    try { const saved = await readOfflineGate(user); if (isAuthScopeCurrent(scope)) setSnapshot(saved); }
    catch { if (isAuthScopeCurrent(scope)) setMessage(label("storageError")); }
  }

  useEffect(() => {
    let alive = true;
    const scope = captureAuthScope();
    const current = () => alive && isAuthScopeCurrent(scope);
    const read = async () => {
      const [saved, journal] = await Promise.all([readOfflineGate(user), readNativeJournal(user)]);
      if (current()) { setSnapshot(saved); setEntries(previous => [...journal, ...previous.filter(e => e.state !== "synced" && !journal.some(row => row.operationId === e.operationId))]); }
      return saved;
    };
    const poll = async () => {
      if (polling.current || AppState.currentState !== "active") return;
      polling.current = true;
      try {
        const saved = await read();
        if (saved && current()) {
          try { await refreshOfflineGate(user, saved); if (current()) setOutage(false); }
          catch (error) {
            if (current()) {
              const status = (error as { status?: number }).status;
              setOutage(!status || status >= 500);
              if (status === 401 || status === 403) setMessage(label("accessRequired"));
            }
          }
          await read();
        }
      } catch { if (current()) setMessage(label("storageError")); }
      finally { polling.current = false; }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 15_000);
    const active = AppState.addEventListener("change", state => { if (state === "active") void poll(); });
    return () => { alive = false; clearInterval(timer); active.remove(); };
  }, [user.id, user.activeMembershipId]);
  useEffect(() => { if (pageFailed || outage) setOpen(true); }, [pageFailed, outage]);

  async function record() {
    if (working.current || !snapshot) return;
    const gate = `${snapshot.siteId}:${snapshot.stationId}`;
    if (draftGate.current !== gate) { setReview(false); setExit(null); setMessage(label("gateChanged")); return; }
    const scope = captureAuthScope();
    const at = new Date().toISOString();
    working.current = true; setBusy(true);
    try {
      const recorded = await enqueueNativeOperation(user, { operationId: nativeUuid(), domain: "gate", capturedAt: at,
        payload: { siteLocationId: snapshot.siteId, gateStationId: snapshot.stationId,
          direction: exit ? "exit" : "entry",
          ...(exit ? { ...(exit.entryOperationId ? { entryOperationId: exit.entryOperationId } : { originalVisitId: exit.originalVisitId }),
            plate: exit.vehiclePlate || undefined, plateState: exit.plateState || undefined,
          } : { plate: draft.plate.trim() || undefined, plateState: draft.plateState.trim().toUpperCase() || undefined,
            reportedVisitor: { firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), company: draft.company.trim(), notes: draft.notes.trim() } }),
        } });
      if (isAuthScopeCurrent(scope)) {
        setEntries(rows => rows.some(e => e.operationId === recorded.operationId) ? rows : [...rows, recorded]);
        setDraft(empty); setReview(false); setExit(null); setMessage(label("saved"));
      }
    } catch { if (isAuthScopeCurrent(scope)) setMessage(label("storageError")); }
    finally { working.current = false; if (isAuthScopeCurrent(scope)) setBusy(false); }
  }
  function chooseExit(person: OfflinePerson) {
    draftGate.current = snapshot ? `${snapshot.siteId}:${snapshot.stationId}` : null;
    setExit(person); setReview(false); setMessage("");
  }
  async function retry(entry: JournalEntry) {
    if (working.current) return;
    const scope = captureAuthScope(); working.current = true; setBusy(true);
    try {
      const next = await retryRefusedNativeOperation(user, entry.operationId);
      if (isAuthScopeCurrent(scope)) setEntries(rows => rows.map(row => row.operationId === next.operationId ? next : row));
    } catch { if (isAuthScopeCurrent(scope)) setMessage(label("storageError")); }
    finally { working.current = false; if (isAuthScopeCurrent(scope)) setBusy(false); }
  }
  return <>
    <View style={{ padding: 8, backgroundColor: colors.background, gap: 4 }}>
      <TogglePillButton onPress={() => { void show(); }}>{label("open", { count: pending.length })}</TogglePillButton>
      {(outage || pageFailed) && <Text accessibilityRole="alert" style={text}>{label("unavailable")}</Text>}
    </View>
    <DismissibleModal visible={open} animationType="slide" onRequestClose={() => { if (!busy) setOpen(false); }} dismissDisabled={busy} dismissLabel="close">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text accessibilityRole="header" style={[text, { fontSize: 22, fontWeight: "700" }]}>{label("title")}</Text>
        <Text style={text}>{label("warning")}</Text>
        <Text style={text}>{label("pendingCount", { count: pending.length })}</Text>
        {uploaded.length > 0 && <Text style={text}>{label("uploaded", { count: uploaded.length })}</Text>}
        {message ? <Text accessibilityRole="alert" style={text}>{message}</Text> : null}
        {!snapshot ? <Text style={text}>{label("noCache")}</Text> : <>
          <Text style={[text, { fontWeight: "700" }]}>{snapshot.siteName} · {snapshot.stationName}</Text>
          <Text style={text}>{label("cached", { time: new Date(snapshot.capturedAt).toLocaleString() })}</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <TogglePillButton disabled={busy} onPress={() => { setSection("entry"); setReview(false); setExit(null); }}>{label("checkIns")}</TogglePillButton>
            <TogglePillButton disabled={busy} onPress={() => { setSection("exit"); setReview(false); setExit(null); }}>{label("checkOuts")}</TogglePillButton>
          </View>
          {review || exit ? <View style={{ gap: 12 }}>
            <Text style={[text, { fontWeight: "700" }]}>{label(exit ? "reviewExit" : "reviewEntry")}</Text>
            <Text style={text}>{exit ? `${exit.firstName} ${exit.lastName} · ${exit.company || ""} · ${exit.plateState || ""} ${exit.vehiclePlate || ""}` : `${draft.firstName} ${draft.lastName} · ${draft.company} · ${draft.plateState} ${draft.plate}`}</Text>
            <Text style={text}>{label("observedOnly")}</Text>
            <TogglePillButton disabled={busy} onPress={() => { void record(); }}>{label("save")}</TogglePillButton>
            <TogglePillButton disabled={busy} onPress={() => { setReview(false); setExit(null); }}>{label("cancel")}</TogglePillButton>
          </View> : <>
            {section === "entry" ? <>
            <Text accessibilityRole="header" style={[text, { fontWeight: "700" }]}>{label("entry")}</Text>
            {(Object.keys(empty) as Array<keyof typeof empty>).map(field => <View key={field} style={{ gap: 4 }}>
              <Text style={text}>{label(field)}</Text>
              <TextInput accessibilityLabel={label(field)} value={draft[field]} editable={!busy}
                maxLength={field === "notes" ? 2000 : field === "plateState" ? 8 : field === "plate" ? 32 : field === "company" ? 200 : 100}
                autoCorrect={false} autoCapitalize={field === "plate" || field === "plateState" ? "characters" : "words"}
                onChangeText={value => { setDraft(d => ({ ...d, [field]: value })); setMessage(""); }}
                style={[text, button, { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 }]}/>
            </View>)}
            <TogglePillButton disabled={busy || !draft.firstName.trim() || !draft.lastName.trim()} onPress={() => {
              draftGate.current = `${snapshot.siteId}:${snapshot.stationId}`; setReview(true); setMessage("");
            }}>{label("reviewEntry")}</TogglePillButton>
            </> : <>
            <Text accessibilityRole="header" style={[text, { fontWeight: "700" }]}>{label("knownOnSite", { count: people.length })}</Text>
            <Text style={text}>{label("staleRoster")}</Text>
            <TextInput accessibilityLabel={label("search")} placeholder={label("search")} placeholderTextColor={colors.text}
              value={search} onChangeText={setSearch} style={[text, button, { borderWidth: 1, borderColor: colors.border, padding: 10, borderRadius: 8 }]} />
            {people.length > 50 && <Text style={text}>{label("searchLimit")}</Text>}
            {people.filter(p => `${p.firstName} ${p.lastName} ${p.company ?? ""} ${p.vehiclePlate ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 50).map(person => <View key={person.key} style={{ gap: 8, borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 12 }}>
              <Text style={text}>{person.firstName} {person.lastName} · {person.company}</Text>
              <Text style={text}>{person.plateState} {person.vehiclePlate} · {new Date(person.checkInTime).toLocaleString()}</Text>
              <TogglePillButton onPress={() => chooseExit(person)}>{label("reviewExit")}</TogglePillButton>
            </View>)}
            </>}
          </>}
        </>}
        {pending.map(entry => <View key={entry.operationId} style={{ gap: 4 }}>
          <Text style={text}>{(entry.payload as OfflineGatePayload).reportedVisitor?.firstName} {(entry.payload as OfflineGatePayload).reportedVisitor?.lastName} · {(entry.payload as OfflineGatePayload).plate}</Text>
          <Text selectable style={text}>{entry.operationId}</Text>
          <Text style={text}>{label(entry.state)} · {new Date(entry.capturedAt).toLocaleString()}</Text>
          {entry.state !== "pending" && <Text style={text}>{label("needsReview")}</Text>}
          {(entry.state === "revoked" || entry.state === "failed") && <TogglePillButton disabled={busy} onPress={() => { void retry(entry); }}>{label("retry")}</TogglePillButton>}
        </View>)}
        <TogglePillButton disabled={busy} onPress={() => { setOpen(false); onRetry(); }}>{label("return")}</TogglePillButton>
      </ScrollView>
    </DismissibleModal>
  </>;
}
