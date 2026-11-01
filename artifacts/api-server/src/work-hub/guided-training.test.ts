import {describe,it,expect} from 'vitest';
import {TrainingDefinitionSchema} from '@workspace/api-zod';
import {guidedResult} from './guided-training';
const training=TrainingDefinitionSchema.parse({lessons:[{id:'intro',title:'Intro'},{id:'lesson',title:'Lesson'},{id:'finish',title:'Finish'}],questions:[{id:'q',prompt:'Choose safe',options:[{id:'a',label:'Safe'},{id:'b',label:'Unsafe'}],correctOptionIds:['a']}],guided:{steps:[{lessonId:'intro',questionIds:[]},{lessonId:'lesson',questionIds:['q']},{lessonId:'finish',questionIds:[]}],explanations:{q:'The safeguard must be verified.'}}});
const now='2026-11-01T12:00:00.000Z';
describe('H03 guided remediation',()=>{
 it('retains first answer, requires explicit acknowledgment, and completes with both scores',()=>{
  let r=guidedResult(training,undefined,{action:'advance',acknowledged:true},now);
  r=guidedResult(training,r.progress,{action:'answer',questionId:'q',optionIds:['b']},now);
  expect(r.progress.step).toBe(1);expect(r.feedback?.explanation).toContain('verified');
  expect(()=>guidedResult(training,r.progress,{action:'advance',acknowledged:true},now)).toThrow();
  expect(()=>guidedResult(training,r.progress,{action:'answer',questionId:'q',optionIds:['a']},now)).toThrow();
  const original=structuredClone(r.progress);
  expect(()=>guidedResult(training,r.progress,{action:'remediate',questionId:'q',acknowledged:false},now)).toThrow();
  r=guidedResult(training,r.progress,{action:'remediate',questionId:'q',acknowledged:true},now);
  expect(original.responses.q.originalOptionIds).toEqual(['b']);expect(r.progress.responses.q.originalOptionIds).toEqual(['b']);expect(r.progress.responses.q.correctedOptionIds).toEqual(['a']);expect(r.progress.step).toBe(2);
  r=guidedResult(training,r.progress,{action:'advance',acknowledged:true},now);
  expect(r.complete).toBe(true);expect(r.progress.scores).toMatchObject({originalPercent:0,remediatedPercent:100,remediationCount:1});
 });
 it('rejects skipped and foreign answers and preserves an all-correct score',()=>{
  expect(()=>guidedResult(training,undefined,{action:'answer',questionId:'q',optionIds:['a']},now)).toThrow();
  let r=guidedResult(training,undefined,{action:'advance',acknowledged:true},now);
  expect(()=>guidedResult(training,r.progress,{action:'answer',questionId:'q',optionIds:['foreign']},now)).toThrow();
  r=guidedResult(training,r.progress,{action:'answer',questionId:'q',optionIds:['a']},now);
  expect(r.progress.scores).toMatchObject({originalPercent:100,remediatedPercent:100,remediationCount:0});expect(r.progress.step).toBe(2);
 });
 it('rejects missing question coverage and explanation definitions',()=>{
  expect(TrainingDefinitionSchema.safeParse({...training,guided:{...training.guided,steps:[{lessonId:'intro',questionIds:[]}]}}).success).toBe(false);
 });
});
