import React from 'react';
import {z} from 'zod/v4';
import {useLibrary} from './use-library';
import {workHubRequest} from '@/lib/work-hub-client';
import {ProfileActionButton} from '@/components/gate-profile-chrome';
const schema=z.object({available:z.boolean(),assigned:z.boolean(),passingPercent:z.number().optional(),questionCount:z.number().optional(),
 attempt:z.object({id:z.string(),submittedAt:z.string().nullable(),answers:z.record(z.string(),z.number()),score:z.number().nullable(),passed:z.boolean().nullable()}).nullable().optional(),
 credential:z.object({id:z.string(),awardedAt:z.string(),programId:z.string()}).nullable().optional(),
 questions:z.array(z.object({id:z.string(),prompt:z.string(),options:z.array(z.string()),correct:z.number().optional(),explanation:z.string().optional()})).default([]),
});
export default function OnlineCertificationExam({id}:{id:string}){
 const api=useLibrary(`/api/work-hub/catalog/programs/${id}/exam`,v=>schema.parse(v));
 const [busy,setBusy]=React.useState(false),[notice,setNotice]=React.useState(''),[open,setOpen]=React.useState(false);
 const scope=React.useRef(`${api.contextKey}:${id}`);scope.current=`${api.contextKey}:${id}`;
 React.useEffect(()=>{setOpen(false);setNotice('');setBusy(false);},[id,api.contextKey]);
 const act=async(payload:unknown)=>{const original=scope.current;setBusy(true);setNotice('');try{
  await workHubRequest(`/catalog/programs/${id}/exam`,{method:'POST',body:JSON.stringify(payload)});
  if(original!==scope.current)return;await api.reload();if(original===scope.current)setOpen(true);
 }catch(error){if(original===scope.current)setNotice(error instanceof Error?error.message:'Unable to save assessment');}finally{if(original===scope.current)setBusy(false);}};
 if(api.loading)return <p role="status">Loading assessment…</p>;
 if(api.error)return <p role="alert">{String(api.error)}</p>;
 const data=api.data;if(!data?.available)return null;
 const attempt=data.attempt;
 return <section aria-label="Certification assessment" className="space-y-3 border-t border-white/20 pt-4">
  <h3 className="font-semibold">Final assessment</h3><p>{data.questionCount} questions · {data.passingPercent}% to pass · Self-paced</p>
  {data.credential?<div role="status"><p className="font-semibold">VNDRLY/U Site Security earned</p><p>Issued {new Date(data.credential.awardedAt).toLocaleDateString()} · Record {data.credential.id}</p></div>:<ProfileActionButton disabled={busy||!data.assigned} onClick={()=>void act({action:'start'})}>{attempt&&!attempt.submittedAt?'Continue assessment':attempt?'Retake assessment':'Begin assessment'}</ProfileActionButton>}
  {!data.assigned&&<p className="text-sm text-muted-foreground">Available when this certification or all its courses are assigned to you.</p>}
  {attempt?.submittedAt&&<p role="status">Score: {attempt.score}% · {attempt.passed?'Passed':'Review the explanations and retry when ready.'}</p>}
  {attempt?.submittedAt&&!open&&<ProfileActionButton onClick={()=>setOpen(true)}>Review assessment</ProfileActionButton>}
  {open&&attempt&&<><div className="flex justify-end"><ProfileActionButton disabled={busy} onClick={()=>setOpen(false)}>Exit assessment</ProfileActionButton></div>
   {data.questions.map((question,i)=><fieldset key={question.id} className="space-y-2 border-t border-white/20 pt-3"><legend className="font-semibold">{i+1}. {question.prompt}</legend>{question.options.map((option,n)=><label key={n} className="flex gap-3"><input type="radio" name={question.id} checked={attempt.answers[question.id]===n} disabled={busy||!!attempt.submittedAt} onChange={()=>void act({action:'answer',attemptId:attempt.id,questionId:question.id,option:n})}/>{option}</label>)}{question.explanation&&<p className="text-sm">{question.explanation}</p>}</fieldset>)}
   {!attempt.submittedAt&&<><p className="text-sm text-muted-foreground">{Object.keys(attempt.answers).length} of {data.questionCount} answers saved. You can leave and continue later.</p><ProfileActionButton disabled={busy||data.questions.some(q=>attempt.answers[q.id]===undefined)} onClick={()=>void act({action:'submit',attemptId:attempt.id})}>Submit assessment</ProfileActionButton></>}
  </>}
  {notice&&<p role="alert">{notice}</p>}
 </section>;
}
