import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {catalog} from '../research/safety-program/certifications-50/catalog.mjs';
import {programs as foundations} from '../research/safety-program/certifications-50/foundation-curricula.mjs';
import {programs as workplace} from '../research/safety-program/certifications-50/workplace-curricula.mjs';
import {programs as operational} from '../research/safety-program/certifications-50/operational-curricula.mjs';
import {programs as specialist} from '../research/safety-program/certifications-50/specialist-curricula.mjs';
import {buildCourse,sourceHash} from './lib/certification-course.mjs';
const root='research/safety-program/certifications-50';
const baseline=JSON.parse(readFileSync('research/safety-program/2026-11-02/prepared-course-publication.json')).courses;
const flagship=JSON.parse(readFileSync('research/safety-program/energy-safety-core/course.json'));
const supplements=JSON.parse(readFileSync(`${root}/supplemental-courses.json`)).courses;
const authored={...foundations,...workplace,...operational,...specialist};
assert.equal(Object.keys(authored).length,48,'Every specialist program must have its actual authored course');
const newCourses=Object.entries(authored).map(([id,content])=>{
 const p=catalog.programs.find(p=>p.id===id);assert(p,`Unknown program ${id}`);
 assert(content.lessons.length>=4&&content.checks.length>=12,`${id}: incomplete authored course`);
 for(const l of content.lessons){
  assert(l.body.trim().split(/\s+/).length>=200,`${l.id}: insufficient instruction`);
  assert(content.checks.filter(q=>q.lessonId===l.id).length>=2,`${l.id}: unassessed instruction`);
 }
 return {...buildCourse(`C${10+Number(id.slice(2))}`,`${p.title} | Applied Practice`,content),programId:id,review:content.review};
});
const allCourses=[...baseline,flagship,...supplements,...newCourses];
assert.equal(new Set(allCourses.map(c=>c.id)).size,allCourses.length,'Course identity collision');
const bundles=catalog.programs.map(p=>{
 const dedicated=newCourses.find(c=>c.programId===p.id);
 const courseFamilies=[...new Set([...p.courseFamilies,'C09',...(p.id==='OG15'?['C10']:[]),...(dedicated?[dedicated.id]:[])])];
 const courses=courseFamilies.map(id=>{const c=allCourses.find(c=>c.id===id);assert(c,`${p.id}: missing course ${id}`);return c;});
 const externalRequirements=p.requirement;
 const sourceUrls=[...new Set([...p.sourceUrls,...(dedicated?.content.training.lessons.flatMap(l=>l.links)??[])])];
 const description=[`Purpose: ${p.title}.`,`Audience: ${p.audience}.`,
  `Complete all ${courses.length} courses below, including their learning checks and required assessments. The flagship G99 course retains its separate certification examination.`,
  `This is a VNDRLY knowledge certificate. Named issuer credentials, licenses, practical evaluations and employer/operator authorization are separate requirements.`,
  `Qualification and delivery: ${externalRequirements}`,`Maintenance: ${p.renewal}`,
  ...(dedicated?.review?.limitations?[`Scope: ${Array.isArray(dedicated.review.limitations)?dedicated.review.limitations.join(' '):dedicated.review.limitations}`]:[]),
  'Reference sources:',...sourceUrls].join('\n\n');
 return {id:p.id,title:`VNDRLY/U | ${p.title}`,description,courseFamilies,
  externalCredentialGrantedByOnlineCompletion:false,externalRequirements,renewal:p.renewal,
  sourceUrls,
  coverage:{supportingCourses:courses.map(c=>({id:c.id,title:c.title,lessons:c.content.training.lessons.map(l=>({id:l.id,title:l.title,bodySha256:sourceHash(l.body)})),checks:c.content.training.questions.length})),dedicatedReview:dedicated?.review??(p.id==='OG01'?{crosswalk:'research/safety-program/energy-safety-core/benchmark-crosswalk.json',independentReview:'Open; no PEC approval claim'}:{modules:['C09','C10'],scope:'OQ program coordination; operator task qualification remains operator specific'})},
  curriculumSha256:sourceHash(courses.map(c=>({id:c.id,sourceSha256:c.sourceSha256}))) };
});
const result={version:1,createdAt:'2026-11-07',scope:'VNDRLY knowledge certificate bundles with explicit external credential and practical requirements',bundles,courses:[...supplements,...newCourses]};
writeFileSync(`${root}/bundle-publication.json`,JSON.stringify(result,null,2)+'\n');
writeFileSync(`${root}/bundle-coverage.json`,JSON.stringify(bundles.map(b=>({id:b.id,title:b.title,...b.coverage})),null,2)+'\n');
console.log(JSON.stringify({bundles:bundles.length,newCourses:result.courses.length,newLessons:result.courses.reduce((n,c)=>n+c.content.training.lessons.length,0),newChecks:result.courses.reduce((n,c)=>n+c.content.training.questions.length,0),referencedCourses:new Set(bundles.flatMap(b=>b.courseFamilies)).size}));
