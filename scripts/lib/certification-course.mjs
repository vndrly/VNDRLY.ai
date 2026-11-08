import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {LibraryDraftSchema} from '../../lib/api-zod/src/work-hub-library.ts';
import {safetyTrainingContentHash} from '../../artifacts/api-server/src/lib/safety-training-content-hash.ts';
export const sourceHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function buildCourse(id,title,authored){
 const questions=authored.checks.map((q,index)=>{
  const options=[q.answer,...q.distractors];
  assert.equal(new Set(options).size,options.length,`${q.id}: repeated choice`);
  const shift=index%options.length;
  const rotated=[...options.slice(shift),...options.slice(0,shift)];
  assert(authored.lessons.some(l=>l.id===q.lessonId),`${q.id}: missing lesson`);
  return {id:q.id,prompt:q.prompt,options:rotated.map((label,n)=>({id:`option${n+1}`,label})),multiple:false,correctOptionIds:[`option${rotated.indexOf(q.answer)+1}`]};
 });
 const content=LibraryDraftSchema.parse({kind:'training',title,safetyRelated:true,
  description:'Original VNDRLY instruction, worked cases and explained assessments. Complete the supporting courses in the certificate bundle as well. Practical competence and named external credentials follow the requirements stated in that bundle.',
  training:{lessons:authored.lessons.map(l=>({...l,links:l.links.map(link=>typeof link==='string'?link:link.url)})),questions,completionMode:'both',passingPercent:80,allowRetries:true,maximumAttempts:3,
   guided:{steps:authored.lessons.map(l=>({lessonId:l.id,questionIds:authored.checks.filter(q=>q.lessonId===l.id).map(q=>q.id)})),explanations:Object.fromEntries(authored.checks.map(q=>[q.id,q.explanation]))}}});
 return {id,title,categoryId:'competence',sourceVersion:'1.0',sourceSha256:sourceHash(content),contentSha256:safetyTrainingContentHash(content),content};
}
