import{readFileSync}from'node:fs';import{describe,it,expect}from'vitest';
import{LibraryDraftSchema}from'@workspace/api-zod';
import{safetyTrainingContentHash}from'./safety-training-content-hash';import{trainingCatalog}from'./company-required-training';
const root=new URL('../../../../research/safety-program/energy-safety-core/',import.meta.url),read=(file:string)=>JSON.parse(readFileSync(new URL(file,root),'utf8'));
describe('Energy Safety Core content and benchmark contracts',()=>{
 it('contains actual teaching and separate domain-balanced examination without changing prior course identities',()=>{
  const course=read('course.json'),content=LibraryDraftSchema.parse(course.content),t=content.training!;
  expect(safetyTrainingContentHash(content)).toBe(course.teachingSha256);expect(t.lessons).toHaveLength(13);expect(t.questions).toHaveLength(61);
  expect(t.guided!.steps).toHaveLength(12);expect(t.guided!.steps.some(s=>['ESC_BENCHMARK','ESC_OSHA','ESC_REVIEW','ESC_APPLICATION'].includes(s.lessonId))).toBe(false);
  expect(t.guided!.steps.some(s=>s.lessonId==='ESC_GUIDE')).toBe(true);
  expect(t.lessons.find(l=>l.id==='ESC_GUIDE')?.body).toContain('Integrated learner exercise');
  const packet=t.lessons.find(l=>l.id==='ESC_APPLICATION')!.body;
  expect(packet.match(/## Station \d/g)).toHaveLength(6);
  expect(packet.match(/\*\*Critical error:\*\*/g)).toHaveLength(6);
  expect(packet.match(/\*\*Retry variation:\*\*/g)).toHaveLength(6);
  expect(packet).toContain('Actual response observed');
  expect(course.sourceVersion).toBe('3.0');
  expect(t.lessons.slice(1,11).every(l=>l.body.split(/\s+/).length>=1100)).toBe(true);
  const contract=read('assessment-contract.json'),index=read('assessment-index.json');expect(t.certificationExam).toBeUndefined();
  expect(contract).toMatchObject({bankSize:75,questionCount:40,questionsPerDomain:4,passingPercent:80,sourceSha256:course.sourceSha256,contentSha256:course.contentSha256,teachingSha256:course.teachingSha256});
  expect(index.items).toHaveLength(75);expect(new Set(index.items.map((q:any)=>q.domainId)).size).toBe(10);
  expect(index.items.every((q:any)=>Object.keys(q).sort().join(',')==='domainId,id'&&!t.questions.some(l=>l.id===q.id))).toBe(true);
  expect(t.lessons.find(l=>l.id==='ESC_GUIDE')?.body).toContain('must not label it a Veriforce');
  expect(trainingCatalog.curriculum.find(c=>c.id==='G99')).toMatchObject({contentSha256:course.contentSha256});
  expect(course.compatibleVersions).toContainEqual({sourceSha256:'64b7216a9d20e8b738da1bb081486f413a0a4f4d1a2aebf4f36d10c0cdce4e7a',contentSha256:'7c8bed01fded694cf1ed38880d7bfe056af3916274f134ab6da9bfef2c6be9ee'});
  const prior=read('preserved-course-identities.json');expect(prior).toHaveLength(116);
  for(const c of prior)expect(trainingCatalog.curriculum.find(x=>x.id===c.id)).toMatchObject(c);
  expect(trainingCatalog.additional.courses.some(c=>c.courseId==='G99')).toBe(false);
 });
 it('links42actual objectives to real instruction and assessment and leaves workplace/external evidence open',()=>{
  const t=LibraryDraftSchema.parse(read('course.json').content).training!,cross=read('benchmark-crosswalk.json'),osha=read('osha-crosswalk.json'),review=read('independent-review-register.json'),index=read('assessment-index.json');
  expect(cross.objectives).toHaveLength(42);expect(new Set(cross.objectives.map((r:any)=>r.objective)).size).toBe(42);
  for(const row of cross.objectives){expect(t.lessons.find(l=>l.id===row.instruction.lessonId)?.body).toContain(row.instruction.heading);expect(row.learningChecks.every((id:string)=>t.questions.some(q=>q.id===id))).toBe(true);expect(row.examQuestionIds.every((id:string)=>index.items.some((q:any)=>q.id===id))).toBe(true);}
  expect(osha.rows).toHaveLength(68);expect(osha.rows.every((r:any)=>r.automaticallySatisfied===false&&r.remainingEmployerEvidence&&!('practicalStatus'in r)&&Array.isArray(r.legalTaskRequirements))).toBe(true);
  expect(osha.rows.find((r:any)=>r.citation==='1910.147(c)(7)').appliesTo).toContain('excludes construction and oil/gas well drilling');
  expect(review.items).toHaveLength(9);expect(review.items.every((r:any)=>r.status==='OPEN')).toBe(true);
 });
});
