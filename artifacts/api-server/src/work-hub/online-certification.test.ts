import {describe,it,expect} from 'vitest';
import {onlineExamAction,onlineExamRead,type OnlineExam} from './online-certification';
const exam:OnlineExam={programId:'VUC116',passingPercent:80,questions:Array.from({length:20},(_,i)=>({id:`q${i}`,domain:'Synthetic',prompt:`Decision ${i}`,options:['Correct','Incorrect'],correct:0,explanation:'Synthetic explanation'}))};
const now='2026-11-19T21:00:00Z';
function answered(correct:number){
 let progress=onlineExamAction(exam,null,{action:'start'},now);
 for(const [i,q] of exam.questions.entries())progress=onlineExamAction(exam,progress,{action:'answer',attemptId:progress.attempts[0].id,questionId:q.id,option:i<correct?0:1},now);
 return progress;
}
describe('approved Site Security assessment rules',()=>{
 it('awards at 16 of 20 and makes repeated submission idempotent',()=>{
  const saved=answered(16),action={action:'submit',attemptId:saved.attempts[0].id};
  const result=onlineExamAction(exam,saved,action,now);
  expect(result.attempts[0]).toMatchObject({score:80,passed:true});
  expect(result.credential?.programId).toBe('VUC116');
  expect(onlineExamAction(exam,result,action,'later')).toEqual(result);
  expect(saved.credential).toBeUndefined();
 });
 it('fails below 80 and allows self-paced retries preserving past attempts',()=>{
  const saved=answered(15);
  const failed=onlineExamAction(exam,saved,{action:'submit',attemptId:saved.attempts[0].id},now);
  expect(failed.attempts[0]).toMatchObject({score:75,passed:false});
  expect(failed.credential).toBeUndefined();
  const retry=onlineExamAction(exam,failed,{action:'start'},'later');
  expect(retry.attempts).toHaveLength(2);
  expect(retry.attempts[0]).toEqual(failed.attempts[0]);
  expect(retry.attempts[1].answers).toEqual({});
 });
 it('resumes saved answers and hides answer keys until submission',()=>{
  const saved=answered(20);
  expect(onlineExamAction(exam,saved,{action:'start'},'later')).toEqual(saved);
  for(const question of onlineExamRead(exam,saved).questions){
   expect(question).not.toHaveProperty('correct');expect(question).not.toHaveProperty('explanation');
  }
  const result=onlineExamAction(exam,saved,{action:'submit',attemptId:saved.attempts[0].id},now);
  expect(onlineExamRead(exam,result).questions[0]).toHaveProperty('explanation');
 });
 it('rejects missing answers, invalid options, and edits to submitted attempts',()=>{
  const started=onlineExamAction(exam,null,{action:'start'},now),attemptId=started.attempts[0].id;
  expect(()=>onlineExamAction(exam,started,{action:'submit',attemptId},now)).toThrow('Answer every question');
  expect(()=>onlineExamAction(exam,started,{action:'answer',attemptId,questionId:'q0',option:2},now)).toThrow('available answer');
  const saved=answered(20),id=saved.attempts[0].id;
  const submitted=onlineExamAction(exam,saved,{action:'submit',attemptId:id},now);
  expect(()=>onlineExamAction(exam,submitted,{action:'answer',attemptId:id,questionId:'q0',option:1},now)).toThrow('already submitted');
 });
});
