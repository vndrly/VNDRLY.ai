import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalog} from '../research/safety-program/certifications-50/catalog.mjs';
import {LibraryDraftSchema} from '../lib/api-zod/src/work-hub-library.ts';
import {safetyTrainingContentHash} from '../artifacts/api-server/src/lib/safety-training-content-hash.ts';
const root='research/safety-program/certifications-50';
const prepared=JSON.parse(readFileSync(`${root}/prepared-programs.json`));
const supplements=JSON.parse(readFileSync(`${root}/supplemental-courses.json`)).courses;
test('all 50 pathways preserve the original 25 and flagship without granting external credentials',()=>{
 assert.equal(prepared.programs.length,50);
 assert.equal(new Set(prepared.programs.map(p=>p.id)).size,50);
 assert.equal(prepared.flagshipId,'OG01');
 for(const p of prepared.programs){
  assert.equal(p.externalCredentialGrantedByOnlineCompletion,false);
  assert.equal(p.publicationReady,false);
  assert(p.modules.length>=5);
  assert(p.supportingCourses.every(c=>c.lessons.length>0&&c.learningChecks>0));
  assert(p.sourceUrls.every(url=>new URL(url).protocol==='https:'));
 }
 assert(prepared.programs[0].courseFamilies.includes('G99'));
 assert.equal(prepared.programs[24].id,'OG25');
});
test('supplemental modules have teaching, assessed objectives and nonrevealing answer option IDs',()=>{
 assert.equal(supplements.length,2);
 for(const course of supplements){
  const parsed=LibraryDraftSchema.parse(course.content);
  assert.equal(safetyTrainingContentHash(parsed),course.contentSha256);
  const training=parsed.training;
  assert(training.lessons.every(l=>l.body.split(/\s+/).length>=220&&l.links.length));
  assert(training.guided.steps.every(s=>s.questionIds.length>=3));
  const keys=new Set(training.questions.map(q=>q.correctOptionIds[0]));
  assert(keys.size>=3,'Correct answer positions must vary');
  for(const q of training.questions){assert(q.options.every(o=>/^option\d$/.test(o.id)));assert(training.guided.explanations[q.id]);}
 }
});
test('task requirements do not silently award credit or rewrite canonical coursework',()=>{
 const context=JSON.parse(readFileSync('artifacts/api-server/src/data/training-qualification-context.json'));
 assert.equal(context.G92[0].programId,'OG15');
 assert(context.H04[0].requirement.includes('excludes oil and gas well drilling/servicing'));
 assert(!context.L01);
 assert(!JSON.stringify(context).includes('completedAt'));
 for(const p of catalog.programs)assert(p.courseFamilies.length>0);
});
