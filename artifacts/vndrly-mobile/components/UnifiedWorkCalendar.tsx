import React,{useState} from "react";
import {ActivityIndicator,Pressable,Text,View} from "react-native";
import {useRouter} from "expo-router";
import {useTranslation} from "react-i18next";
import TogglePillButton from "./TogglePillButton";
import SphereBackButton from "./SphereBackButton";
import ForemanScheduleTicketsModal from "./ForemanScheduleTicketsModal";
import ShiftScheduling from "./ShiftScheduling";
import MeetingScheduling from "./MeetingScheduling";
import {useColors} from "@/hooks/useColors";
import {useAuth} from "@/hooks/use-auth";
import {apiFetch} from "@/lib/api";
import {calendarDayItems,calendarMonthRange,type UnifiedCalendarItem} from "@/lib/unified-work-calendar";
import {useUnifiedWorkCalendar} from "@/lib/use-unified-work-calendar";
export {useUnifiedWorkCalendar} from "@/lib/use-unified-work-calendar";
function recordTime(value:string,timezone:string|null){try{return new Date(value).toLocaleString([],timezone?{timeZone:timezone}:undefined);}catch{return new Date(value).toLocaleString();}}

export default function UnifiedWorkCalendar({initialDate=new Date()}:{initialDate?:Date}){
 const {user,activeMembershipId}=useAuth();return <Calendar key={`${user?.id}:${activeMembershipId}`} initialDate={initialDate}/>;
}
function Calendar({initialDate}:{initialDate:Date}){
 const colors=useColors(),router=useRouter(),{user}=useAuth();
 const {i18n}=useTranslation(),es=(i18n.language??"en").startsWith("es");
 const [day,setDay]=useState(initialDate),[menu,setMenu]=useState(false),[form,setForm]=useState<"field"|"shift"|"meeting"|null>(null),[opened,setOpened]=useState<{title:string;status?:string;startsAt?:string;endsAt?:string}|null>(null),[notice,setNotice]=useState("");
 const range=calendarMonthRange(day),query=useUnifiedWorkCalendar(range),items=query.data?.items??[],cap=query.data?.capabilities;
 const first=new Date(range.start),cells=Array.from({length:42},(_,index)=>{const date=new Date(first);date.setDate(date.getDate()+index);return date;});
 const selected=calendarDayItems(items,day),key=(date:Date)=>`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
 const text={color:colors.foreground},muted={color:colors.mutedForeground,fontSize:12};
 const saved=async()=>{await query.refetch();setForm(null);};
 async function open(item:UnifiedCalendarItem){setOpened(null);setNotice("");if(item.route){router.push(item.route as never);return;}try{const value=await apiFetch<{item:{title:string;status?:string;startsAt?:string;endsAt?:string}}>(item.readPath);setOpened({title:value.item.title,status:value.item.status,startsAt:value.item.startsAt,endsAt:value.item.endsAt});}catch{setNotice("This scheduled record is no longer available in your current company.");}}
 const canSchedule=cap&&Object.values(cap).some(Boolean);
 return <View style={{borderWidth:2,borderColor:colors.primary,borderRadius:16,padding:14,gap:12,backgroundColor:colors.card}}>
  <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}><Text style={{...text,fontFamily:"Inter_700Bold",fontWeight:"700",fontSize:20}}>Work calendar</Text>{canSchedule&&<TogglePillButton compactOnTablet accessibilityState={{expanded:menu}} onPress={()=>setMenu(!menu)}>Schedule</TogglePillButton>}</View>
  <Text style={muted}>Daily company work across shifts, meetings, field tickets, and Fleet runs. Scheduling reserves planned time; it does not start work.</Text>
  {menu&&<View style={{gap:8}}>{cap?.fieldTicket&&<TogglePillButton compactOnTablet onPress={()=>{setForm("field");setMenu(false);}}>Field ticket</TogglePillButton>}{cap?.fleetRun&&<TogglePillButton compactOnTablet onPress={()=>{setMenu(false);router.push("/fleet" as never);}}>Fleet run</TogglePillButton>}{cap?.shift&&<TogglePillButton compactOnTablet onPress={()=>{setForm("shift");setMenu(false);}}>Gate / other shift</TogglePillButton>}{cap?.meeting&&<TogglePillButton compactOnTablet onPress={()=>{setForm("meeting");setMenu(false);}}>Meeting</TogglePillButton>}</View>}
  {form&&form!=="field"&&<View style={{gap:10}}><TogglePillButton compactOnTablet onPress={()=>setForm(null)}>Close scheduling</TogglePillButton>{form==="shift"?<ShiftScheduling onSaved={saved}/>:<MeetingScheduling onSaved={saved}/>}</View>}
  {form==="field"&&user?.vendorId&&<ForemanScheduleTicketsModal visible vendorId={user.vendorId} onClose={()=>setForm(null)} onScheduled={()=>void saved()}/>}
  <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8}}><SphereBackButton accessibilityLabel="Previous month" onPress={()=>setDay(new Date(day.getFullYear(),day.getMonth()-1,1))}/><Text style={{...text,fontFamily:"Inter_700Bold",fontWeight:"700",fontSize:20}}>{day.toLocaleDateString([],{month:"long",year:"numeric"})}</Text><SphereBackButton direction="right" accessibilityLabel="Next month" onPress={()=>setDay(new Date(day.getFullYear(),day.getMonth()+1,1))}/></View>
  <TogglePillButton compactOnTablet onPress={()=>setDay(new Date())}>{es?"Hoy":"Today"}</TogglePillButton>
  <View style={{flexDirection:"row"}}>{(es?["dom","lun","mar","mié","jue","vie","sáb"]:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]).map(label=><Text key={label} style={{...muted,width:"14.285%",textAlign:"center",fontWeight:"700"}}>{label}</Text>)}</View>
  <View style={{flexDirection:"row",flexWrap:"wrap"}}>{cells.map(date=>{const count=calendarDayItems(items,date).length;return <Pressable key={key(date)} accessibilityRole="button" accessibilityLabel={`${date.toLocaleDateString([],{month:"long",day:"numeric"})}, ${count} scheduled records`} accessibilityState={{selected:key(date)===key(day)}} onPress={()=>setDay(date)} style={{width:"14.285%",minHeight:54,borderWidth:2,borderColor:key(date)===key(day)?colors.primary:colors.border,padding:5,borderRadius:8}}><Text style={{...text,opacity:date.getMonth()===day.getMonth()?1:.5}}>{date.getDate()}</Text><Text style={{color:colors.primary,fontWeight:"700"}}>{count?`${count} •`:""}</Text></Pressable>;})}</View>
  <Text style={{...text,fontWeight:"700"}}>{day.toLocaleDateString([],{weekday:"long",month:"long",day:"numeric"})} · {selected.length} scheduled records</Text>
  <Text style={muted}>Calendar days use your device timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Original schedule timezones appear on records.</Text>
  {query.isPending?<ActivityIndicator color={colors.primary}/>:query.isError?<Text accessibilityRole="alert" style={muted}>The work calendar could not load.</Text>:<>{!!query.data?.unavailable.length&&<Text accessibilityRole="alert" style={muted}>Some schedules could not load: {query.data.unavailable.join(", ")}. Counts reflect available records.</Text>}{!selected.length&&<Text style={muted}>No scheduled records for this day.</Text>}{selected.map(item=><Pressable key={item.id} accessibilityRole="button" onPress={()=>void open(item)} style={{borderWidth:2,borderColor:colors.primary,borderRadius:12,padding:12,gap:4}}><Text style={{...text,fontWeight:"700"}}>{item.title}</Text><Text style={muted}>{item.kind.replaceAll("_"," ")} · {recordTime(item.startsAt,item.timezone)}{item.endsAt?` – ${recordTime(item.endsAt,item.timezone)}`:" · End time unspecified"}{item.timezone?` · ${item.timezone}`:""}</Text>{item.kind==="fleet_run"&&<><Text style={muted}>{item.timeBasis==="dispatch_recorded"?"Dispatch recorded · no planned time":"Planned run time"}</Text>{item.employeeName&&<Text style={text}>{item.employeeName}</Text>}{item.linkedTicketId&&<Text style={muted}>Ticket #{item.linkedTicketId}</Text>}</>}{item.status&&<Text style={muted}>{item.status.replaceAll("_"," ")}</Text>}<Text style={{color:colors.primary}}>Open scheduled record</Text></Pressable>)}</>}
  {!!notice&&<Text accessibilityRole="alert" style={muted}>{notice}</Text>}{opened&&<View style={{gap:4}}><Text style={{...text,fontWeight:"700"}}>{opened.title}</Text>{opened.startsAt&&<Text style={muted}>{new Date(opened.startsAt).toLocaleString()}</Text>}{opened.status&&<Text style={muted}>{opened.status}</Text>}<TogglePillButton compactOnTablet onPress={()=>setOpened(null)}>Close record</TogglePillButton></View>}
 </View>;
}
