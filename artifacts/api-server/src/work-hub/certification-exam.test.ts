import {describe,it,expect} from 'vitest';
import {TrainingDefinitionSchema} from '@workspace/api-zod';
import {certificationExamRead,certificationExamResult} from './certification-exam';
import {publicTraining} from './library-policy';
const training=TrainingDefinitionSchema.parse({completionMode:'checkoff',lessons:[{id:'learn',title:'Learn'}],certificationExam:{questions:['a','b'].flatMap(domainId=>[1,2].map(i=>({id:`${domainId}${i}`,domainId,prompt:'Safe action?',options:[{id:'safe',label:'Stop'},{id:'unsafe',label:'Proceed'}],correctOptionIds:['safe'],explanation:'Stop and verify.'}))),questionCount:2,questionsPerDomain:1,passingPercent:80}});
const now='2026-11-01T12:00:00.000Z';
describe('separate internal certification exam',()=>{
 it('rejects malformed bank balance, duplicate IDs and insufficient bank size',()=>{
 const base=training.certificationExam!;
 for(const certificationExam of [{...base,questionCount:3},{...base,questionCount:20},{...base,questions:[base.questions[0],base.questions[0]]}])expect(TrainingDefinitionSchema.safeParse({...training,certificationExam}).success).toBe(false);
 });
 it('prevents overlapping attempts and enforces attempt limits after failure',()=>{
 const limited={...training,certificationExam:{...training.certificationExam!,maximumAttempts:1}};
 let p=certificationExamResult(limited,{}, {action:'exam_start'},true,now),attempt=p.attempts[0];
 expect(()=>certificationExamResult(limited,p,{action:'exam_start'},true,now)).toThrow('Resume');
 for(const questionId of attempt.questionIds)p=certificationExamResult(limited,p,{action:'exam_answer',attemptId:attempt.id,questionId,optionIds:['unsafe']},true,now);
 p=certificationExamResult(limited,p,{action:'exam_submit',attemptId:attempt.id},true,now);
 expect(()=>certificationExamResult(limited,p,{action:'exam_submit',attemptId:attempt.id},true,now)).toThrow('not active');
 expect(()=>certificationExamResult(limited,p,{action:'exam_start'},true,now)).toThrow('Maximum');
 });
 it('gates learning and hides bank keys and explanations',()=>{
 expect(()=>certificationExamResult(training,{}, {action:'exam_start'},false,now)).toThrow('Complete all learning');
 const safe=publicTraining(training);expect(safe.certificationExam).not.toHaveProperty('questions');
 const p=certificationExamResult(training,{}, {action:'exam_start'},true,now),view=certificationExamRead(training,p)!;
 expect(new Set(view.questions.map(q=>q.domainId)).size).toBe(2);expect(view.review).toEqual([]);expect(JSON.stringify(view)).not.toContain('correctOptionIds');expect(JSON.stringify(view)).not.toContain('Stop and verify');
 });
 it('passes only the configured standard and rejects any retake after pass',()=>{
 let p=certificationExamResult(training,{}, {action:'exam_start'},true,now);const first=structuredClone(p),attempt=p.attempts[0];
 for(const questionId of attempt.questionIds)p=certificationExamResult(training,p,{action:'exam_answer',attemptId:attempt.id,questionId,optionIds:['safe']},true,now);
 expect(first.attempts[0].answers).toEqual({});
 p=certificationExamResult(training,p,{action:'exam_submit',attemptId:attempt.id},true,now);
 expect(p.attempts[0]).toMatchObject({score:100,correctCount:2,passed:true});
 expect(()=>certificationExamResult(training,p,{action:'exam_start'},true,now)).toThrow('already passed');
 });
 it('requires all answers, rejects foreign IDs, locks submit, retains raw failure and permits fresh attempt',()=>{
 let p=certificationExamResult(training,{}, {action:'exam_start'},true,now);const id=p.attempts[0].id;
 expect(()=>certificationExamResult(training,p,{action:'exam_submit',attemptId:id},true,now)).toThrow('Answer every');
 expect(()=>certificationExamResult(training,p,{action:'exam_answer',attemptId:id,questionId:'foreign',optionIds:['safe']},true,now)).toThrow('permitted');
 expect(()=>certificationExamResult(training,p,{action:'exam_answer',attemptId:'00000000-0000-4000-8000-000000000000',questionId:p.attempts[0].questionIds[0],optionIds:['safe']},true,now)).toThrow('not active');
 for(const questionId of p.attempts[0].questionIds)p=certificationExamResult(training,p,{action:'exam_answer',attemptId:id,questionId,optionIds:['unsafe']},true,now);
 p=certificationExamResult(training,p,{action:'exam_submit',attemptId:id},true,now);expect(p.attempts[0]).toMatchObject({score:0,passed:false});
 expect(()=>certificationExamResult(training,p,{action:'exam_answer',attemptId:id,questionId:p.attempts[0].questionIds[0],optionIds:['safe']},true,now)).toThrow('not active');
 expect(certificationExamRead(training,p)?.review).toHaveLength(2);
 const next=certificationExamResult(training,p,{action:'exam_start'},true,now);expect(next.attempts).toHaveLength(2);expect(next.attempts[0].score).toBe(0);expect(next.attempts[1].id).not.toBe(id);expect(certificationExamRead(training,next)?.review).toEqual([]);
 });
});
