import React, { useEffect, useRef, useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { FleetMaintenanceCreateSchema, FleetMaintenanceActionSchema, FleetMaintenanceRecordSchema, type FleetMaintenancePage, type FleetMaintenanceRecord, type FleetOverview, type FleetResources } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";

/** Record reports only; permissions and safety releases always come from the server. */
export default function FleetMaintenance({ overview, resources, userId }: { overview: FleetOverview; resources: FleetResources; userId: number }) {
  const colors = useColors(), copy = useFleetCopy();
  const [page, setPage] = useState<FleetMaintenancePage | null>(null);
  const [selected, setSelected] = useState<FleetMaintenanceRecord | null>(null);
  const [assetId, setAssetId] = useState("");
  const [fleetId, setFleetId] = useState("");
  const [runId, setRunId] = useState<string | undefined>();
  const [kind, setKind] = useState<"defect" | "scheduled_service">("defect");
  const [title, setTitle] = useState(""), [notes, setNotes] = useState(""), [dueAt, setDueAt] = useState("");
  const [datePicker, setDatePicker] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ path: string; body: { operationId: string }; recordId?: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  const text = { color: colors.text, fontSize: 16 };
  const field = { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12 };
  const locked = busy || !!pending;
  const canReport = (overview.capabilities.canReportDefect ?? (overview.capabilities.canManage || overview.capabilities.canDrive)) || overview.capabilities.canMaintain === true;
  async function load(cursor?: string) {
    try {
      const result = await apiFetch<FleetMaintenancePage>(`/api/fleet/maintenance${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (alive.current) setPage(previous => cursor && previous ? { ...result, records: [...previous.records, ...result.records] } : result);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Maintenance could not load."); }
  }
  async function submit(request: NonNullable<typeof pending>) {
    setBusy(true); setError("");
    try {
      const result = FleetMaintenanceRecordSchema.parse(await apiFetch(request.path, { method: "POST", body: JSON.stringify(request.body) }));
      if (!result.events.some(event => event.operationId === request.body.operationId)) throw new Error("Maintenance outcome needs verification.");
      if (!alive.current) return;
      setPending(null); setSelected(result); setNotes(""); await load();
    } catch (e) {
      if (!alive.current) return;
      const status = (e as { status?: number }).status;
      if (!status || status >= 500) setPending(request);
      else { setPending(null); setSelected(null); await load(); }
      setError(e instanceof Error ? e.message : "Maintenance outcome needs verification.");
    } finally { if (alive.current) setBusy(false); }
  }
  async function verify() {
    if (!pending) return;
    setBusy(true);
    try {
      const records = pending.recordId ? [FleetMaintenanceRecordSchema.parse(await apiFetch(`/api/fleet/maintenance/${pending.recordId}`))] : (await apiFetch<FleetMaintenancePage>("/api/fleet/maintenance")).records;
      if (!alive.current) return;
      const saved = records.find(record => record.events.some(event => event.operationId === pending.body.operationId));
      if (saved) { setSelected(saved); setPending(null); await load(); }
      else await submit(pending); // Same immutable operation, never a replacement request.
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Maintenance outcome needs verification."); }
    finally { if (alive.current) setBusy(false); }
  }
  function create() {
    const input = FleetMaintenanceCreateSchema.safeParse({ operationId: Crypto.randomUUID(), fleetId, assetId, runId, kind, title, notes, ...(dueAt ? { dueAt } : {}) });
    if (!input.success) { setError("Choose the exact equipment and provide a title and report notes."); return; }
    void submit({ path: "/api/fleet/maintenance", body: input.data });
  }
  function action(name: "triage" | "record_repair" | "release" | "cancel") {
    if (!selected?.allowedActions.includes(name)) return;
    const input = FleetMaintenanceActionSchema.safeParse({ operationId: Crypto.randomUUID(), expectedVersion: selected.version, action: name, notes });
    if (!input.success) { setError("Provide report notes before saving."); return; }
    void submit({ path: `/api/fleet/maintenance/${selected.id}/actions`, recordId: selected.id, body: input.data });
  }
  return <View style={{ gap: 12 }}>
    <Text style={text}>{copy("Fleet maintenance")}</Text>
    <Text style={text}>{copy("Reports describe user supplied facts. They do not prove physical repair, compliance or inspection evidence. A dispatcher cannot release a safety hold.")}</Text>
    {error && <Text style={text}>{copy(error)}</Text>}
    {pending && <TogglePillButton disabled={busy} onPress={() => void verify()}>{copy("Verify and retry the exact maintenance operation")}</TogglePillButton>}
    {page?.records.map(record => <TogglePillButton key={record.id} disabled={locked} onPress={() => { setBusy(true); void apiFetch(`/api/fleet/maintenance/${record.id}`).then(value => { if (alive.current) { setSelected(FleetMaintenanceRecordSchema.parse(value)); setNotes(""); } }).catch(e => { if (alive.current) setError(e.message); }).finally(() => { if (alive.current) setBusy(false); }); }}>{record.title} · {copy(record.status)}</TogglePillButton>)}
    {page?.nextCursor && <TogglePillButton disabled={locked} onPress={() => void load(page.nextCursor!)}>{copy("Load more maintenance records")}</TogglePillButton>}
    {selected && <View style={{ gap: 8 }}>
      <Text style={text}>{selected.title} · {copy(selected.status)} · {copy("revision")} {selected.version}</Text>
      <Text style={text}>{copy("Equipment")} {selected.assetId} · {copy("Safety hold")} {selected.holdId ?? copy("none")}</Text>
      {selected.events.map(event => <Text key={event.operationId} style={text}>{copy(event.action)} · {event.notes} · {copy(event.source)} · {event.recordedAt}</Text>)}
      {selected.allowedActions.map(name => <TogglePillButton key={name} disabled={locked} onPress={() => action(name)}>{copy(name)}</TogglePillButton>)}
    </View>}
    <Text style={text}>{copy("New equipment report")}</Text>
    {overview.runs.filter(run => run.driverUserId === userId).map(run => <View key={run.id} style={{ gap: 8 }}>
      <TogglePillButton disabled={locked} solid={runId === run.id && assetId === run.vehicleAssetId} onPress={() => { setRunId(run.id); setFleetId(run.fleetId); setAssetId(run.vehicleAssetId); setKind("defect"); setSelected(null); }}>{run.title} · {run.labels?.vehicleName ?? run.vehicleAssetId}</TogglePillButton>
      {run.trailerAssetId && <TogglePillButton disabled={locked} solid={runId === run.id && assetId === run.trailerAssetId} onPress={() => { setRunId(run.id); setFleetId(run.fleetId); setAssetId(run.trailerAssetId!); setKind("defect"); setSelected(null); }}>{run.title} · {run.labels?.trailerName ?? run.trailerAssetId}</TogglePillButton>}
    </View>)}
    {overview.capabilities.canManage && <>
      {overview.fleets.map(fleet => <TogglePillButton key={fleet.id} disabled={locked} solid={fleetId === fleet.id} onPress={() => { setFleetId(fleet.id); setAssetId(""); setRunId(undefined); setSelected(null); }}>{fleet.name}</TogglePillButton>)}
      {resources.equipment.filter(asset => overview.fleets.find(fleet => fleet.id === fleetId)?.equipmentAssetIds.includes(asset.id)).map(asset => <TogglePillButton key={asset.id} disabled={locked} solid={assetId === asset.id} onPress={() => { setAssetId(asset.id); setRunId(undefined); setSelected(null); }}>{asset.name}</TogglePillButton>)}
      <TogglePillButton disabled={locked} onPress={() => setKind(kind === "defect" ? "scheduled_service" : "defect")}>{copy(kind)}</TogglePillButton>
      <TogglePillButton disabled={locked} onPress={() => setDatePicker(true)}>{copy("Service due date")}: {dueAt ? new Date(dueAt).toLocaleDateString() : copy("No date")}</TogglePillButton>
      <TogglePillButton disabled={locked} onPress={() => setDueAt("")}>{copy("Clear due date")}</TogglePillButton>
      {datePicker && <DateTimePicker mode="date" value={dueAt ? new Date(dueAt) : new Date()} onChange={(_, date) => { setDatePicker(false); if (date) setDueAt(date.toISOString()); }}/>}
    </>}
    <TextInput editable={!locked} accessibilityLabel={copy("Report title")} placeholder={copy("Report title")} value={title} onChangeText={setTitle} style={field}/>
    <TextInput editable={!locked} accessibilityLabel={copy("Report notes")} placeholder={copy("Report notes")} value={notes} onChangeText={setNotes} multiline style={field}/>
    <TogglePillButton disabled={locked || !!selected || !canReport} onPress={create}>{copy("Save equipment report")}</TogglePillButton>
  </View>;
}
