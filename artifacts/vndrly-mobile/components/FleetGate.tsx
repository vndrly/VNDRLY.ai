import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { FleetGateLinkInputSchema, type FleetGateLink, type FleetGateObservations, type FleetRun } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";

export default function FleetGate({ run, disabled, onChanged }: { run: FleetRun; disabled: boolean; onChanged: () => void }) {
  const colors = useColors(), copy = useFleetCopy();
  const [data, setData] = useState<FleetGateObservations | null>(null);
  const [stopId, setStopId] = useState(""), [visitId, setVisitId] = useState<number | null>(null), [reason, setReason] = useState("");
  const [pending, setPending] = useState<ReturnType<typeof FleetGateLinkInputSchema.parse> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {alive.current=true;return () => { alive.current = false; };}, []);
  const text = { color: colors.text, fontSize: 16 };
  const stop = run.stops.find(item => item.id === stopId);
  const locked = disabled || busy || !!pending;
  async function read() {
    setBusy(true); setError("");
    try { const value = await apiFetch<FleetGateObservations>(`/api/fleet/runs/${run.id}/gate-observations`); if (alive.current) { setData(value); setVisitId(null); } }
    catch (e) { if (alive.current) { setData(null); setError(e instanceof Error ? e.message : "Gate observations could not load."); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function submit(input: ReturnType<typeof FleetGateLinkInputSchema.parse>) {
    setBusy(true); setError("");
    try {
      const result = await apiFetch<FleetGateLink>(`/api/fleet/runs/${run.id}/gate-links`, { method:"POST",body:JSON.stringify(input) });
      if (result.operationId !== input.operationId || result.runId !== run.id || result.stopId !== input.stopId || result.visitId !== input.visitId) throw new Error("Gate link outcome needs verification.");
      if (alive.current) { setPending(null); onChanged(); }
    } catch (e) {
      if (!alive.current) return;
      const status = (e as {status?:number}).status;
      if (!status || status >= 500) setPending(input); else { setPending(null); setData(null); }
      setError(e instanceof Error ? e.message : "Gate link outcome needs verification.");
    } finally { if (alive.current) setBusy(false); }
  }
  function link() {
    if (!data?.canLink || !data.observations.some(observation => observation.visitId === visitId && observation.siteId === stop?.siteId && observation.vehicleAssetId === run.vehicleAssetId)) return;
    const input = FleetGateLinkInputSchema.safeParse({operationId:Crypto.randomUUID(),expectedVersion:data.version,stopId,visitId,reason});
    if (!input.success) { setError("Choose the exact stop and existing Gate visit, and explain the match."); return; }
    void submit(input.data);
  }
  async function verify() {
    if (!pending) return;
    setBusy(true);
    try {
      const value = await apiFetch<FleetGateObservations>(`/api/fleet/runs/${run.id}/gate-observations`);
      if (!alive.current) return;
      if (value.links.some(item => item.operationId === pending.operationId && item.stopId === pending.stopId && item.visitId === pending.visitId)) { setPending(null); onChanged(); }
      else await submit(pending);
    } catch(e) { if(alive.current)setError(e instanceof Error ? e.message : "Gate link outcome needs verification."); }
    finally { if(alive.current)setBusy(false); }
  }
  return <View style={{gap:8}}>
    <Text style={text}>{copy("Gate visit reconciliation")}</Text>
    <Text style={text}>{copy("Link an existing visit only after checking the exact equipment and stop. This does not admit anyone, create a visit or record Fleet arrival or delivery.")}</Text>
    <TogglePillButton disabled={locked} onPress={()=>void read()}>{copy("Load authorized Gate observations")}</TogglePillButton>
    {error && <Text style={text}>{copy(error)}</Text>}
    {pending && <TogglePillButton disabled={disabled || busy} onPress={()=>void verify()}>{copy("Verify the exact Gate link operation")}</TogglePillButton>}
    {data && <>
      {data.ambiguous && <Text style={text}>{copy("Multiple visits match the time window. Choose the verified visit; no automatic match was made.")}</Text>}
      {data.observations.length === 0 && <Text style={text}>{copy("No authorized observation matches this equipment and time window.")}</Text>}
      {data.links.map(item=><Text key={item.operationId} style={text}>{copy("Saved Gate link")}: {item.visitId} · {copy("stop")} {item.stopId} · {item.recordedAt}</Text>)}
      {data.canLink && <>
        {run.stops.map(item=><TogglePillButton key={item.id} disabled={locked} solid={item.id===stopId} onPress={()=>{setStopId(item.id);setVisitId(null);}}>{item.sequence+1}. {copy(item.kind)} · {run.labels?.sites.find(site=>site.siteId===item.siteId)?.name ?? `${copy("Site")} ${item.siteId}`}</TogglePillButton>)}
        {data.observations.filter(item=>item.siteId===stop?.siteId && item.vehicleAssetId===run.vehicleAssetId).map(item=><TogglePillButton key={item.visitId} disabled={locked} solid={item.visitId===visitId} onPress={()=>setVisitId(item.visitId)}>{copy("Gate visit")} {item.visitId} · {item.checkInAt} · {copy(item.source ?? "source not supplied")}</TogglePillButton>)}
        <TextInput editable={!locked} accessibilityLabel={copy("Gate match reason")} placeholder={copy("Gate match reason")} value={reason} onChangeText={setReason} style={{color:colors.text,borderColor:colors.border,borderWidth:1,padding:12}}/>
        <TogglePillButton disabled={locked || !visitId || !stopId} onPress={link}>{copy("Link the selected existing visit")}</TogglePillButton>
      </>}
    </>}
  </View>;
}
