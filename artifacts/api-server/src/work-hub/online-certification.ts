import {randomUUID,randomInt} from 'node:crypto';
import {z} from 'zod/v4';
export type OnlineExam={programId:string;passingPercent:number;questions:{id:string;domain:string;prompt:string;options:string[];correct:number;explanation:string}[]};
type Attempt={id:string;startedAt:string;submittedAt:string|null;questionIds:string[];answers:Record<string,number>;score:number|null;passed:boolean|null};
export type OnlineCertificationProgress={attempts:Attempt[];credential?:{id:string;awardedAt:string;programId:string}};
const inputSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('start')}),
 z.object({action:z.literal('answer'),attemptId:z.uuid(),questionId:z.string(),option:z.number().int().nonnegative()}),
 z.object({action:z.literal('submit'),attemptId:z.uuid()}),
]);
export function onlineExamAction(exam:OnlineExam,saved:OnlineCertificationProgress|null,input:unknown,now:string){
 const action=inputSchema.parse(input),progress=structuredClone(saved??{attempts:[]});
 let attempt=progress.attempts.at(-1);
 if(action.action==='start'){
  if(progress.credential||attempt&&!attempt.submittedAt)return progress;
  const questionIds=exam.questions.map(q=>q.id);
  for(let i=questionIds.length-1;i>0;i--){const j=randomInt(i+1);[questionIds[i],questionIds[j]]=[questionIds[j],questionIds[i]];}
  progress.attempts.push({id:randomUUID(),startedAt:now,submittedAt:null,questionIds,answers:{},score:null,passed:null});
  return progress;
 }
 if(!attempt||attempt.id!==action.attemptId)throw Error('Examination attempt not found');
 if(attempt.submittedAt){if(action.action==='submit')return progress;throw Error('This attempt is already submitted');}
 if(action.action==='answer'){
  const q=exam.questions.find(q=>q.id===action.questionId&&attempt!.questionIds.includes(q.id));
  if(!q||action.option>=q.options.length)throw Error('Choose an available answer');
  attempt.answers[q.id]=action.option;
 }else{
  if(attempt.questionIds.some(id=>attempt!.answers[id]===undefined))throw Error('Answer every question before submitting');
  const count=exam.questions.filter(q=>attempt!.answers[q.id]===q.correct).length;
  attempt.score=100*count/exam.questions.length;attempt.passed=attempt.score>=exam.passingPercent;attempt.submittedAt=now;
  if(attempt.passed)progress.credential={id:randomUUID(),awardedAt:now,programId:exam.programId};
 }
 return progress;
}
export function onlineExamRead(exam:OnlineExam,progress:OnlineCertificationProgress|null){
 const attempt=progress?.attempts.at(-1)??null;
 return {passingPercent:exam.passingPercent,questionCount:exam.questions.length,attempt,credential:progress?.credential??null,
  questions:(attempt?.questionIds??[]).map(id=>{const {correct,explanation,...q}=exam.questions.find(q=>q.id===id)!;return {...q,...(attempt?.submittedAt?{correct,explanation}:{})};}),
  history:(progress?.attempts??[]).filter(a=>a.submittedAt).map(({answers:_,questionIds:__,...a})=>a),
 };
}
