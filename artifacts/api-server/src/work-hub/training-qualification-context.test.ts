import {describe,it,expect} from 'vitest';
import {TrainingQualificationContextSchema} from '@workspace/api-zod';
import {trainingQualificationContext} from './training-qualification-context';
const metadata=(familyId:string,kind='training')=>({kind,safetyResource:{familyId,resourceType:'training',categoryId:'competence',sourceVersion:'1.0',sourceSha256:'a'.repeat(64)}} as any);
describe('role-specific qualification context',()=>{
 it('exposes OQ operator requirements for existing pipeline versions without changing records',()=>{
  const m=metadata('G92'),before=structuredClone(m),result=trainingQualificationContext(m);
  expect(result.map(r=>r.programId)).toEqual(['OG15']);
  expect(result[0].requirement).toContain('operator written program');
  expect(m).toEqual(before);
  result[0].requirement='changed by caller';
  expect(trainingQualificationContext(m)[0].requirement).toContain('operator written program');
 });
 it('does not impose unrelated credentials on other course families or policies',()=>{
  expect(trainingQualificationContext(metadata('L01'))).toEqual([]);
  expect(trainingQualificationContext(metadata('G92','policy'))).toEqual([]);
  expect(trainingQualificationContext({kind:'training'})).toEqual([]);
  expect(trainingQualificationContext(metadata('__proto__'))).toEqual([]);
 });
 it('keeps the flagship issuer boundary and validates public context',()=>{
  const items=trainingQualificationContext(metadata('G99'));
  expect(items[0].requirement).toContain('VNDRLY issues its own');
  expect(items[0].requirement).toContain('partner acceptance');
  for(const family of ['G99','G92','H04','H15','G70','C08','C06'])
   for(const item of trainingQualificationContext(metadata(family))) expect(TrainingQualificationContextSchema.safeParse(item).success).toBe(true);
 });
});
