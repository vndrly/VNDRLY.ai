import React from 'react';
import {BookOpen} from 'lucide-react';
import {z} from 'zod/v4';
import {Link} from 'wouter';
import {useLibrary} from './use-library';
const schema=z.object({title:z.string(),studyUrl:z.string(),outline:z.array(z.object({number:z.number(),title:z.string(),summary:z.string(),questionCount:z.number()})),scoring:z.object({questionCount:z.number(),guided:z.boolean(),passingPercent:z.number(),exam:z.object({questionCount:z.number(),passingPercent:z.number()}).nullable()}),companyScoring:z.object({maximumTrainingPoints:z.number(),formula:z.string(),explanation:z.string()}),related:z.array(z.object({itemId:z.uuid(),familyId:z.string(),title:z.string()}))});
export default function TrainingCourseGuide({itemId}:{itemId:string}){
 const api=useLibrary(`/api/work-hub/library/${itemId}/course-guide`,v=>schema.parse(v));
 if(!api.data)return <p role="status">{api.error||'Loading course information…'}</p>;
 const data=api.data;
 return <section aria-label="Course information" data-library-card="" className="training-course-guide-card space-y-5 p-4">
  <div><h3 className="flex items-center gap-2 text-lg font-bold"><BookOpen aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--brand-primary)]"/>Study materials</h3><p>Download the complete lessons, worked scenarios, practice questions and answer explanations for {data.title}.</p><a className="font-semibold underline" href={data.studyUrl}>Download study guide (PDF)</a></div>
  <details><summary className="cursor-pointer text-lg font-bold">Training outline ({data.outline.length} sections)</summary><ol className="mt-3 list-decimal space-y-3 pl-6">{data.outline.map(section=><li key={section.number}><p className="font-semibold">{section.title}</p><p>{section.summary}</p>{section.questionCount>0&&<p className="text-sm">{section.questionCount} {section.questionCount===1?'question':'questions'}</p>}</li>)}</ol></details>
  <details><summary className="cursor-pointer text-lg font-bold">Course scoring and completion</summary><div className="mt-3 space-y-2">
   <p>{data.scoring.questionCount} learning questions.</p>
   {data.scoring.guided?<><p>Original score: correct first answers ÷ total questions × 100.</p><p>When an answer is wrong, review the explanation and acknowledge the correct answer. That question is then accomplished. The remediated score includes those acknowledged corrections, while the original answer and original score remain recorded.</p><p>Complete every section and learning question to complete the guided course.</p></>:<p>Passing standard: {data.scoring.passingPercent}%.</p>}
   {data.scoring.exam&&<p>Separate certification exam: {data.scoring.exam.questionCount} questions; passing standard {data.scoring.exam.passingPercent}%. Its score is separate from the learning checks, and lesson remediation does not change an exam result.</p>}
  </div></details>
  <details><summary className="cursor-pointer text-lg font-bold">Contribution to the company training score</summary><div className="mt-3 space-y-2"><p>{data.companyScoring.explanation}</p><p className="font-semibold">{data.companyScoring.formula}</p><p>This training component provides up to {data.companyScoring.maximumTrainingPoints} points within the existing company scoring rubric.</p></div></details>
  <div><h3 className="text-lg font-bold">Related training</h3><ul className="list-disc space-y-1 pl-5">{data.related.map(course=><li key={course.itemId}><Link className="underline" href={`/work-hub/library/${course.itemId}?view=training`}>{course.title}</Link></li>)}</ul></div>
 </section>;
}
