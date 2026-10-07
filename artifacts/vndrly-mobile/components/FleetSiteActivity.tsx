import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import type { FleetSiteActivity as Activity, FleetSiteChoices } from "@workspace/api-zod";
import { FleetSiteActivityFilterSchema } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import { ScrollView } from "react-native";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";

export default function FleetSiteActivity() {
  const {user,activeMembershipId}=useAuth();
  const identity=`${user?.id}:${activeMembershipId}`;
  return <SiteActivity key={identity} enabled={!!user?.id}/>;
}
function SiteActivity({enabled}:{enabled:boolean}) {
  const colors=useColors(),copy=useFleetCopy();
  const [choices,setChoices]=useState<FleetSiteChoices|null>(null);
  const [siteId,setSiteId]=useState<number|null>(null);
  const [result,setResult]=useState<Activity|null>(null);
  const [startsAt,setStartsAt]=useState(""),[endsAt,setEndsAt]=useState("");
  const [picker,setPicker]=useState<"start"|"end"|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{let alive=true;if(enabled)void apiFetch<FleetSiteChoices>("/api/fleet/site-activity").then(value=>{if(alive)setChoices(value);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[enabled]);
  const alive=React.useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const text={color:colors.text,fontSize:16};
  async function read(){
    if(!choices?.capabilities.canReadSiteActivity || !choices.sites.some(site=>site.siteId===siteId))return;
    const filter=FleetSiteActivityFilterSchema.safeParse({...(startsAt?{startsAt}:{}),...(endsAt?{endsAt}:{})});
    if(!filter.success){setError("Choose valid start and end times; end must follow start.");return;}
    setBusy(true);setError("");setResult(null);
    try {
      const query=new URLSearchParams(Object.entries(filter.data));
      const data=await apiFetch<Activity>(`/api/fleet/site-activity/${siteId}?${query}`);
      if(data.siteId!==siteId || data.coordinateDisclosure!==false)throw new Error("Site activity scope could not be verified.");
      if(alive.current)setResult(data);
    } catch(e){if(alive.current)setError(e instanceof Error?e.message:"Site activity could not load.");}
    finally{if(alive.current)setBusy(false);}
  }
  return <ScreenSafeArea><ScrollView contentContainerStyle={{padding:16,gap:12}}>
    <WorkHubPageTitle title={copy("Fleet site activity")}/>
    <Text style={text}>{copy("Partner view of recorded activity at an authorized site. It does not expose driver coordinates, other stops, fuel or dispatch controls.")}</Text>
    {error && <Text style={text}>{copy(error)}</Text>}
    {choices?.sites.length===0 && <Text style={text}>{copy("No authorized sites are available for this view.")}</Text>}
    {choices?.sites.map(site=><TogglePillButton key={site.siteId} disabled={busy} solid={siteId===site.siteId} onPress={()=>{setSiteId(site.siteId);setResult(null);}}>{site.name}</TogglePillButton>)}
    <TogglePillButton disabled={busy} onPress={()=>setPicker("start")}>{copy("Start date")}: {startsAt?new Date(startsAt).toLocaleDateString():copy("Default recent window")}</TogglePillButton>
    <TogglePillButton disabled={busy} onPress={()=>setPicker("end")}>{copy("End date (inclusive)")}: {endsAt?new Date(Date.parse(endsAt)-1).toLocaleDateString():copy("Default recent window")}</TogglePillButton>
    <TogglePillButton disabled={busy} onPress={()=>{setStartsAt("");setEndsAt("");setResult(null);}}>{copy("Clear dates")}</TogglePillButton>
    {picker && <DateTimePicker mode="date" value={new Date()} onChange={(_,date)=>{const which=picker;setPicker(null);if(!date)return;const value=new Date(date);value.setHours(0,0,0,0);if(which==="end")value.setDate(value.getDate()+1);if(which==="start")setStartsAt(value.toISOString());else setEndsAt(value.toISOString());setResult(null);}}/>}
    <TogglePillButton disabled={busy || !siteId || !choices?.capabilities.canReadSiteActivity} onPress={()=>void read()}>{copy("Load authorized site activity")}</TogglePillButton>
    {result && <>
      <Text style={text}>{result.siteName} · {result.window.startsAt} → {result.window.endsAt}</Text>
      <Text style={text}>{copy("Selected dates use run creation time; totals come from the recorded events of those runs.")}</Text>
      {result.records.length===0 && <Text style={text}>{copy("No authorized recorded Fleet activity was returned for this site and window.")}</Text>}
      {result.records.map(record=><View key={record.runId} style={{gap:8,borderWidth:1,borderColor:colors.border,padding:12}}>
        <Text style={text}>{record.vendorName} · {copy(record.status)}</Text>
        {record.stops.map(stop=><View key={stop.stopId}><Text style={text}>{copy(stop.kind)}</Text>{stop.events.map((event,index)=><Text key={index} style={text}>{copy(event.type)} · {copy(event.source)} · {copy("captured")} {event.capturedAt??copy("not separately supplied")} · {copy("accepted")} {event.recordedAt}</Text>)}</View>)}
        {record.loads.map(load=><Text key={load.loadId} style={text}>{load.commodity}: {load.quantity} {load.unit} · {copy(load.direction)} · {load.delivered?copy("Delivery recorded"):copy("Delivery not recorded")}</Text>)}
      </View>)}
      {result.unavailableMetrics.map(metric=><Text key={metric} style={text}>{copy(metric)}: {copy("unavailable")}</Text>)}
    </>}
  </ScrollView></ScreenSafeArea>;
}
