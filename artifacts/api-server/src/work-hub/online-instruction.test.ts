import {describe,it,expect} from 'vitest';
import {instructionAction,instructionRead,type InstructionCourse} from './online-instruction';
const course:InstructionCourse={id:'test',version:'v1',title:'Synthetic course',sessions:[
 {id:'one',title:'First',minutes:6,objective:'Identify a verified record',instruction:'Synthetic instruction',checks:[{id:'q1',prompt:'Which is verified?',options:['A guess','A confirmed record'],answer:1,feedback:'Confirmation supplies evidence; guessing does not.'}]},
 {id:'two',title:'Second',minutes:5,objective:'Report clearly',instruction:'Synthetic second section',checks:[]},
]};
describe('online instruction',()=>{
 it('resumes the saved section and retains original and corrected responses',()=>{
  const first=instructionAction(course,null,{action:'answer',sessionId:'one',questionId:'q1',option:0},'2026-11-19T21:00:00Z');
  expect(first.feedback?.correct).toBe(false);
  const corrected=instructionAction(course,first.progress,{action:'answer',sessionId:'one',questionId:'q1',option:1},'2026-11-19T21:01:00Z');
  const moved=instructionAction(course,corrected.progress,{action:'visit',sessionId:'two'},'2026-11-19T21:02:00Z');
  const resumed=instructionAction(course,moved.progress,{action:'start'},'2026-11-20T10:00:00Z');
  expect(resumed.progress.sessionId).toBe('two');
  expect(resumed.progress.responses.q1.attempts.map(a=>a.correct)).toEqual([false,true]);
  expect(first.progress.responses.q1.attempts).toHaveLength(1);
 });
 it('does not expose feedback before an answer or call a review a completion',()=>{
  expect(instructionRead(course,null).sessions[0].checks[0]).not.toHaveProperty('answer');
  const {progress}=instructionAction(course,null,{action:'review',sessionId:'one'},'now');
  expect(progress.reviewed).toEqual(['one']);
  expect(progress).not.toHaveProperty('completed');
  expect(progress.responses).toEqual({});
 });
 it('allows leaving and revisiting without a timer or forced exercise sequence',()=>{
  const {progress}=instructionAction(course,null,{action:'visit',sessionId:'two'},'now');
  expect(progress.sessionId).toBe('two');
  expect(progress.reviewed).toEqual([]);
 });
 it('records written practice and reveals comparison feedback without inventing a grade',()=>{
  const withPractice:InstructionCourse={...course,sessions:[{...course.sessions[0],practice:{prompt:'Write a report',modelResponse:'Observed fact and next action',rationale:'Separate observation from assumptions'}}]};
  expect(instructionRead(withPractice,null).sessions[0].practice).toEqual({prompt:'Write a report'});
  const {progress}=instructionAction(withPractice,null,{action:'practice',sessionId:'one',text:'My observation and next action'},'now');
  expect(progress.practiceResponses?.one[0].text).toBe('My observation and next action');
  expect(instructionRead(withPractice,progress).sessions[0].practice?.modelResponse).toBe('Observed fact and next action');
  expect(progress).not.toHaveProperty('score');
 });
 it('rejects unknown questions, options and cross-version progress',()=>{
  expect(()=>instructionAction(course,null,{action:'answer',sessionId:'one',questionId:'q1',option:20},'now')).toThrow();
  expect(()=>instructionAction(course,null,{action:'answer',sessionId:'two',questionId:'q1',option:1},'now')).toThrow();
  const {progress}=instructionAction(course,null,{action:'start'},'now');
  expect(()=>instructionAction({...course,version:'v2'},progress,{action:'start'},'now')).toThrow('version reconciliation');
 });
});
