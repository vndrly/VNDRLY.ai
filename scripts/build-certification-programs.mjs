import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {catalog} from '../research/safety-program/certifications-50/catalog.mjs';
import * as assurance from '../research/safety-program/certifications-50/credential-assurance.mjs';
import * as oq from '../research/safety-program/certifications-50/pipeline-oq.mjs';
import {LibraryDraftSchema} from '../lib/api-zod/src/work-hub-library.ts';
import {safetyTrainingContentHash} from '../artifacts/api-server/src/lib/safety-training-content-hash.ts';
const root='research/safety-program/certifications-50';
const outreach=JSON.parse(readFileSync(`${root}/outreach-delivery-requirements.json`));
for(const p of outreach.programs){
 assert.equal(Object.values(p.requiredTopicHours).reduce((sum,h)=>sum+h,0)+p.electiveHours+p.optionalHours,p.minimumInstructionHours);
}
const baseline=JSON.parse(readFileSync('research/safety-program/2026-11-02/prepared-course-publication.json')).courses;
const flagship=JSON.parse(readFileSync('research/safety-program/energy-safety-core/course.json'));
const courses=[...baseline,flagship];
assert.equal(courses.length,117);
assert.equal(catalog.programs.length,50);
assert.equal(new Set(catalog.programs.map(p=>p.id)).size,50);
const byId=new Map(courses.map(c=>[c.id,c]));
assert(byId.has('G99'),'Flagship publication identity missing');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function buildModule(id,title,authored){
 const questions=authored.checks.map((q,index)=>{
  const options=[q.answer,...q.distractors];
  // Stable position rotation avoids teaching learners that the first option is
  // always correct. Actual answers remain server-side in normal library reads.
  const shift=index%options.length;
  const rotated=[...options.slice(shift),...options.slice(0,shift)];
  return {id:q.id,prompt:q.prompt,options:rotated.map((label,n)=>({id:`option${n+1}`,label})),multiple:false,correctOptionIds:[`option${rotated.indexOf(q.answer)+1}`]};
 });
 const content=LibraryDraftSchema.parse({kind:'training',title,safetyRelated:true,
  description:'Original VNDRLY knowledge instruction with worked cases, explained checks and preserved remediation. Actual task qualification follows the applicable employer, operator or issuer requirements.',
  training:{lessons:authored.lessons,questions,completionMode:'both',passingPercent:80,allowRetries:true,maximumAttempts:3,
   guided:{steps:authored.lessons.map(l=>({lessonId:l.id,questionIds:authored.checks.filter(q=>q.lessonId===l.id).map(q=>q.id)})),explanations:Object.fromEntries(authored.checks.map(q=>[q.id,q.explanation]))}}});
 return {id,title,categoryId:'competence',sourceVersion:'1.0',sourceSha256:hash(content),contentSha256:safetyTrainingContentHash(content),content};
}
const supplements=[buildModule('C09','Training Assurance | Credential and Qualification Decisions',assurance),buildModule('C10','Pipeline Safety | OQ Program Coordination',oq)];
for(const c of supplements){assert(!byId.has(c.id),`Existing course collision ${c.id}`);byId.set(c.id,c);}
const audit=catalog.programs.map(p=>{
 for(const id of p.courseFamilies)assert(byId.has(id),`${p.id}: missing course ${id}`);
 return {...p,sourceUrls:p.sourceUrls.map(url=>url==='https://www.api.org/products-and-services/individual-certification-programs/certifications'?`${url}/api${({OG20:'510',OG21:'570',OG22:'653',OG23:'1169',OG46:'571',OG47:'580'})[p.id]}`:url),
  publicationReady:false,
  deliveryRequirements:outreach.programs.some(d=>d.programId===p.id)?{...outreach,programs:outreach.programs.filter(d=>d.programId===p.id)}:null,
  publicationReason:'Detailed objective-to-lesson assessment review is pending. Supporting courses do not establish complete external-standard coverage.',
  supportingCourses:p.courseFamilies.map(id=>{const c=byId.get(id);return {id,title:c.title,sourceSha256:c.sourceSha256,contentSha256:c.contentSha256??null,lessons:(c.content?.training?.lessons??[]).map(l=>({id:l.id,title:l.title,bodySha256:hash(l.body)})),learningChecks:c.content?.training?.questions?.length??0};}),
  supplementalCourseIds:p.id==='OG15'?['C09','C10']:['C09'],
 };
});
const direct={
 G99:['OG01'],H13:['OG03'],C08:['OG06'],H05:['OG07'],G87:['OG07'],H04:['OG08'],H08:['OG09','OG31'],G88:['OG09','OG31','OG43'],
 G02:['OG10'],G51:['OG10'],G84:['OG10'],C06:['OG11','OG12','OG34'],C05:['OG13'],G95:['OG13'],G79:['OG14'],G92:['OG15'],G63:['OG16','OG42'],
 G61:['OG17','OG19','OG50'],G69:['OG18'],G70:['OG20','OG21','OG22','OG25'],G72:['OG24','OG44'],
 H14:['OG26'],H15:['OG27'],E04:['OG28'],H06:['OG29','OG38'],H09:['OG30'],G86:['OG30'],H07:['OG32','OG33'],G75:['OG12','OG32','OG33'],
 H12:['OG35'],G60:['OG35'],G67:['OG35'],G01:['OG36'],G50:['OG36'],G04:['OG37'],G53:['OG37'],G97:['OG38'],H17:['OG39'],H16:['OG40'],G73:['OG40'],H19:['OG41'],
};
const requirements=Object.fromEntries(Object.entries(direct).map(([family,ids])=>{
 assert(byId.has(family));
 return [family,ids.map(id=>{const p=audit.find(p=>p.id===id);assert(p);return {programId:id,title:p.title,benchmark:p.benchmark,audience:p.audience,requirement:p.requirement,renewal:p.renewal,sourceUrls:p.sourceUrls};})];
}));
mkdirSync(root,{recursive:true});
writeFileSync(`${root}/prepared-programs.json`,JSON.stringify({...catalog,programs:audit},null,2)+'\n');
writeFileSync(`${root}/supplemental-courses.json`,JSON.stringify({version:1,courses:supplements},null,2)+'\n');
writeFileSync('artifacts/api-server/src/data/training-qualification-context.json',JSON.stringify(requirements,null,2)+'\n');
writeFileSync(`${root}/coverage-report.md`,[
 '# Oil and gas certification curriculum coverage',
 '',catalog.selectionBasis,'',
 '**Status: curriculum development, not 50 finished or externally recognized certifications.**',
 '',`Existing curriculum: ${courses.length} courses. Newly authored knowledge modules: ${supplements.length}.`,
 'The existing G99 private exam is not copied, modified or exposed by this build.',
 'No existing assignment, completion, policy or safety score is changed.',
 '',...audit.flatMap(p=>[`## ${p.id} — ${p.title}`,'',`Benchmark: ${p.benchmark}`,`Audience: ${p.audience}`,'',
  ...p.modules.map(m=>`- ${m}`),'',`Supporting courses: ${p.courseFamilies.join(', ')}`,'',p.requirement,'',`Renewal: ${p.renewal}`,'',
  'Coverage still to establish:',...(p.coverageGaps.length?p.coverageGaps:['Objective-by-objective teaching, assessment and role-specific delivery review.']).map(g=>`- ${g}`),'',
  ...p.sourceUrls.map(u=>`- ${u}`),'']),
].join('\n'));
console.log(JSON.stringify({programs:audit.length,existingCourses:courses.length,newKnowledgeModules:supplements.length,remediatedCourseContexts:Object.keys(requirements).length,publicationReady:audit.filter(p=>p.publicationReady).length}));
