import React, { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import type { FleetSupportChoices, FleetSupportRead } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useFleetCopy } from "@/lib/fleet-copy";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import TogglePillButton from "@/components/TogglePillButton";

export default function FleetSupport() {
  const {user,activeMembershipId}=useAuth();
  return <Support key={`${user?.id}:${activeMembershipId}`} enabled={!!user?.id}/>;
}
function Support({enabled}:{enabled:boolean}) {
  const copy=useFleetCopy();
  const [choices,setChoices]=useState<FleetSupportChoices|null>(null);
  const [result,setResult]=useState<FleetSupportRead|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const alive=React.useRef(true);
  useEffect(()=>{alive.current=true;if(enabled)void apiFetch<FleetSupportChoices>("/api/fleet/support").then(value=>{if(value.readOnly!==true)throw new Error("Support scope could not be verified.");if(alive.current)setChoices(value);}).catch(e=>{if(alive.current)setError(e.message);});return()=>{alive.current=false;};},[enabled]);
  async function read(companyId:number,cursor?:string) {
    if(busy || !choices?.companies.some(company=>company.companyId===companyId))return;
    setBusy(true);setError("");if(!cursor)setResult(null);
    try {
      const value=await apiFetch<FleetSupportRead>(`/api/fleet/support/${companyId}${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`);
      if(value.companyId!==companyId || value.readOnly!==true || value.coordinateDisclosure!==false)throw new Error("Support scope could not be verified.");
      if(alive.current)setResult(previous=>cursor && previous?.companyId===companyId?{...value,runs:[...previous.runs,...value.runs.filter(run=>!previous.runs.some(old=>old.id===run.id))]}:value);
    } catch(e){if(alive.current){setResult(null);setError(e instanceof Error?e.message:"Support read failed.");}}
    finally{if(alive.current)setBusy(false);}
  }
  return <ScreenSafeArea><ScrollView contentContainerStyle={{padding:16,gap:12}}>
    <Text>{copy("Fleet support")}</Text><Text>{copy("Explicit, time-limited read-only company access. No operational controls or driver coordinates.")}</Text>
    {!!error && <Text accessibilityRole="alert">{copy(error)}</Text>}
    {choices?.companies.length===0 && <Text>{copy("No current Fleet support grants.")}</Text>}
    {choices?.companies.map(company=><TogglePillButton key={company.companyId} disabled={busy} onPress={()=>void read(company.companyId)}>{company.companyName}</TogglePillButton>)}
    {result && <><Text>{result.companyName} · {copy("expires")}: {result.expiresAt}</Text><Text>{result.reason}</Text>
      {result.runs.map(run=><React.Fragment key={run.id}><Text>{run.title} · {copy(run.status)} · {copy("revision")}: {run.version}</Text><Text>{run.id}</Text>{run.loads.map(load=><Text key={load.id}>{load.commodity}: {load.quantity} {load.unit} · {load.manifestReference} · {load.deliveryReference ?? copy("not recorded")}</Text>)}{run.records.map(record=><Text key={record.id}>{copy(record.kind)}: {record.quantity ?? record.reading} {record.unit} · {record.recordedAt}</Text>)}</React.Fragment>)}
      {result.page.nextCursor && <TogglePillButton disabled={busy} onPress={()=>void read(result.companyId,result.page.nextCursor!)}>{copy("Load more runs")}</TogglePillButton>}
    </>}
  </ScrollView></ScreenSafeArea>;
}
