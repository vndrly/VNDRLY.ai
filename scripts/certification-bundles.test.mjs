import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LibraryDraftSchema} from '../lib/api-zod/src/work-hub-library.ts';
import {safetyTrainingContentHash} from '../artifacts/api-server/src/lib/safety-training-content-hash.ts';
import {catalog} from '../research/safety-program/certifications-50/catalog.mjs';
const manifest=JSON.parse(readFileSync('research/safety-program/certifications-50/bundle-publication.json'));
const existing=JSON.parse(readFileSync('research/safety-program/2026-11-02/prepared-course-publication.json')).courses;
const ids=new Set([...existing.map(c=>c.id),'G99',...manifest.courses.map(c=>c.id)]);
test('exactly 50 nonempty distinct bundles resolve all required courses, including flagship and OQ',()=>{
 assert.deepEqual(manifest.bundles.map(b=>b.id),catalog.programs.map(p=>p.id));
 assert.equal(new Set(manifest.bundles.map(b=>b.title)).size,50);
 for(const b of manifest.bundles){
  assert(b.courseFamilies.length>=3);
  assert.equal(new Set(b.courseFamilies).size,b.courseFamilies.length);
  assert(b.courseFamilies.every(id=>ids.has(id)));
  assert.equal(b.externalCredentialGrantedByOnlineCompletion,false);
  assert(b.externalRequirements.length>50&&b.renewal.length>20);
  assert(b.description.includes('knowledge certificate'));
  assert(b.coverage.supportingCourses.every(c=>c.lessons.length&&c.checks));
 }
 assert(manifest.bundles.find(b=>b.id==='OG01').courseFamilies.includes('G99'));
 assert(manifest.bundles.find(b=>b.id==='OG15').courseFamilies.includes('C10'));
});
test('new courses have actual unique teaching and assessed lessons, stable hashes, and opaque answer IDs',()=>{
 assert.equal(manifest.courses.length,50);
 const courses=new Set();
 for(const c of manifest.courses){
  const parsed=LibraryDraftSchema.parse(c.content),t=parsed.training;
  assert.equal(safetyTrainingContentHash(parsed),c.contentSha256);
  const lessonSignature=JSON.stringify(t.lessons.map(l=>l.body));
  assert(!courses.has(lessonSignature),`${c.id} repeats an entire course`);courses.add(lessonSignature);
  assert(t.lessons.length>=4&&t.questions.length>=12);
  for(const l of t.lessons){
   assert(l.body.split(/\s+/).length>=200,`${c.id}/${l.id} lacks teaching`);
   assert(l.links.length,`${l.id} lacks references`);
   assert(!/\b(TODO|PLACEHOLDER|lorem ipsum)\b/i.test(l.body));
   assert(t.guided.steps.find(s=>s.lessonId===l.id)?.questionIds.length>=2);
  }
  assert(new Set(t.questions.map(q=>q.correctOptionIds[0])).size>=3);
  for(const q of t.questions){
   assert.equal(new Set(q.options.map(o=>o.label)).size,q.options.length);
   assert(q.options.every(o=>/^option\d+$/.test(o.id)));
   assert(t.guided.explanations[q.id].length>=25);
  }
 }
});
test('bundle publication has no assignment or auto-authorization instructions',()=>{
 for(const c of manifest.courses){
  assert.equal(c.content.training.completionMode,'both');
  assert(c.content.training.passingPercent>=80);
  assert(!c.content.trainingPolicy);
 }
 assert(!JSON.stringify(manifest).includes('completedAt'));
 assert(!JSON.stringify(manifest).includes('private-training'));
});
