import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PngPillButton } from "@/components/png-pill-rollover";
import { workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";

export function CoverageAcknowledgments({owner,userId}:{owner:WorkHubOwner;userId:number}) {
  const qc=useQueryClient();
  const [saving,setSaving]=useState<number|null>(null),[error,setError]=useState("");
  const query=useQuery({queryKey:["coverage-acknowledgments",owner.type,owner.id,userId],
    retry:false,refetchInterval:15000,
    queryFn:()=>workHubRequest<{notices:{id:number;title:string;startsAt:string;timezone:string}[];readOnly:boolean}>("/site-shift-plans/my-coverage-acknowledgments")});
  async function acknowledge(id:number) {
    if(saving || query.data?.readOnly) return;
    setSaving(id);setError("");
    try {
      await workHubRequest("/site-shift-plans/acknowledge-coverage",{method:"POST",body:JSON.stringify({notificationId:id})});
      await query.refetch();
      void qc.invalidateQueries({queryKey:["coverage-board"]});
    } catch {setError("Acknowledgment not confirmed. Retry; the assignment may have changed.");}
    finally {setSaving(null);}
  }
  if(query.isError) return <p role="alert">Coverage acknowledgments could not load. <button onClick={()=>void query.refetch()}>Retry</button></p>;
  if(!query.data?.notices.length) return null;
  return <section className="hub-shift-panel" aria-label="Coverage awaiting your acknowledgment">
    <h3>Coverage awaiting your acknowledgment</h3>
    {query.data.notices.map(n=><div key={n.id} className="hub-gap-assignment-row">
      <span>{n.title} · {new Date(n.startsAt).toLocaleString(undefined,{timeZone:n.timezone})} ({n.timezone})</span>
      <PngPillButton color="brand" disabled={saving!==null||query.data.readOnly} onClick={()=>void acknowledge(n.id)}>{saving===n.id?'Acknowledging…':'Acknowledge Shift'}</PngPillButton>
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
