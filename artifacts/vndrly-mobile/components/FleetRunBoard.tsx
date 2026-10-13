import React, { useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { FleetRun } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
export const fleetRunLane = (run: FleetRun) => run.status === "submitted_for_review" ? "Review" : run.status === "in_progress" ? "Working" : ["completed","cancelled"].includes(run.status) ? "Finished" : "Ready";
export default function FleetRunBoard({runs,onOpen,driverView=false,compact=false}:{compact?:boolean;runs:FleetRun[];onOpen:(run:FleetRun)=>void;driverView?:boolean}) {
 const colors=useColors(),copy=useFleetCopy(); const {width}=useWindowDimensions(); const [filter,setFilter]=useState<string|null>(null);
 const lanes=["Ready","Working","Review","Finished"];
 const card={backgroundColor:colors.card,borderColor:colors.primary,borderWidth:1,borderRadius:14,padding:14,gap:10};
 return <View style={{gap:14,flex:1,minWidth:0}}>
 <View style={{flexDirection:"row",flexWrap:"wrap",gap:10}}>{lanes.map(lane=><Pressable key={lane} accessibilityRole="button" accessibilityState={{selected:filter===lane}} accessibilityLabel={copy(lane)} onPress={()=>setFilter(filter===lane?null:lane)} style={{...card,flexGrow:1,minWidth:100,backgroundColor:filter===lane?colors.primary:colors.card}}><Text style={{fontSize:24,fontWeight:"700",color:filter===lane?"#ffffff":colors.foreground}}>{runs.filter(run=>fleetRunLane(run)===lane).length}</Text><Text style={{color:filter===lane?"#ffffff":colors.foreground}}>{copy(lane)}</Text></Pressable>)}</View>
 {runs.length===0?<View style={card}><Feather name="truck" size={28} color={colors.primary}/><Text style={{color:colors.foreground,fontSize:18,fontWeight:"700"}}>{copy(driverView?"No run assigned":"No runs yet")}</Text><Text style={{color:colors.mutedForeground}}>{copy(driverView?"Your next assignment will appear here.":"Create a run after setting up your fleet, drivers and equipment.")}</Text></View>:<View style={{flexDirection:width>=768&&!driverView&&!compact?"row":"column",gap:12}}>{lanes.filter(lane=>!filter?lane!=="Finished":lane===filter).map(lane=><View key={lane} style={{flex:1,minWidth:0,gap:10}}><Text style={{color:colors.foreground,fontWeight:"700"}}>{copy(lane)}</Text>{runs.filter(run=>fleetRunLane(run)===lane).map(run=><Pressable key={run.id} accessibilityRole="button" accessibilityLabel={run.title} onPress={()=>onOpen(run)} style={card}>
 <View style={{flexDirection:"row",justifyContent:"space-between",gap:8}}><Text style={{color:colors.foreground,fontSize:17,fontWeight:"700",flex:1}}>{run.title}</Text><Feather name="chevron-right" color={colors.primary} size={20}/></View>
 <Text style={{color:colors.mutedForeground}}>{run.stops.map(stop=>run.labels?.sites.find(site=>site.siteId===stop.siteId)?.name??copy("Site")+" "+stop.siteId).join(" → ")}</Text>
 <Text style={{color:colors.foreground}}>{run.labels?.driverName??copy("Assigned driver")} · {run.labels?.vehicleName??copy("Assigned vehicle")}</Text>
 <Text style={{color:colors.primary,fontWeight:"600"}}>{copy(run.phase?.replaceAll("_"," ")??run.status.replaceAll("_"," "))}</Text>
 <Text style={{color:colors.foreground}}>{copy(lane==="Review"?"Review run":"Open run")}</Text>
 </Pressable>)}{!runs.some(run=>fleetRunLane(run)===lane)&&<Text style={{color:colors.mutedForeground}}>{copy("No runs")}</Text>}</View>)}</View>}
 </View>;
}
