import{readFileSync}from'node:fs';import{describe,it,expect}from'vitest';
import{LibraryDraftSchema}from'@workspace/api-zod';
import{safetyTrainingContentHash}from'./safety-training-content-hash';import{trainingCatalog}from'./company-required-training';
const root=new URL('../../../../research/safety-program/energy-safety-core/',import.meta.url),read=(file:string)=>JSON.parse(readFileSync(new URL(file,root),'utf8'));
describe('finished Energy Safety Core and honest benchmark coverage',()=>{
 it('contains actual teaching and separate domain-balanced examination without changing prior course identities',()=>{
  const course=read('course.json'),content=LibraryDraftSchema.parse(course.content),t=content.training!;
  expect(safetyTrainingContentHash(content)).toBe(course.contentSha256);expect(t.lessons).toHaveLength(14);expect(t.questions).toHaveLength(48);
  expect(t.lessons.slice(1,11).every(l=>l.body.split(/\s+/).length>=1100)).toBe(true);
  const exam=t.certificationExam!;expect(exam.questions).toHaveLength(74);expect(exam.questionCount).toBe(40);expect(exam.questionsPerDomain).toBe(4);
  expect(new Set(exam.questions.map(q=>q.domainId)).size).toBe(10);
  expect(exam.questions.every(q=>!t.questions.some(l=>l.id===q.id||l.prompt===q.prompt))).toBe(true);
  expect(t.lessons[0].body).toContain('not independently proctored');expect(t.lessons[0].body).toContain('not issue a PEC');
  expect(trainingCatalog.curriculum.find(c=>c.id==='G99')).toMatchObject({contentSha256:course.contentSha256});
  const prior=JSON.parse(readFileSync(new URL('../../../../research/safety-program/2026-11-02/prepared-course-publication.json',import.meta.url),'utf8')).courses;
  for(const c of prior)expect(trainingCatalog.curriculum.find(x=>x.id===c.id)).toMatchObject({sourceSha256:c.sourceSha256,contentSha256:safetyTrainingContentHash(LibraryDraftSchema.parse(c.content))});
  expect(trainingCatalog.additional.courses.some(c=>c.courseId==='G99')).toBe(false);
 });
 it('links42actual objectives to real instruction and assessment and leaves workplace/external evidence open',()=>{
  const t=LibraryDraftSchema.parse(read('course.json').content).training!,cross=read('benchmark-crosswalk.json'),osha=read('osha-crosswalk.json'),review=read('independent-review-register.json');
  expect(cross.objectives).toHaveLength(42);expect(new Set(cross.objectives.map((r:any)=>r.objective)).size).toBe(42);
  for(const row of cross.objectives){expect(t.lessons.find(l=>l.id===row.instruction.lessonId)?.body).toContain(row.instruction.heading);expect(row.learningChecks.every((id:string)=>t.questions.some(q=>q.id===id))).toBe(true);expect(row.examQuestionIds.every((id:string)=>t.certificationExam!.questions.some(q=>q.id===id))).toBe(true);}
  expect(osha.rows).toHaveLength(68);expect(osha.rows.every((r:any)=>r.automaticallySatisfied===false&&r.remainingEmployerEvidence&&r.status.includes('open'))).toBe(true);
  expect(osha.rows.find((r:any)=>r.citation==='1910.147(c)(7)').appliesTo).toContain('excludes construction and oil/gas well drilling');
  expect(review.items).toHaveLength(9);expect(review.items.every((r:any)=>r.status==='OPEN')).toBe(true);
 });
});
