import React, { useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Text, TextInput, View } from "react-native";
import { FleetReportSchema, FleetReportFilterSchema, FleetSavedViewInputSchema, type FleetSavedView, type FleetOverview, type FleetReport } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";

export default function FleetReports({ overview }: { overview: FleetOverview }) {
  const colors = useColors(), copy = useFleetCopy();
  const [fleetId, setFleetId] = useState<string | undefined>();
  const [siteId, setSiteId] = useState<number | undefined>();
  const [startsAt, setStartsAt] = useState(""), [endsAt, setEndsAt] = useState("");
  const [datePicker, setDatePicker] = useState<"start" | "end" | null>(null);
  const [report, setReport] = useState<FleetReport | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [views, setViews] = useState<FleetSavedView[]>([]), [viewName, setViewName] = useState("");
  const [selectedView, setSelectedView] = useState<FleetSavedView | null>(null);
  const [pendingView, setPendingView] = useState<ReturnType<typeof FleetSavedViewInputSchema.parse> | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current=true; void readViews(); return () => { alive.current = false; }; }, []);
  const text = { color: colors.text, fontSize: 16 };
  const sites = [...new Map(overview.runs.flatMap(run => run.labels?.sites ?? []).map(site => [site.siteId, site.name])).entries()];
  const siteIds = [...new Set(overview.fleets.filter(fleet => !fleetId || fleet.id === fleetId).flatMap(fleet => fleet.siteIds))];
  async function load() {
    const parsed = FleetReportFilterSchema.safeParse({ ...(fleetId ? { fleetId } : {}), ...(siteId ? { siteId } : {}), ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}) });
    if (!parsed.success) { setError("Choose valid start and end times; end must follow start."); return; }
    setBusy(true); setError(""); setReport(null);
    try {
      const query = new URLSearchParams(Object.entries(parsed.data).map(([key,value]) => [key,String(value)]));
      const result = FleetReportSchema.parse(await apiFetch<FleetReport>(`/api/fleet/reports?${query}`));
      if (alive.current) setReport(result);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Fleet report could not load."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function readViews() {
    try { const result = await apiFetch<{views:FleetSavedView[]}>("/api/fleet/views"); if (!Array.isArray(result.views)) throw new Error("Saved Fleet views unavailable."); if (alive.current) setViews(result.views); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Saved Fleet views unavailable."); }
  }
  async function writeView(input: ReturnType<typeof FleetSavedViewInputSchema.parse>) {
    setBusy(true); setError("");
    try {
      const result = await apiFetch<FleetSavedView>("/api/fleet/views", {method:"POST",body:JSON.stringify(input)});
      if (result.lastOperationId !== input.operationId) throw new Error("Saved view outcome needs verification.");
      if (alive.current) { setPendingView(null); setSelectedView(result.archived ? null : result); await readViews(); }
    } catch (e) {
      if (!alive.current) return;
      const status=(e as {status?:number}).status;
      if (!status || status >= 500) setPendingView(input); else {setPendingView(null);setSelectedView(null);await readViews();}
      setError(e instanceof Error ? e.message : "Saved view outcome needs verification.");
    } finally { if (alive.current) setBusy(false); }
  }
  function saveView(action: "save"|"archive") {
    const filters = FleetReportFilterSchema.safeParse({...(fleetId ? {fleetId}:{}),...(siteId ? {siteId}:{}),...(startsAt ? {startsAt}:{}),...(endsAt ? {endsAt}:{})});
    const parsed = FleetSavedViewInputSchema.safeParse({operationId:Crypto.randomUUID(),action,...(selectedView ? {viewId:selectedView.id,expectedVersion:selectedView.version}:{}),...(action === "save" ? {name:viewName,filters:filters.success ? filters.data : null}:{})});
    if (!parsed.success || (action === "archive" && !selectedView)) {setError("Name the view and choose valid filters before saving.");return;}
    void writeView(parsed.data);
  }
  async function verifyView() {
    if (!pendingView) return;
    setBusy(true);
    try {
      const result=await apiFetch<{views:FleetSavedView[]}>("/api/fleet/views");
      if (!alive.current) return;
      const saved=result.views.find(view=>view.lastOperationId===pendingView.operationId);
      if(saved) {setPendingView(null);setViews(result.views);setSelectedView(saved.archived?null:saved);}
      else await writeView(pendingView);
    } catch(e) {if(alive.current)setError(e instanceof Error?e.message:"Saved view outcome needs verification.");}
    finally {if(alive.current)setBusy(false);}
  }
  return <View style={{ gap: 12 }}>
    <Text style={text}>{copy("Fleet reports")}</Text>
    <Text style={text}>{copy("Saved filters are personal views. Saving them does not start a background collector or display them on another screen.")}</Text>
    {views.filter(view=>!view.archived).map(view=><TogglePillButton key={view.id} disabled={busy || !!pendingView} solid={selectedView?.id===view.id} onPress={()=>{setSelectedView(view);setViewName(view.name);setFleetId(view.filters.fleetId);setSiteId(view.filters.siteId);setStartsAt(view.filters.startsAt??"");setEndsAt(view.filters.endsAt??"");setReport(null);}}>{view.name}</TogglePillButton>)}
    <TogglePillButton disabled={busy || !!pendingView} onPress={()=>{setSelectedView(null);setViewName("");}}>{copy("New saved view")}</TogglePillButton>
    <TextInput editable={!busy && !pendingView} accessibilityLabel={copy("View name")} placeholder={copy("View name")} value={viewName} onChangeText={setViewName} style={{color:colors.text,borderWidth:1,borderColor:colors.border,padding:12}}/>
    <TogglePillButton disabled={busy || !!pendingView} onPress={()=>saveView("save")}>{copy("Save current filters")}</TogglePillButton>
    {selectedView && <TogglePillButton disabled={busy || !!pendingView} onPress={()=>saveView("archive")}>{copy("Archive saved view")}</TogglePillButton>}
    {pendingView && <TogglePillButton disabled={busy} onPress={()=>void verifyView()}>{copy("Verify the exact saved view operation")}</TogglePillButton>}
    <Text style={text}>{copy("Totals use recorded Fleet events within your current permissions. Missing source data stays unavailable.")}</Text>
    <TogglePillButton disabled={busy || !!pendingView} solid={!fleetId} onPress={() => { setFleetId(undefined); setSiteId(undefined); setReport(null); }}>{copy("All authorized fleets")}</TogglePillButton>
    {overview.fleets.map(fleet => <TogglePillButton key={fleet.id} disabled={busy || !!pendingView} solid={fleetId === fleet.id} onPress={() => { setFleetId(fleet.id); setSiteId(undefined); setReport(null); }}>{fleet.name}</TogglePillButton>)}
    <TogglePillButton disabled={busy || !!pendingView} solid={!siteId} onPress={() => { setSiteId(undefined); setReport(null); }}>{copy("All authorized sites")}</TogglePillButton>
    {siteIds.map(id => <TogglePillButton key={id} disabled={busy || !!pendingView} solid={siteId === id} onPress={() => { setSiteId(id); setReport(null); }}>{sites.find(([site]) => site === id)?.[1] ?? `${copy("Site")} ${id}`}</TogglePillButton>)}
    <TogglePillButton disabled={busy || !!pendingView} onPress={() => setDatePicker("start")}>{copy("Start date")}: {startsAt ? new Date(startsAt).toLocaleDateString() : copy("Any date")}</TogglePillButton>
    <TogglePillButton disabled={busy || !!pendingView} onPress={() => setDatePicker("end")}>{copy("End date (inclusive)")}: {endsAt ? new Date(Date.parse(endsAt) - 1).toLocaleDateString() : copy("Any date")}</TogglePillButton>
    <TogglePillButton disabled={busy || !!pendingView} onPress={() => { setStartsAt(""); setEndsAt(""); setReport(null); }}>{copy("Clear dates")}</TogglePillButton>
    {datePicker && <DateTimePicker mode="date" value={new Date()} onChange={(_, date) => { const which = datePicker; setDatePicker(null); if (!date) return; const value = new Date(date); value.setHours(0,0,0,0); if (which === "end") value.setDate(value.getDate() + 1); if (which === "start") setStartsAt(value.toISOString()); else setEndsAt(value.toISOString()); setReport(null); }}/>} 
    <TogglePillButton disabled={busy || !!pendingView} onPress={() => void load()}>{copy("Run authorized report")}</TogglePillButton>
    {error && <Text style={text}>{copy(error)}</Text>}
    {report && <>
      <Text style={text}>{copy("Selected dates use run creation time; totals come from the recorded events of those runs.")}</Text>
      <Text style={text}>{copy("Source")}: {copy(report.source)} · {copy("Generated")} {report.generatedAt}</Text>
      <Text style={text}>{copy("Runs")}: {report.runCount} · {copy("Completed")}: {report.completedRunCount} · {copy("Submitted for review")}: {report.submittedRunCount} · {copy("Inspection exceptions")}: {report.inspectionExceptions}</Text>
      {report.recordedTiming&&<><Text style={text}>{copy("Recorded workflow timing")}</Text><Text style={text}>{copy("Server event times describe recorded start-to-closeout intervals, not duty hours, billable time, physical presence or contractual timeliness.")}</Text><Text style={text}>{copy("Eligible recorded sequences")}: {report.recordedTiming.eligibleRunCount} · {copy("Excluded invalid sequences")}: {report.recordedTiming.invalidSequenceCount}</Text><Text style={text}>{copy("Recorded start-to-closeout minutes")}: {report.recordedTiming.elapsedMinutes} · {copy("Recorded paused minutes")}: {report.recordedTiming.pausedMinutes} · {copy("Recorded interval after pauses")}: {report.recordedTiming.activeMinutes}</Text><Text style={text}>{copy("Recorded starts after plan")}: {report.recordedTiming.lateStartCount} / {report.recordedTiming.plannedStartCount} · {copy("Recorded closeouts after plan")}: {report.recordedTiming.lateFinishCount} / {report.recordedTiming.plannedFinishCount}</Text></>}
      {report.loadTotals.map((load,index) => <Text key={index} style={text}>{load.commodity}: {load.quantity} {load.unit} · {copy("Recorded delivered quantity")}: {load.deliveredQuantity}</Text>)}
      {report.distanceTotals.map(distance => <Text key={distance.unit} style={text}>{copy("Recorded meter distance")}: {distance.distance} {copy(distance.unit)}</Text>)}
      {report.fuelTotals === null ? <Text style={text}>{copy("Fuel totals require separate financial read permission.")}</Text> : report.fuelTotals.map(fuel => <Text key={fuel.unit} style={text}>{copy("Recorded fuel")}: {fuel.quantity} {copy(fuel.unit)}</Text>)}
      {report.unavailableMetrics.map(item => <Text key={item.metric} style={text}>{copy(item.metric)}: {copy(item.reason)}</Text>)}
    </>}
  </View>;
}
