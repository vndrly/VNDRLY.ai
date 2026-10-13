import {useQuery} from "@tanstack/react-query";
import {useAuth} from "@/hooks/use-auth";
import {apiFetch} from "@/lib/api";
import {calendarMonthRange,normalizeUnifiedCalendar,type UnifiedCalendarSources} from "./unified-work-calendar";
async function fleetCalendar(){
 type Page=NonNullable<UnifiedCalendarSources["fleet"]>&{capabilities?:{canDispatch?:boolean};page?:{nextCursor?:string|null}};
 const first=await apiFetch<Page>("/api/fleet/overview"),runs=[...(first.runs??[])],seen=new Set<string>();let cursor=first.page?.nextCursor;
 while(cursor){if(seen.has(cursor))throw new Error("Fleet calendar pagination did not advance.");seen.add(cursor);const page=await apiFetch<Page>(`/api/fleet/overview?cursor=${encodeURIComponent(cursor)}`);runs.push(...(page.runs??[]));cursor=page.page?.nextCursor;}
 return{...first,runs};
}
export function useUnifiedWorkCalendar(range=calendarMonthRange(new Date())){
 const {user,activeMembershipId}=useAuth();
 return useQuery({queryKey:["unified-work-calendar",user?.id,activeMembershipId,user?.vendorId,user?.partnerId,range.start,range.end],enabled:!!user,queryFn:async()=>{
  let categoryUnavailable=false;const categoriesResult=user?.vendorId?await apiFetch<{categories:string[];canManage:boolean}>("/api/company-operations").catch(()=>{categoryUnavailable=true;return{categories:[],canManage:false};}):{categories:[],canManage:false};
  const categories=categoriesResult.categories??[];
  const jobs:[string,Promise<unknown>][]=[
   ["calendar",apiFetch(`/api/work-hub/calendar?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`)],
   ...(user?.vendorId&&categories.includes("field")?[["tickets",apiFetch(`/api/me/upcoming-schedule?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`)] as [string,Promise<unknown>]]:[]),
   ...(user?.vendorId&&categories.includes("fleet")?[["fleet",fleetCalendar()] as [string,Promise<unknown>]]:[]),
  ];
  const results=await Promise.allSettled(jobs.map(([,promise])=>promise)),sources:UnifiedCalendarSources={},unavailable:string[]=categoryUnavailable?["company categories"]:[];
  results.forEach((result,index)=>{const key=jobs[index][0] as keyof UnifiedCalendarSources;if(result.status==="fulfilled")(sources as Record<string,unknown>)[key]=result.value;else unavailable.push(key);});
  const membership=user?.availableMemberships?.find(item=>item.id===activeMembershipId),admin=categoriesResult.canManage||membership?.role==="admin"||user?.role==="admin";
  const fleet=sources.fleet as UnifiedCalendarSources["fleet"]&{capabilities?:{canDispatch?:boolean}};
  return{items:normalizeUnifiedCalendar(sources).filter(item=>Date.parse(item.startsAt)<Date.parse(range.end)&&(item.endsAt?Date.parse(item.endsAt)>Date.parse(range.start):Date.parse(item.startsAt)>=Date.parse(range.start))),categories,unavailable,capabilities:{fieldTicket:categories.includes("field")&&(admin||["foreman","both"].includes(user?.vendorRole??"")),fleetRun:categories.includes("fleet")&&fleet?.capabilities?.canDispatch===true,shift:admin||user?.vendorRole==="gate_supervisor",meeting:admin},range};
 }});
}
