import {describe,it,expect} from 'vitest';
import {vndrlyUCatalog} from './vndrly-u-catalog';
describe('shared VNDRLY/U catalog',()=>{
 it('contains all certifications and exact equivalent mappings without company ownership',()=>{
  expect(vndrlyUCatalog.programs).toHaveLength(117);
  expect(vndrlyUCatalog.programs.filter(p=>p.equivalentCertification)).toHaveLength(114);
  expect(new Set(vndrlyUCatalog.programs.map(p=>p.id)).size).toBe(117);
  expect(new Set(vndrlyUCatalog.programs.filter(p=>p.equivalentCertification).map(p=>p.equivalentCertification)).size).toBe(114);
  expect(vndrlyUCatalog.programs.find(p=>p.id==='VUC115')?.equivalentCertification).toBeNull();
  expect(JSON.stringify(vndrlyUCatalog)).not.toContain('owner_org_id');
 });
 it('resolves every constituent course to the complete authored lesson bodies',()=>{
  expect(vndrlyUCatalog.courses).toHaveLength(651);
  const ids=new Set(vndrlyUCatalog.courses.map(c=>c.id));expect(ids.size).toBe(651);
  for(const program of vndrlyUCatalog.programs){expect(program.courseIds.length).toBeGreaterThan(0);for(const id of program.courseIds)expect(ids.has(id)).toBe(true);}
  for(const course of vndrlyUCatalog.courses){expect(course.lessons.length).toBeGreaterThan(0);for(const l of course.lessons)expect(l.body.trim().length).toBeGreaterThan(0);}
 });
});
