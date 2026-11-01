import{readFileSync}from'node:fs';import{describe,it,expect}from'vitest';
import{LibraryDraftSchema}from'@workspace/api-zod';
import{safetyTrainingContentHash}from'./safety-training-content-hash';import{trainingCatalog}from'./company-required-training';
const root=new URL('../../../../research/safety-program/energy-safety-core/',import.meta.url),read=(file:string)=>JSON.parse(readFileSync(new URL(file,root),'utf8'));
describe('finished Energy Safety Core and honest benchmark coverage',()=>{
 it('contains actual teaching and separate domain-balanced examination without changing prior course identities',()=>{
  const course=read('course.json'),content=LibraryDraftSchema.parse(course.content),t=content.training!;
  expect(safetyTrainingContentHash(content)).toBe(course.teachingSha256);expect(t.lessons).toHaveLength(13);expect(t.questions).toHaveLength(48);
  expect(t.guided!.steps).toHaveLength(11);expect(t.guided!.steps.some(s=>['ESC_BENCHMARK','ESC_OSHA','ESC_REVIEW'].includes(s.lessonId))).toBe(false);
  expect(t.lessons.slice(1,11).every(l=>l.body.split(/\s+/).length>=1100)).toBe(true);
  const contract=read('assessment-contract.json'),index=read('assessment-index.json');expect(t.certificationExam).toBeUndefined();
  expect(contract).toMatchObject({bankSize:75,questionCount:40,questionsPerDomain:4,passingPercent:80,sourceSha256:course.sourceSha256,contentSha256:course.contentSha256,teachingSha256:course.teachingSha256});
  expect(index.items).toHaveLength(75);expect(new Set(index.items.map((q:any)=>q.domainId)).size).toBe(10);
  expect(index.items.every((q:any)=>Object.keys(q).sort().join(',')==='domainId,id'&&!t.questions.some(l=>l.id===q.id))).toBe(true);
  expect(t.lessons[0].body).toContain('No evidence upload, supervisor sign-off or practical evaluation');expect(t.lessons[0].body).toContain('not an accredited PEC');
  expect(trainingCatalog.curriculum.find(c=>c.id==='G99')).toMatchObject({contentSha256:course.contentSha256});
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
