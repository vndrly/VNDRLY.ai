import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {trainingCatalog,additionalTrainingApplies} from './company-required-training';
import {matchSafetyTrainingRoles} from './safety-training-role-match';
describe('task instruction and residual qualification contract',()=>{
 it('preserves every previously published course identity and keeps knowledge separate from qualifications',()=>{
  const prior=JSON.parse(readFileSync(new URL('../../../../research/safety-program/2026-11-02/preserved-course-identities.json',import.meta.url),'utf8')) as {id:string;sourceSha256:string;contentSha256:string}[];
  expect(prior).toHaveLength(69);
  for(const course of prior)expect(trainingCatalog.curriculum.find(c=>c.id===course.id)).toMatchObject(course);
  expect(trainingCatalog.curriculum).toHaveLength(116);
  expect(trainingCatalog.residuals?.groups).toHaveLength(49);
  const taskIds=new Set(trainingCatalog.curriculum.filter(c=>c.id.startsWith('G')&&Number(c.id.slice(1))>=50).map(c=>c.id));
  expect(taskIds.size).toBe(47);
  for(const group of trainingCatalog.residuals!.groups){
   expect(group.vendorEvidenceRequired.length).toBeGreaterThan(0);
   expect(group.practicalAssessmentRequired.length).toBeGreaterThan(0);
   expect(group.serviceIds.every(id=>trainingCatalog.catalog.services.some(s=>s.id===id))).toBe(true);
   if(!group.courseId){expect(['TG17','TG45']).toContain(group.groupId);continue;}
   expect(taskIds.has(group.courseId)).toBe(true);
   const course=trainingCatalog.additional.courses.find(c=>c.courseId===group.courseId)!;
   expect(course.masterServiceIds).toEqual(group.serviceIds);
   expect(course.roleMappings.length).toBeGreaterThan(0);
   expect(course.roleMappings.every(r=>r.requiresExposureConfirmation&&r.familyIds.every(id=>id===group.courseId))).toBe(true);
  }
 });
 it('preserves the H2S service extension and targets calibration knowledge to the actual technician role',()=>{
  const course=trainingCatalog.additional.courses.find(c=>c.courseId==='G71')!;
  const service={code:'h2s_monitoring_safety_trailer',masterServiceIds:[]};
  expect(additionalTrainingApplies(course,service)).toBe(true);
  expect(additionalTrainingApplies(course,{code:'unrelated_service',masterServiceIds:[]})).toBe(false);
  const rules=course.roleMappings.filter(r=>additionalTrainingApplies(r,service));
  expect(matchSafetyTrainingRoles({roles:[],jobTitle:'Detector calibration technician',vendorRole:'field'},rules,[]).familyIds).toEqual(['G71']);
  expect(matchSafetyTrainingRoles({roles:[],jobTitle:'H2S technician',vendorRole:'field'},rules,[]).familyIds).toEqual([]);
  expect(trainingCatalog.residuals?.extensions?.[0].residualRequirements).toHaveLength(6);
 });
});
