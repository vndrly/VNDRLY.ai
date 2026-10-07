import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { FleetEtaSchema, type FleetEta as Eta } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";

export default function FleetEta({runId,disabled}:{runId:string;disabled:boolean}) {
  const copy=useFleetCopy(),[result,setResult]=useState<Eta|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const alive=React.useRef(true);
  const disabledRef=React.useRef(disabled);disabledRef.current=disabled;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(disabled)setResult(null);},[disabled]);
  async function read(){
    if(disabled||busy)return;setBusy(true);setError("");setResult(null);
    try{const value=FleetEtaSchema.parse(await apiFetch(`/api/fleet/runs/${runId}/eta`));if(value.runId!==runId)throw new Error("ETA scope could not be verified.");if(alive.current && !disabledRef.current)setResult(value);}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:"ETA unavailable.");}
    finally{if(alive.current)setBusy(false);}
  }
  return <View style={{gap:8}}><TogglePillButton disabled={disabled||busy} onPress={()=>void read()}>{copy("Read phone-based driving estimate")}</TogglePillButton>
    {!!error&&<Text accessibilityRole="alert">{copy(error)}</Text>}
    {result?.ok===false&&<Text>{copy("ETA unavailable")}: {result.code}</Text>}
    {result?.ok===true&&<><Text>{result.siteName}: {result.durationMinutes.toFixed(1)} {copy("minutes")} · {result.distanceMiles.toFixed(1)} {copy("miles")}</Text><Text>{copy("Driver-phone capture")}: {result.sourceRecordedAt} · {copy("received")}: {result.sourceReceivedAt} · {copy("accuracy")}: {result.sourceAccuracyMeters} m</Text><Text>{copy("Estimate time")}: {result.estimatedAt} · Mapbox · {copy(result.routeConfidence)}</Text><Text>{copy("Driving estimate only. Not verified truck-safe routing or physical arrival proof.")}</Text></>}
  </View>;
}
