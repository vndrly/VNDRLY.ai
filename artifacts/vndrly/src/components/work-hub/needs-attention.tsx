import VoicemailPlayback from "./voicemail-playback";
import { useEffect, useRef, useState } from "react";
import { useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, CircleAlert, ChevronDown, CalendarDays, Mail, MessageSquare, PhoneMissed, Play, Hash, Vote, Trash2 } from "lucide-react";
import { workHubRequest } from "@/lib/work-hub-client";
import { useAuth } from "@/hooks/use-auth";
import { connectorRequest, useAccounts, useConnectorScope, type Account, type Message, type Selection } from "./connector-client";

type Row = Record<string, any>;
export type AttentionItem = {id:string;kind:"email"|"call"|"voicemail"|"meeting"|"conversation"|"poll"|"notification";title:string;reason:string;score:number;time:number;source:Row};
export function attentionItems(input:{calls?:Row[];voicemail?:Row[];meetings?:Row[];channels?:Row[];polls?:Row[];notifications?:Row[];emails?:{account:Account;items:Message[]}[]},now=Date.now()):AttentionItem[] {
 const result:AttentionItem[]=[];
 const recent=(date:string)=>Number.isFinite(Date.parse(date)) && now-Date.parse(date)<7*86400000 && Date.parse(date)<=now;
 const add=(kind:AttentionItem["kind"],row:Row,title:string,reason:string,score:number,date:string,id=String(row.id))=>result.push({id:`${kind}:${id}`,kind,title,reason,score,time:Date.parse(date)||0,source:row});
 for(const row of input.meetings||[]){const {meeting,occurrence}=row.item||{};if(!meeting||!occurrence||["cancelled","completed","ended"].includes(occurrence.status))continue;const minutes=Math.ceil((Date.parse(occurrence.startsAt)-now)/60000);if(minutes>=0&&minutes<=1440)add("meeting",{...occurrence,title:meeting.title},meeting.title,minutes<=60?`Starts in ${minutes} minutes`:`Starts in ${Math.ceil(minutes/60)} hours`,minutes<=120?100:50,occurrence.startsAt);}
 for(const row of input.voicemail||[])if(!row.readAt&&recent(row.createdAt))add("voicemail",row,row.senderName||"Voicemail","Unread voicemail",85,row.createdAt);
 for(const row of input.calls||[])if(row.incoming&&["missed","declined","busy","unavailable"].includes(row.status)&&recent(row.createdAt)&&!(input.calls||[]).some(call=>!call.incoming&&call.recipientUserId===row.callerUserId&&Date.parse(call.createdAt)>Date.parse(row.createdAt)))add("call",row,row.callerName||"Missed call","Missed call — no later callback in your call log",80,row.createdAt);
 for(const row of input.polls||[])if(row.instanceId&&!row.completed&&row.state?.status==="published"&&(!row.state.deadline||Date.parse(row.state.deadline)>now))add("poll",row,row.title,"Your response is still needed",row.state.deadline&&Date.parse(row.state.deadline)-now<86400000?75:45,row.state.deadline||row.createdAt,row.campaignId);
 for(const row of input.channels||[])if(Number(row.unreadCount)>0)add("conversation",row,row.name,`${row.unreadCount} unread message${row.unreadCount===1?"":"s"}`,60,row.lastMessageAt||row.updatedAt||row.createdAt);
 for(const row of input.notifications||[])if(!row.isRead&&recent(row.createdAt))add("notification",row,row.title,"Unread notification",40,row.createdAt);
 for(const group of input.emails||[])for(const row of group.items){
  // A suggestion based on summaries, never an instruction to execute email content.
  const automated=/no[._-]?reply|newsletter|notifications?@|updates?@/i.test(row.from);
  const asks=/\?|\b(please (reply|respond|confirm|review|approve)|can you|could you|awaiting your|need your|response required)\b/i.test(`${row.subject} ${row.text}`);
  if(row.unread&&!automated&&asks&&recent(row.date))add("email",{...row,account:group.account},row.subject||"Email",`May need a reply · ${row.from}`,70,row.date,`${group.account.id}:${row.id}`);
 }
 return [...new Map(result.map(item=>[item.id,item])).values()].sort((a,b)=>b.score-a.score||(a.kind==="meeting"&&b.kind==="meeting"?a.time-b.time:b.time-a.time)||a.id.localeCompare(b.id)).slice(0,10);
}
const icons={email:Mail,call:PhoneMissed,voicemail:Play,meeting:CalendarDays,conversation:MessageSquare,poll:Vote,notification:BellRing};
function AttentionVoicemail({item}:{item:AttentionItem}) {
 const audioRef=useRef<HTMLAudioElement|null>(null);
 return <div className="hub-attention-playback"><VoicemailPlayback audioRef={audioRef} src={`/api/work-hub/voicemail/${encodeURIComponent(item.source.id)}/audio`} label={`Voicemail from ${item.title}`} durationMs={item.source.durationMs ?? 0} onPlay={()=>{}} /></div>;
}
export function NeedsAttention({channels,polls,notifications,onOpen,onEmail,search=""}:{channels:Row[];polls:Row[];notifications:Row[];onOpen:(item:AttentionItem)=>void;onEmail:(selection:Selection)=>void;search?:string}){
 const scope=useConnectorScope();const {user}=useAuth();const accounts=useAccounts();
 const cache=useQueryClient();
 const removeVoicemail=useMutation({
  mutationFn:(id:string)=>workHubRequest(`/voicemail/${encodeURIComponent(id)}`,{method:"DELETE"}),
  onSuccess:async(_result,id)=>{
   cache.setQueryData<Row[]>(["comms-attention",scope,"voicemail"],rows=>rows?.filter(row=>row.id!==id));
   await Promise.all([cache.invalidateQueries({queryKey:["comms-attention",scope,"voicemail"]}),cache.invalidateQueries({queryKey:["work-hub","voicemail"]})]);
  },
 });
 const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
 const sources=useQueries({queries:["calls","voicemail","calendar"].map(source=>({queryKey:["comms-attention",scope,source],enabled:!!user,queryFn:()=>workHubRequest<any>(source==="calendar"?`/calendar?start=${new Date(Date.now()).toISOString()}&end=${new Date(Date.now()+86400000).toISOString()}&workerUserId=${user!.userId}`:`/${source}`),refetchInterval:60000,refetchIntervalInBackground:false,retry:false}))});
 const mailAccounts=(accounts.data?.accounts||[]).filter(account=>account.status==="connected"&&["gmail","outlook"].includes(account.provider));
 const emails=useQueries({queries:mailAccounts.map(account=>{const folder=account.provider==="gmail"?"INBOX":"inbox";return {queryKey:["comms-mail",scope,account.id,folder,undefined,"",50],queryFn:({signal}:{signal:AbortSignal})=>connectorRequest<{items:Message[]}>(`/accounts/${account.id}/messages?folder=${folder}&limit=50`,undefined,signal),staleTime:30000,refetchInterval:60000,refetchIntervalInBackground:false,retry:false};})});
 const items=attentionItems({calls:Array.isArray(sources[0].data)?sources[0].data:[],voicemail:Array.isArray(sources[1].data)?sources[1].data:[],meetings:sources[2].data?.meetings||[],channels,polls,notifications,emails:mailAccounts.map((account,index)=>({account,items:emails[index].data?.items||[]}))},now).filter(item=>`${item.title} ${item.reason}`.toLowerCase().includes(search.toLowerCase()));
 const pending=sources.some(source=>source.isPending)||emails.some(source=>source.isPending)||accounts.isPending;
 const failed=sources.some(source=>source.isError)||emails.some(source=>source.isError)||accounts.isError;
 return <details open aria-label="Needs attention" className="mt-4 hub-attention-section"><summary className="hub-attention-heading"><i className="hub-comms-icon-slot"><CircleAlert aria-hidden="true" className="size-4" style={{color:"var(--brand-primary)"}}/>{items.length > 0 && <b className="hub-comms-unread-badge" aria-label={`${items.length} items need attention`}>{items.length}</b>}</i>Needs attention<ChevronDown aria-hidden="true" className="hub-attention-chevron size-4" /></summary>
 {items.map(item=>{
  const isChannel=item.kind==="conversation" && (item.source.contextKind!=="chat" || String(item.source.contextId??"").startsWith("group:"));
  const Icon=isChannel?Hash:icons[item.kind];
  const open=()=>item.kind==="email"?onEmail({account:item.source.account,kind:"email",folder:{id:item.source.account.provider==="gmail"?"INBOX":"inbox",name:"Inbox"},message:item.source as Message}):onOpen(item);
  if(item.kind!=="voicemail") return <button key={item.id} type="button" className="hub-attention-row flex w-full items-start gap-2 border-b border-white/15 py-3 text-left" onClick={open}><Icon aria-hidden="true" className="size-4 shrink-0 mt-0.5" style={{color:"var(--brand-primary)"}}/><span className="min-w-0"><span className="block text-sm font-semibold">{item.title}</span><span className="block text-xs text-muted-foreground">{item.reason}</span></span></button>;
  return <div key={item.id} className="hub-attention-row flex w-full items-start gap-2 border-b border-white/15 py-3 text-left">
   <Icon aria-hidden="true" className="size-4 shrink-0 mt-2" style={{color:"var(--brand-primary)"}}/>
   <div className="min-w-0 flex-1">
    <div className="flex flex-wrap items-center gap-x-3">
     <button type="button" className="text-left text-sm font-semibold" onClick={open}>{item.title}</button>
     <AttentionVoicemail item={item}/>
     <button type="button" className="ml-auto inline-flex min-h-8 items-center gap-1.5 border-0 bg-transparent text-sm disabled:opacity-50" aria-label={`Delete voicemail from ${item.title}`} disabled={removeVoicemail.isPending} onClick={()=>removeVoicemail.mutate(String(item.source.id))}>Delete<Trash2 aria-hidden="true" className="size-3.5" style={{color:"var(--brand-primary)"}}/></button>
    </div>
    <div className="flex flex-wrap items-baseline gap-2 text-sm"><span className="text-xs text-muted-foreground">{Math.max(0,Math.round((item.source.durationMs ?? 0)/1000))} seconds</span><span>{item.source.transcript || "Transcript unavailable."}</span></div>
   </div>
  </div>;
 })}
 {removeVoicemail.isError&&<p role="alert" className="text-sm">Could not delete voicemail. Please try again.</p>}
 {!items.length&&<p className="text-sm text-muted-foreground">{pending?"Checking communications…":failed?"Available communications have no attention items.":"Nothing needs your attention right now."}</p>}
 {failed&&<p className="text-xs text-muted-foreground">Some sources could not refresh. Available items are shown.</p>}
 </details>;
}
