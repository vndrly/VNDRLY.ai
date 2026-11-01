import React,{useState} from 'react';
import {z} from 'zod/v4';
import {AssignedLibraryReadSchema} from '@workspace/api-zod';
import TogglePillButton from '@/components/brand-pill-button';
type Data=z.infer<typeof AssignedLibraryReadSchema>;
export default function CertificationExam({data,busy,uncertain,send}:{data:Data;busy:boolean;uncertain:boolean;send:(payload:unknown)=>Promise<unknown>}){
 const exam=data.certificationExam,[notice,setNotice]=useState('');
 if(!exam)return null;
 const attempt=exam.attempt,locked=busy||uncertain,complete=data.assignment.status==='completed';
 const act=async(payload:unknown)=>{try{setNotice('');await send(payload);}catch(e){setNotice(e instanceof Error?e.message:'Exam unavailable');}};
 return <section className="space-y-4 rounded-xl border-2 p-5" aria-label="Certification exam">
 <h3 className="text-lg font-bold">Separate certification exam</h3>
 <p>{exam.questionCount} questions · Passing score {exam.passingPercent}%.</p>
 <p>Passing records your VNDRLY Energy Safety Core credential.</p>
 {!complete?<p>Complete every learning section before starting the exam.</p>:!attempt||attempt.submittedAt?<>
 {attempt&&<div role="status"><p>Attempt {data.assignment.progress.certificationExam?.attempts.length}: {attempt.correctCount}/{attempt.questionIds.length} ({attempt.score?.toFixed(1)}%) — {attempt.passed?'Passed: VNDRLY Energy Safety Core credential':'Not passed'}</p></div>}
 {!attempt?.passed&&(data.assignment.progress.certificationExam?.attempts.length??0)<exam.maximumAttempts&&<TogglePillButton tone="brand" disabled={locked} onClick={()=>void act({action:'exam_start'})}>{attempt?'Retake certification exam':'Start certification exam'}</TogglePillButton>}
 {attempt?.submittedAt&&<details><summary>Review submitted exam</summary>{exam.questions.map(q=><div key={q.id} className="border-t py-3"><p>{q.prompt}</p><p>Your answer: {q.options.filter(o=>attempt.answers[q.id]?.includes(o.id)).map(o=>o.label).join(', ')}</p><p>Correct answer: {q.options.filter(o=>exam.review.find(r=>r.questionId===q.id)?.correctOptionIds.includes(o.id)).map(o=>o.label).join(', ')}</p><p>{exam.review.find(r=>r.questionId===q.id)?.explanation}</p></div>)}</details>}
 </>:<>
 <p>Attempt in progress. Answers save individually; results appear only after explicit submission. Answered {Object.keys(attempt.answers).length}/{exam.questions.length}.</p>
 {exam.questions.map((q,index)=><fieldset key={q.id} className="border-t py-3 space-y-2"><legend className="font-semibold">{index+1}. {q.prompt}</legend>{q.options.map(o=><label className="flex gap-2" key={o.id}><input type={q.multiple?'checkbox':'radio'} name={q.id} disabled={locked} checked={attempt.answers[q.id]?.includes(o.id)??false} onChange={()=>{const old=attempt.answers[q.id]??[];const ids=q.multiple?(old.includes(o.id)?old.filter(id=>id!==o.id):[...old,o.id]):[o.id];if(ids.length)void act({action:'exam_answer',attemptId:attempt.id,questionId:q.id,optionIds:ids});}}/>{o.label}</label>)}</fieldset>)}
 <TogglePillButton tone="brand" disabled={locked||exam.questions.some(q=>!attempt.answers[q.id]?.length)} onClick={()=>void act({action:'exam_submit',attemptId:attempt.id})}>Submit certification exam</TogglePillButton>
 </>}
 {!!data.assignment.progress.certificationExam?.attempts.length&&<details><summary>Exam attempt history</summary>{data.assignment.progress.certificationExam.attempts.map((a,i)=><p key={a.id}>Attempt {i+1} · {a.submittedAt?`${a.score?.toFixed(1)}% · ${a.passed?'Passed':'Not passed'}`:'In progress'}</p>)}</details>}
 {notice&&<p role="alert">{notice}</p>}
 </section>;
}
