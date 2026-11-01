import {randomInt,randomUUID} from 'node:crypto';
import {CertificationExamProgressSchema,type TrainingDefinition} from '@workspace/api-zod';
import {z} from 'zod/v4';
const actionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('exam_start')}),
 z.object({action:z.literal('exam_answer'),attemptId:z.uuid(),questionId:z.string(),optionIds:z.array(z.string()).min(1).max(20)}),
 z.object({action:z.literal('exam_submit'),attemptId:z.uuid()}),
]);
function shuffle<T>(items:T[]):T[]{const result=[...items];for(let i=result.length-1;i>0;i--){const j=randomInt(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;}
export function certificationExamResult(training:TrainingDefinition,raw:unknown,input:unknown,learningComplete:boolean,now:string){
 const definition=training.certificationExam;if(!definition)throw Error('No certification exam configured');
 if(!learningComplete)throw Error('Complete all learning before starting the certification exam');
 const progress=structuredClone(CertificationExamProgressSchema.parse(raw??{})),action=actionSchema.parse(input),last=progress.attempts.at(-1);
 if(action.action==='exam_start'){
  if(last&&!last.submittedAt)throw Error('Resume the active exam');
  if(progress.attempts.some(a=>a.passed))throw Error('Certification exam already passed');
  if(progress.attempts.length>=definition.maximumAttempts)throw Error('Maximum exam attempts reached');
  const selected=definition.questionsPerDomain?[...new Set(definition.questions.map(q=>q.domainId))].flatMap(id=>shuffle(definition.questions.filter(q=>q.domainId===id)).slice(0,definition.questionsPerDomain)):shuffle(definition.questions).slice(0,definition.questionCount);
  progress.attempts.push({id:randomUUID(),startedAt:now,submittedAt:null,questionIds:shuffle(selected).map(q=>q.id),answers:{},score:null,correctCount:null,passed:null});
 }else{
  if(!last||last.id!==action.attemptId||last.submittedAt)throw Error('This exam attempt is not active');
  if(action.action==='exam_answer'){
   const q=definition.questions.find(q=>q.id===action.questionId&&last.questionIds.includes(q.id));
   if(!q||new Set(action.optionIds).size!==action.optionIds.length||(!q.multiple&&action.optionIds.length!==1)||action.optionIds.some(id=>!q.options.some(o=>o.id===id)))throw Error('Choose permitted exam answers');
   last.answers[q.id]=action.optionIds;
  }else{
   if(last.questionIds.some(id=>!last.answers[id]?.length))throw Error('Answer every exam question before submitting');
   last.correctCount=last.questionIds.filter(id=>{const q=definition.questions.find(q=>q.id===id)!;return q.correctOptionIds.length===last.answers[id].length&&q.correctOptionIds.every(option=>last.answers[id].includes(option));}).length;
   last.score=100*last.correctCount/last.questionIds.length;last.passed=last.score>=definition.passingPercent;last.submittedAt=now;
  }
 }
 return progress;
}
export function certificationExamRead(training:TrainingDefinition,raw:unknown){
 const d=training.certificationExam;if(!d)return null;
 const attempt=CertificationExamProgressSchema.parse(raw??{}).attempts.at(-1)??null;
 const questions=(attempt?.questionIds??[]).map(id=>d.questions.find(q=>q.id===id)).filter(q=>!!q);
 return {questionCount:d.questionCount,passingPercent:d.passingPercent,maximumAttempts:d.maximumAttempts,attempt,
  questions:questions.map(({correctOptionIds:_,explanation:__,...q})=>q),
  review:attempt?.submittedAt?questions.map(q=>({questionId:q.id,correctOptionIds:q.correctOptionIds,explanation:q.explanation})):[]};
}

