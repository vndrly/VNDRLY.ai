import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { PngPillButton } from "@/components/png-pill-rollover";
import { commandEnvelope, workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";

type MyShift={id:string;version:number;title:string;siteName:string;startsAt:string;endsAt:string;timezone:string;requested:boolean;requestStatus?:string|null};
/** Personal shifts live inside the selected-day view, not a separate card. */
export function RequestShiftCoverage({owner,day,userId}:{owner:WorkHubOwner;day:string;userId?:number}) {
  const [selected,setSelected]=useState<MyShift|null>(null),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  const [attempt,setAttempt]=useState<ReturnType<typeof commandEnvelope>|null>(null);
  const query=useQuery({queryKey:['my-shift-coverage',userId,owner.type,owner.id,day],retry:false,refetchInterval:15000,
    queryFn:()=>workHubRequest<{shifts:MyShift[];readOnly:boolean}>(`/site-shift-plans/my-coverage?from=${day}&through=${day}`)});
  async function submit(){
    if(!selected||saving||query.data?.readOnly)return;
    setSaving(true);
    const envelope=attempt??commandEnvelope(owner,{shiftId:selected.id,expectedVersion:selected.version});setAttempt(envelope);
    try{
      await workHubRequest('/site-shift-plans/request-coverage',{method:'POST',body:JSON.stringify(envelope)});
      setSelected(null);setAttempt(null);setMessage('Shift off requested — awaiting approval.');await query.refetch();
    }catch{setMessage('Request not confirmed. Retry the same request.');}finally{setSaving(false);}
  }
  if(query.isPending)return <p>Loading your shift…</p>;
  if(query.isError)return <p role="alert">Your shift could not load. <button onClick={()=>void query.refetch()}>Retry</button></p>;
  return <>
    {!query.data.shifts.length&&<p>No shift today</p>}
    {query.data.shifts.map(s=><details className="hub-calendar-day-panel" key={s.id}>
      <summary><Clock3 aria-hidden="true"/><span>{s.title}</span></summary>
      <div className="hub-calendar-day-list">
        <p>{new Date(s.startsAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',timeZone:s.timezone})}–{new Date(s.endsAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',timeZone:s.timezone})} · {s.timezone}</p>
        {s.requested?<p>{s.requestStatus==='approved'?'Shift off approved — awaiting replacement':'Shift off requested — awaiting approval'}</p>:<>
          {s.requestStatus==='declined'&&<p>Your previous request was declined.</p>}
          {Date.parse(s.startsAt)>Date.now()&&<PngPillButton color="brand" disabled={saving||Boolean(attempt)||query.data.readOnly} onClick={()=>{setSelected(s);setMessage('');}}>Request shift off</PngPillButton>}
        </>}
        {selected?.id===s.id&&<section aria-label="Request shift off dialog">
          <p>Request this shift off? You remain assigned until a replacement is assigned.</p>
          <PngPillButton color="brand" disabled={saving||Boolean(attempt)} onClick={()=>setSelected(null)}>Cancel</PngPillButton>
          <PngPillButton color="brand" disabled={saving||query.data.readOnly} onClick={()=>void submit()}>{attempt?'Retry request':'Submit request'}</PngPillButton>
        </section>}
      </div>
    </details>)}
    {message&&<p role="status">{message}</p>}
  </>;
}
