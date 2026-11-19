import { formatTrainingTitle } from "@/lib/training-title";
import React, {useEffect,useState} from 'react';
import {z} from 'zod/v4';
import {AssignedLibraryReadSchema} from '@workspace/api-zod';
import {useTranslation} from 'react-i18next';
import {ProfileActionButton as TrainingActionButton} from '@/components/gate-profile-chrome';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import CertificationExam from './certification-exam';
import {LibraryBody} from './library-body';
import QualificationRequirements from './qualification-requirements';
import {VndrlyUWordmark} from '../vndrly-u-wordmark';
type Data=z.infer<typeof AssignedLibraryReadSchema>;
export default function GuidedTraining({data,busy,uncertain,send,retry}:{data:Data;busy:boolean;uncertain:boolean;send:(payload:unknown)=>Promise<unknown>;retry:()=>Promise<unknown>}) {
 const {t}=useTranslation();const training=data.metadata.content!.training!, guided=training.guided!, progress=data.assignment.progress.guided;
 const index=progress?.step??0,step=guided.steps[index],lesson=training.lessons.find(l=>l.id===step?.lessonId),responses=progress?.responses??{};
 const question=training.questions.find(q=>q.id===step?.questionIds.find(id=>{const r=responses[id];return !r||(!r.correct&&!r.remediatedAt)}));
 const [feedbackDismissed,setFeedbackDismissed]=useState(false);
 useEffect(()=>setFeedbackDismissed(false),[data.guidedFeedback?.questionId]);
 const [selected,setSelected]=useState<string[]>([]),[notice,setNotice]=useState('');
 useEffect(()=>{setSelected([]);setNotice('');},[question?.id,index]);
 const action=async(payload:unknown)=>{try{setNotice('');await send(payload);}catch(e){setNotice(e instanceof Error?e.message:t('workHubLibrary.unavailable'));}};
 const scores=progress?.scores,complete=data.assignment.status==='completed';
 return <section className="training-learner space-y-4" data-guided-training={data.metadata.safetyResource?.familyId??'course'}>
  <h2 className="text-xl font-bold">{formatTrainingTitle(data.title)}</h2>
  <QualificationRequirements items={data.qualificationRequirements}/>
  <p>{t(complete?'h03Course.completed':'h03Course.section',{current:Math.min(index+1,guided.steps.length),total:guided.steps.length})}</p>
  {scores&&<div className="training-learner-card space-y-2" data-testid="course-scores">
   <p>{t('h03Course.originalScore')}: {scores.originalCorrect}/{scores.total} ({scores.originalPercent.toFixed(1)}%)</p>
   <p>{t('h03Course.remediatedScore')}: {scores.remediatedCorrect}/{scores.total} ({scores.remediatedPercent.toFixed(1)}%)</p>
   <p>{t('h03Course.corrections')}: {scores.remediationCount}</p>
  </div>}
  {complete?<p>{t('h03Course.credit')}</p>:lesson&&<article className="training-learner-card space-y-4">
   <h3 className="font-bold text-lg"><VndrlyUWordmark /></h3><LibraryBody text={lesson.body} color="currentColor" />
   {!!lesson.links?.length&&<ul className="list-disc pl-5">{lesson.links.map((url,i)=><li key={url}><a className="underline" href={url} target="_blank" rel="noreferrer">{t('trainingPolicy.scopeSource',{number:i+1})}</a></li>)}</ul>}
   {question?<fieldset className="space-y-3 border-t pt-4"><legend className="font-semibold">{question.prompt}</legend>
    {question.options.map(option=><label key={option.id} className="flex gap-3 items-start"><input type={question.multiple?'checkbox':'radio'} name={question.id} disabled={busy||uncertain||!!responses[question.id]} checked={selected.includes(option.id)} onChange={()=>setSelected(question.multiple?(selected.includes(option.id)?selected.filter(x=>x!==option.id):[...selected,option.id]):[option.id])}/><span>{option.label}</span></label>)}
    <TrainingActionButton className="w-fit" disabled={busy||uncertain||!selected.length||!!responses[question.id]} onClick={()=>void action({action:'answer',questionId:question.id,optionIds:selected})}>{t('h03Course.submitAnswer')}</TrainingActionButton>
   </fieldset>:<TrainingActionButton className="w-fit" disabled={busy||uncertain} onClick={()=>void action({action:'advance',acknowledged:true})}>{t(index===guided.steps.length-1?'h03Course.finish':'h03Course.continue')}</TrainingActionButton>}
  </article>}
  {training.certificationExam&&<CertificationExam data={data} busy={busy} uncertain={uncertain} send={send}/>}
  {training.lessons.filter(l=>complete||!guided.steps.some(s=>s.lessonId===l.id)).map(l=><details key={l.id} className="training-learner-card">
   <summary aria-label={l.title} className="cursor-pointer font-semibold"><VndrlyUWordmark /></summary>
   <div className="pt-4"><LibraryBody text={l.body} color="currentColor"/></div>
  </details>)}
  {Object.entries(responses).length>0&&<details className="training-learner-card"><summary>{t('h03Course.answerRecord')}</summary>{Object.entries(responses).map(([id,r])=>{const q=training.questions.find(q=>q.id===id)!;return <div key={id} className="border-t py-3"><p>{q.prompt}</p><p>{t('h03Course.originalAnswer')}: {q.options.filter(o=>r.originalOptionIds.includes(o.id)).map(o=>o.label).join(', ')}</p><p>{t('h03Course.currentAnswer')}: {q.options.filter(o=>r.correctedOptionIds.includes(o.id)).map(o=>o.label).join(', ')}</p><p>{t(r.remediatedAt?'h03Course.corrected':r.correct?'h03Course.correct':'h03Course.needsCorrection')}</p></div>})}</details>}
  {!!notice&&<p role="alert">{notice}</p>}
  {uncertain&&<TrainingActionButton className="w-fit" disabled={busy} onClick={()=>void retry().catch(e=>setNotice(String(e)))}>{t('workHubLibrary.retry')}</TrainingActionButton>}
  {data.guidedFeedback && feedbackDismissed && <TrainingActionButton className="w-fit" onClick={()=>setFeedbackDismissed(false)}>{t("h03Course.reviewCorrection")}</TrainingActionButton>}
  <Dialog open={!!data.guidedFeedback && !feedbackDismissed} onOpenChange={open=>setFeedbackDismissed(!open)}><DialogContent onEscapeKeyDown={e=>e.preventDefault()} onPointerDownOutside={e=>e.preventDefault()}>
   <DialogHeader><DialogTitle>{t('h03Course.reviewCorrection')}</DialogTitle><DialogDescription>{t('h03Course.originalPreserved')}</DialogDescription></DialogHeader>
   {data.guidedFeedback&&<><p className="font-semibold">{t('h03Course.correctAnswer')}: {training.questions.find(q=>q.id===data.guidedFeedback!.questionId)?.options.filter(o=>data.guidedFeedback!.correctOptionIds.includes(o.id)).map(o=>o.label).join(', ')}</p><LibraryBody text={data.guidedFeedback.explanation} color="currentColor"/><TrainingActionButton className="w-fit" disabled={busy||uncertain} onClick={()=>void action({action:'remediate',questionId:data.guidedFeedback!.questionId,acknowledged:true})}>{t('h03Course.acknowledge')}</TrainingActionButton></>}
   {!!notice&&<p role="alert">{notice}</p>}
   {uncertain&&<TrainingActionButton className="w-fit" disabled={busy} onClick={()=>void retry().catch(e=>setNotice(String(e)))}>{t('workHubLibrary.retry')}</TrainingActionButton>}
  </DialogContent></Dialog>
 </section>;
}


