import { CardHeading } from "@/components/ui/card-heading";
import React,{useState} from "react";
import type {FleetRun,FleetWorkSession,FleetWorkEvidencePageSchema} from "@workspace/api-zod";
import type {z} from "zod/v4";
import {PngPillButton} from "@/components/png-pill-rollover";
export function FleetRetainedEvidence({session,run,onChanged}:{session:FleetWorkSession;run:FleetRun;onChanged:()=>void}){
 const [file,setFile]=useState<File|null>(null),[notes,setNotes]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[kind,setKind]=useState<"photo"|"scale"|"receipt"|"signature">("photo"),[page,setPage]=useState<z.infer<typeof FleetWorkEvidencePageSchema>|null>(null);
 async function capture(){if(!file||busy||run.driverUserId!==session.scope.userId)return;setBusy(true);try{await session.captureEvidence(run,file,file.type,kind,notes);setFile(null);setNotes("");setMessage("Saved on this device — photo pending sync. Original bytes are retained until canonical association is verified.");onChanged();}catch(error){setMessage(error instanceof Error?error.message:"Photo was not durably saved");}finally{setBusy(false);}}
 async function read(cursor:string|null=null){setBusy(true);try{const result=await session.evidencePage(run.id,cursor);setPage(prior=>cursor&&prior?{...result,evidence:[...prior.evidence,...result.evidence]}:result);}catch(error){setMessage(error instanceof Error?error.message:"Saved evidence is unavailable");}finally{setBusy(false);}}
 return <section className="fleet-detail-group space-y-2"><CardHeading as="h3">Fleet evidence</CardHeading><p>Capture while safely stopped. Photos remain separate from driver inspection decisions and do not verify physical delivery or signature identity.</p>
  {run.driverUserId===session.scope.userId&&<><label>Evidence kind<select disabled={busy} value={kind} onChange={event=>setKind(event.target.value as typeof kind)}>{["photo","scale","receipt","signature"].map(value=><option key={value}>{value}</option>)}</select></label>
  <label>Evidence notes<textarea maxLength={2000} disabled={busy} value={notes} onChange={event=>setNotes(event.target.value)}/></label><input aria-label="Retain Fleet evidence file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={event=>setFile(event.target.files?.[0]??null)}/>
  <PngPillButton disabled={busy||!file} onClick={()=>void capture()}>Save photo on this device</PngPillButton></>}
  {!!message&&<p role="status">{message}</p>}<PngPillButton disabled={busy} onClick={()=>void read()}>Read saved Fleet evidence</PngPillButton>
  {page?.evidence.map(value=><article key={value.record.evidenceId}><p>{value.record.kind} · {value.record.size} bytes · {value.record.recordedAt}</p><p>{value.record.notes}</p><p>SHA256: {value.record.sha256}</p><a href={`/api/fleet/runs/${run.id}/evidence/${value.record.evidenceId}/file`} target="_blank" rel="noopener noreferrer">View authorized saved file</a></article>)}
  {page?.nextCursor&&<PngPillButton disabled={busy} onClick={()=>void read(page.nextCursor)}>Load more saved evidence</PngPillButton>}
 </section>;
}
