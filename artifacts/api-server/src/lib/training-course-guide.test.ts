import {describe,it,expect} from 'vitest';
import {PDFParse} from 'pdf-parse';
import {LibraryDraftSchema} from '@workspace/api-zod';
import {buildTrainingCourseGuide,relatedCourseFamilies} from './training-course-guide';
import {renderTrainingStudyPdf} from './training-study-pdf';
const lessonText='Before opening the connection, identify the equipment and every connected source of energy. Relieve pressure using the task method and verify the safe condition before exposing people. Keep clear when a condition is uncertain.';
const content=LibraryDraftSchema.parse({kind:'training',title:'H03 — Permit to work',safetyRelated:true,training:{lessons:[{id:'scope',title:'Lesson 1 — Define the scope',body:`## Scope\n\n${lessonText}`}],questions:[{id:'q',prompt:'What should happen when the safeguard is missing?',options:[{id:'hold',label:'Pause the affected work and resolve the missing safeguard.'},{id:'go',label:'Continue because the permit is signed.'}],correctOptionIds:['hold']}],guided:{steps:[{lessonId:'scope',questionIds:['q']}],explanations:{q:'The physical safeguard protects people. A signed permit does not establish that condition.'}},certificationExam:{questionCount:1,passingPercent:80,maximumAttempts:3,questions:[{id:'secret',domainId:'domain',prompt:'SECRET CERTIFICATION QUESTION',options:[{id:'a',label:'SECRET EXAM ANSWER'},{id:'b',label:'Other exam answer'}],correctOptionIds:['a'],explanation:'SECRET EXAM RATIONALE'}]}}});
describe('course information and study material',()=>{
 it('explains the actual outline, separate assessment scores and existing company scoring',()=>{
  const guide=buildTrainingCourseGuide(content,'H03');expect(guide.description).toContain('simultaneous work');expect(guide.purpose).toContain('communicating a conflict');expect(guide.outline).toMatchObject([{title:'Define the scope',questionCount:1}]);expect(guide.outline[0].summary).toContain('every connected source');expect(guide.scoring.exam).toEqual({questionCount:1,passingPercent:80,maximumAttempts:3});expect(guide.companyScoring.maximumTrainingPoints).toBe(10);expect(relatedCourseFamilies.H03).toContain('H04');
 });
 it('includes the complete teaching and practice explanations without the certification bank',async()=>{
  const pdf=await renderTrainingStudyPdf(content,buildTrainingCourseGuide(content,'H03'),2);expect(pdf.subarray(0,4).toString()).toBe('%PDF');
  const parser=new PDFParse({data:new Uint8Array(pdf)});try{const result=await parser.getText();const text=result.text.replace(/\s+/g,' ');expect(text).toContain('Relieve pressure using the task method');expect(text).toContain('A signed permit does not establish that condition');expect(text).toContain('Practice questions');expect(text).toContain('80% passing standard');expect(text).not.toContain('SECRET');expect(text).not.toContain('Other exam answer');expect(result.pages.length).toBeGreaterThan(2);}finally{await parser.destroy();}
 },15000);
});
