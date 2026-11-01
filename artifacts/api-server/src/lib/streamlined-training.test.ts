import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {LibraryDraftSchema,type LibraryMetadata} from '@workspace/api-zod';
import {course as h03} from '../../../../research/safety-program/2026-10-31/course-review/H03-permit-to-work-simops/guided-course.mjs';
import {trainingReadContent} from '../work-hub/library-policy';
import {safetyTrainingContentHash} from './safety-training-content-hash';
import {legalTaskRequirements} from '../../../../scripts/lib/streamlined-training.mjs';
const read=(path:string)=>JSON.parse(readFileSync(new URL('../../../../'+path,import.meta.url),'utf8'));
const courses=read('research/safety-program/2026-11-02/prepared-course-publication.json').courses as {id:string;content:ReturnType<typeof LibraryDraftSchema.parse>}[];
describe('streamlined training requirements',()=>{
 it('retains all116 existing course families, their actual teaching, questions and worked scenarios without blanket evidence/assessor appendices',()=>{
  expect(courses).toHaveLength(116);
  for(const c of courses){const t=c.content.training!;expect(t.questions).toHaveLength(26);expect(t.guided!.steps).toHaveLength(10);
   const body=t.lessons.map(l=>l.body).join('\n');
   expect(body).not.toMatch(/Vendor evidence still required|Qualified practical assessment still required|A suitable assessor must observe|A designated assessor.*must separately observe/i);
   expect(t.lessons.slice(1,7).every(l=>l.body.split(/\s+/).length>150)).toBe(true);
  }
 });
 it('retains legal duties with an actual regulation, scope and source, without turning them into online-course prerequisites',()=>{
  expect(legalTaskRequirements).toHaveLength(12);
  for(const r of legalTaskRequirements){expect(r.citation).toMatch(/^(29|49|10) CFR /);expect(r.appliesTo.length).toBeGreaterThan(30);expect(r.url).toMatch(/^https:\/\//);}
  const office=courses.find(c=>c.id==='G81')!.content.training!;expect(office.lessons.map(l=>l.body).join(' ')).not.toMatch(/practical assessment|qualified practical assessment still required/i);
  const forklift=courses.find(c=>c.id==='G75')!.content.training!;expect(forklift.lessons.at(-1)!.body).toContain('29 CFR 1910.178(l)');
 });
 it('removes added requirements from an authenticated historical H03 read without changing its stored content or assessment keys',()=>{
  const content=LibraryDraftSchema.parse(h03),before=safetyTrainingContentHash(content),identity=read('research/safety-program/regulatory-streamlining/previous-course-identities.json').find((x:any)=>x.id==='H03');
  const metadata={content,safetyResource:{familyId:'H03',sourceVersion:'1.0',sourceSha256:identity.sourceSha256}} as LibraryMetadata;
  const shown=trainingReadContent(metadata)!;
  expect(safetyTrainingContentHash(content)).toBe(before);expect(shown.training!.questions).toEqual(content.training!.questions);
  expect(shown.training!.lessons.map(l=>l.body).join(' ')).not.toContain('must separately observe');
  expect(shown.training!.lessons.map(l=>l.body).join(' ')).toContain('SIMOPS');
 });
 it('does not rewrite company-authored content carrying copied family/source labels',()=>{
  const content=LibraryDraftSchema.parse(h03);content.training!.lessons[0].body+=' Company-authored customization.';
  const identity=read('research/safety-program/regulatory-streamlining/previous-course-identities.json').find((x:any)=>x.id==='H03');
  const metadata={content,safetyResource:{familyId:'H03',sourceVersion:'1.0',sourceSha256:identity.sourceSha256}} as LibraryMetadata;
  expect(trainingReadContent(metadata)).toBe(content);
 });
});
