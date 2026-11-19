import {z} from 'zod/v4';

export type InstructionCheck={id:string;prompt:string;options:string[];answer:number;feedback:string};
export type InstructionSession={id:string;title:string;minutes:number;objective:string;instruction:string;example?:string;practice?:{prompt:string;modelResponse:string;rationale:string};checks:InstructionCheck[]};
export type InstructionCourse={id:string;version:string;title:string;sessions:InstructionSession[]};
export type InstructionProgress={
 version:string;sessionId:string;startedAt:string;updatedAt:string;
 reviewed:string[];
 practiceResponses?:Record<string,{text:string;at:string}[]>;
 responses:Record<string,{attempts:{option:number;correct:boolean;at:string}[]}>;
};
const actionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('start')}),
 z.object({action:z.literal('visit'),sessionId:z.string()}),
 z.object({action:z.literal('review'),sessionId:z.string()}),
 z.object({action:z.literal('practice'),sessionId:z.string(),text:z.string().trim().min(1).max(10000)}),
 z.object({action:z.literal('answer'),sessionId:z.string(),questionId:z.string(),option:z.number().int().nonnegative()}),
]);

/** Learning checks are formative. They never issue a credential, represent a
 * practical sign-off, or replace a separately controlled final examination. */
export function instructionAction(course:InstructionCourse,saved:InstructionProgress|null,input:unknown,now:string){
 const action=actionSchema.parse(input);
 if(!course.sessions.length)throw Error('Course instruction is unavailable');
 if(saved&&saved.version!==course.version)throw Error('Course content changed; the saved attempt requires version reconciliation');
 const progress:InstructionProgress=saved?structuredClone(saved):{
  version:course.version,sessionId:course.sessions[0].id,startedAt:now,updatedAt:now,reviewed:[],responses:{},
 };
 progress.updatedAt=now;
 let feedback:{questionId:string;correct:boolean;explanation:string;answer:number}|null=null;
 if(action.action!=='start'){
  const session=course.sessions.find(s=>s.id===action.sessionId);
  if(!session)throw Error('Section not found');
  progress.sessionId=session.id;
  if(action.action==='review')progress.reviewed=[...new Set([...progress.reviewed,session.id])];
  if(action.action==='practice'){
   if(!session.practice)throw Error('This section has no written exercise');
   progress.practiceResponses??={};
   progress.practiceResponses[session.id]=[...(progress.practiceResponses[session.id]??[]),{text:action.text,at:now}];
  }
  if(action.action==='answer'){
   const question=session.checks.find(q=>q.id===action.questionId);
   if(!question||action.option>=question.options.length)throw Error('Choose an available answer');
   const correct=action.option===question.answer;
   const response=progress.responses[question.id]??{attempts:[]};
   response.attempts.push({option:action.option,correct,at:now});
   progress.responses[question.id]=response;
   feedback={questionId:question.id,correct,explanation:question.feedback,answer:question.answer};
  }
 }
 return {progress,feedback};
}

/** Correct answers are returned only for checks the learner has attempted. */
export function instructionRead(course:InstructionCourse,progress:InstructionProgress|null){
 return {...course,sessions:course.sessions.map(({practice,...session})=>({...session,
 ...(practice?{practice:{prompt:practice.prompt,...(progress?.practiceResponses?.[session.id]?.length?{modelResponse:practice.modelResponse,rationale:practice.rationale}:{})}}:{}),checks:session.checks.map(({answer,feedback,...question})=>({
  ...question,...(progress?.responses[question.id]?.attempts.length?{feedback,answer}:{}),
 }))})),progress};
}
