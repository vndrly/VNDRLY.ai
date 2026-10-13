import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useAuth} from "@/hooks/use-auth";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import BrandPillButton from "@/components/brand-pill-button";

type Mode="batch"|"singles"|null;
type SitePolicy={version:number;mode:Mode;canManage:boolean};
const labels={default:"Vendor default",batch:"Batch",singles:"Singles"};
export default function FleetSiteTicketPolicy({siteId}:{siteId:number}){
 const {user}=useAuth();const cache=useQueryClient();
 const [draft,setDraft]=useState<{scope:string;mode:Mode}|null>(null);
 const [saving,setSaving]=useState(false);const [message,setMessage]=useState("");
 const queryKey=["fleet-site-ticket-policy",siteId,user?.userId,user?.activeMembershipId];
 const scope=JSON.stringify(queryKey);
 const base=(import.meta.env.BASE_URL||"/").replace(/\/$/,"");
 const url=`${base}/api/fleet/site-ticket-policy/${siteId}`;
 const query=useQuery<SitePolicy>({queryKey,enabled:!!user&&siteId>0,queryFn:async()=>{const response=await fetch(url,{credentials:"include"});if(!response.ok)throw new Error("Unable to load Fleet ticket requirement.");return response.json();}});
 const policy=query.data;const mode=draft?.scope===scope?draft.mode:policy?.mode??null;
 const dirty=!!policy&&mode!==policy.mode;
 async function save(){
  if(!policy?.canManage||!dirty||saving)return;
  setSaving(true);setMessage("");
  try{
   const response=await fetch(url,{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedVersion:policy.version,mode})});
   if(response.status===409){setMessage("This requirement changed. Your selection is preserved; review the latest requirement before saving again.");await query.refetch();return;}
   if(!response.ok)throw new Error("Unable to save Fleet ticket requirement.");
   const saved:SitePolicy=await response.json();cache.setQueryData(queryKey,saved);setDraft(null);setMessage("Fleet ticket requirement saved.");
  }catch(error){setMessage(error instanceof Error?error.message:"Unable to save Fleet ticket requirement.");}finally{setSaving(false);}
 }
 if(!user)return null;
 return <Card><CardHeader><CardTitle>Fleet ticket requirement</CardTitle></CardHeader><CardContent className="space-y-3">
  <p className="text-sm text-muted-foreground">The site requirement overrides the vendor default for future ticket plans. Existing ticket plans keep their approved settings.</p>
  {query.isPending?<p role="status">Loading Fleet ticket requirement…</p>:query.isError?<p role="alert">Unable to load Fleet ticket requirement.</p>:policy&&<>
   <p className="text-sm">Current requirement: <strong>{labels[policy.mode??"default"]}</strong></p>
   {policy.canManage&&<div className="flex flex-wrap items-center gap-3">
    <label className="flex items-center gap-2 text-sm">Requirement<select aria-label="Fleet ticket requirement" className="rounded-md border bg-background px-3 py-2" value={mode??"default"} disabled={saving} onChange={event=>{setDraft({scope,mode:event.target.value==="default"?null:event.target.value as Exclude<Mode,null>});setMessage("");}}>
     <option value="default">Vendor default</option><option value="batch">Batch</option><option value="singles">Singles</option>
    </select></label>
    <BrandPillButton tone="blue" disabled={!dirty||saving} attention={dirty} onClick={save}>{saving?"Saving…":"Save requirement"}</BrandPillButton>
   </div>}
  </>}
  {message&&<p role="status" className="text-sm">{message}</p>}
 </CardContent></Card>;
}
