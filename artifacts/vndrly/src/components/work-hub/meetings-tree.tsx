import { CalendarDays } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import { CommsUnreadIcon } from "./comms-unread-icon";
export type MeetingEntry = {item:{meeting:{title:string};occurrence:{id:string;startsAt:string;endsAt?:string|null;status?:string}}};
export function splitMeetings(rows:MeetingEntry[],now=Date.now()) {
 const past=(row:MeetingEntry)=>["ended","completed","cancelled"].includes(row.item.occurrence.status??"") || Date.parse(row.item.occurrence.endsAt || row.item.occurrence.startsAt)<now;
 const time=(row:MeetingEntry)=>Date.parse(row.item.occurrence.startsAt);
 return {upcoming:rows.filter(row=>!past(row)).sort((a,b)=>time(a)-time(b)),past:rows.filter(past).sort((a,b)=>time(b)-time(a))};
}
export function MeetingsTree({onOpen}:{onOpen:(id:string)=>void}) {
 const {user}=useAuth();
 const list=useQuery({queryKey:["comms-meeting-invitations",user?.userId,user?.activeMembershipId,user?.vendorId,user?.partnerId],enabled:!!user,
 queryFn:()=>workHubRequest<{meetings:MeetingEntry[]}>("/calendar?kind=meetings&start=1970-01-01T00:00:00.000Z&end=2100-01-01T00:00:00.000Z"),staleTime:30000,refetchInterval:60000});
 const groups=splitMeetings(list.data?.meetings??[]);
 return <details className="hub-conversation-category"><summary><CommsUnreadIcon label="meetings"><CalendarDays className="size-4" style={{color:"var(--brand-primary)"}} aria-hidden="true"/></CommsUnreadIcon>Meetings<span aria-label="Total invited meetings">{list.isPending?"…":list.data?.meetings?.length??0}</span></summary>
 {list.isError?<p role="alert">Could not load meetings. <button onClick={()=>void list.refetch()}>Retry</button></p>:list.isPending?<p className="text-xs text-muted-foreground">Loading meetings…</p>:(["upcoming","past"] as const).map(group=><section key={group} aria-label={group==="upcoming"?"Upcoming meetings":"Past invited meetings"} className="pb-3"><h4 className="py-2 text-xs font-semibold">{group==="upcoming"?"Upcoming":"Past meetings"}</h4>{groups[group].length?groups[group].map(({item:{meeting,occurrence}})=><button key={occurrence.id} type="button" className="hub-attention-row flex w-full items-center justify-between gap-3 border-b border-white/15 py-3 text-left text-sm" onClick={()=>onOpen(occurrence.id)}><span className="min-w-0"><strong className="block">{meeting.title}</strong>{group==="past"&&<span className="block text-xs text-muted-foreground">Open meeting and available transcript</span>}</span><time dateTime={occurrence.startsAt} className="shrink-0 text-xs text-muted-foreground">{new Date(occurrence.startsAt).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})}{occurrence.endsAt?` – ${new Date(occurrence.endsAt).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}`:""}</time></button>):<p className="text-xs text-muted-foreground">{group==="upcoming"?"No upcoming meetings.":"No past invited meetings."}</p>}</section>)}
 </details>;
}

