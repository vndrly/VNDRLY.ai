import React from 'react';
import {z} from 'zod/v4';
import {ProfileActionButton as TogglePillButton} from '@/components/gate-profile-chrome';
import {workHubRequest} from '@/lib/work-hub-client';
import {useLibrary} from './use-library';
import CourseContent from './course-content';
const schema=z.object({available:z.boolean(),assigned:z.boolean(),title:z.string().optional(),
 sessions:z.array(z.object({id:z.string(),title:z.string(),minutes:z.number(),objective:z.string(),instruction:z.string(),example:z.string().optional(),practice:z.object({prompt:z.string(),modelResponse:z.string().optional(),rationale:z.string().optional()}).optional(),checks:z.array(z.object({id:z.string(),prompt:z.string(),options:z.array(z.string()),feedback:z.string().optional(),answer:z.number().optional()}))})).optional(),
 progress:z.object({sessionId:z.string(),updatedAt:z.string(),reviewed:z.array(z.string()),practiceResponses:z.record(z.string(),z.array(z.object({text:z.string(),at:z.string()}))).optional(),responses:z.record(z.string(),z.object({attempts:z.array(z.object({option:z.number(),correct:z.boolean(),at:z.string()}))}))}).nullable().optional(),
});
export default function CatalogTrainingButton({id}:{id:string}){
 const api=useLibrary(`/api/work-hub/catalog/courses/${id}/instruction`,v=>schema.parse(v));
 const [open,setOpen]=React.useState(false),[busy,setBusy]=React.useState(false),[notice,setNotice]=React.useState('');
 const [practiceText,setPracticeText]=React.useState<Record<string,string>>({});
 const [choices,setChoices]=React.useState<Record<string,number>>({});
 const identity=React.useRef(`${api.contextKey}:${id}`);identity.current=`${api.contextKey}:${id}`;
 React.useEffect(()=>{setOpen(false);setChoices({});setPracticeText({});setBusy(false);setNotice('');},[id,api.contextKey]);
 const action=async(payload:unknown)=>{
  const scope=identity.current;setBusy(true);setNotice('');
  try{
   await workHubRequest(`/catalog/courses/${encodeURIComponent(id)}/instruction`,{method:'POST',body:JSON.stringify(payload)});
   if(scope!==identity.current)return;
   await api.reload();if(scope===identity.current)setOpen(true);
  }catch(error){if(scope===identity.current)setNotice(error instanceof Error?error.message:'Unable to save progress');}
  finally{if(scope===identity.current)setBusy(false);}
 };
 const data=api.data,sessions=data?.sessions??[],progress=data?.progress;
 const index=Math.max(0,sessions.findIndex(s=>s.id===progress?.sessionId)),session=sessions[index];
 return <section aria-label="Online training" className="space-y-3">
  {api.loading?<p role="status">Loading your training…</p>:api.error?<p role="alert">{String(api.error)}</p>:<>
   <TogglePillButton color="brand" disabled={busy||!data?.available||!data.assigned} onClick={()=>void action({action:'start'})}>{progress?'Continue Training':'Begin Training'}</TogglePillButton>
   {!data?.available?<p className="text-sm text-muted-foreground">Online instruction is being prepared for this course.</p>:!data.assigned?<p className="text-sm text-muted-foreground">Training becomes available when this course or its certification is assigned to you.</p>:null}
  </>}
  {open&&session&&<div className="space-y-4 border-t border-white/20 pt-4" aria-label="Current lesson">
   <header className="flex flex-wrap items-center justify-between gap-2"><p>Section {index+1} of {sessions.length} · About {session.minutes} minutes</p><TogglePillButton color="brand" disabled={busy} onClick={()=>setOpen(false)}>Exit training</TogglePillButton></header>
   <h2 className="text-lg font-bold">{session.title}</h2><p className="text-sm text-muted-foreground">{session.objective}</p>
   <CourseContent body={session.instruction} title={session.title}/>
   {session.example&&<div className="border-l-2 border-[var(--brand-primary)] pl-4"><h3 className="font-semibold">Worked example</h3><CourseContent body={session.example} title="Worked example"/></div>}
   {session.practice&&<section aria-label="Practice exercise" className="space-y-2 border-t border-white/20 pt-3"><h3 className="font-semibold">Practice exercise</h3><label className="block">{session.practice.prompt}<textarea aria-label="Your exercise response" className="mt-2 min-h-32 w-full rounded border border-white/30 bg-transparent p-3" value={practiceText[session.id]??progress?.practiceResponses?.[session.id]?.at(-1)?.text??''} disabled={busy} onChange={e=>setPracticeText(v=>({...v,[session.id]:e.target.value}))}/></label><TogglePillButton color="brand" disabled={busy||!(practiceText[session.id]??'').trim()} onClick={()=>void action({action:'practice',sessionId:session.id,text:practiceText[session.id]})}>Save exercise &amp; compare</TogglePillButton>{session.practice.modelResponse&&<div className="space-y-2"><h4 className="font-semibold">One possible response</h4><p>{session.practice.modelResponse}</p><p>{session.practice.rationale}</p><p className="text-sm text-muted-foreground">Your response is recorded as practice, not a graded practical qualification.</p></div>}</section>}
   {session.checks.map(question=>{
    const latest=progress?.responses[question.id]?.attempts.at(-1);
    return <fieldset key={question.id} className="space-y-2 border-t border-white/20 pt-3"><legend className="font-semibold">{question.prompt}</legend>
     {question.options.map((option,n)=><label key={n} className="flex items-start gap-3"><input type="radio" name={question.id} checked={(choices[question.id]??latest?.option)===n} disabled={busy} onChange={()=>setChoices(c=>({...c,[question.id]:n}))}/><span>{option}</span></label>)}
     <TogglePillButton color="brand" disabled={busy||choices[question.id]===undefined} onClick={()=>void action({action:'answer',sessionId:session.id,questionId:question.id,option:choices[question.id]})}>Check answer</TogglePillButton>
     {latest&&<div role="status" className="space-y-1"><p className="font-semibold">{latest.correct?'Correct':'Review the explanation'}</p><p>{question.feedback}</p>{question.answer!==undefined&&!latest.correct&&<p>Answer: {question.options[question.answer]}</p>}<p className="text-sm text-muted-foreground">Your original response and subsequent attempts are saved.</p></div>}
    </fieldset>;
   })}
   <div className="flex flex-wrap justify-between gap-2 border-t border-white/20 pt-3">
    <TogglePillButton color="brand" disabled={busy||index===0} onClick={()=>void action({action:'visit',sessionId:sessions[index-1].id})}>Previous section</TogglePillButton>
    <TogglePillButton color="brand" disabled={busy||!!progress?.reviewed.includes(session.id)} onClick={()=>void action({action:'review',sessionId:session.id})}>{progress?.reviewed.includes(session.id)?'Reviewed':'Mark reviewed'}</TogglePillButton>
    {index<sessions.length-1&&<TogglePillButton color="brand" disabled={busy} onClick={()=>void action({action:'visit',sessionId:sessions[index+1].id})}>Next section</TogglePillButton>}
   </div>
   {progress&&<p role="status" className="text-sm text-muted-foreground">{busy?'Saving…':`Saved ${new Date(progress.updatedAt).toLocaleString()}. You can leave and resume this section.`}</p>}
  </div>}
  {notice&&<p role="alert">{notice}</p>}
 </section>;
}
