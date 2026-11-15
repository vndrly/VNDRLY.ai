import { expect, it } from 'vitest';
import { EXTERNAL_CERTIFICATION_CATALOG, searchExternalCredentials } from './external-certification-catalog';
it('provides distinct credential types with scoped evidence fields and official sources',()=>{
 expect(EXTERNAL_CERTIFICATION_CATALOG.length).toBeGreaterThan(50);
 expect(new Set(EXTERNAL_CERTIFICATION_CATALOG.map(c=>c.name)).size).toBe(EXTERNAL_CERTIFICATION_CATALOG.length);
 for(const c of EXTERNAL_CERTIFICATION_CATALOG){expect(c.fields.length).toBeGreaterThan(0);expect(c.source).toMatch(/^https:\/\//);}
 expect(EXTERNAL_CERTIFICATION_CATALOG.find(c=>c.name==='Pipeline Operator Qualification (OQ)')?.fields).toContain('Covered task IDs');
});

it("finds issuer aliases without treating them as canonical matches", () => {
  expect(searchExternalCredentials("H₂S Clear™").map(item => item.name)).toEqual(["Veriforce H2S Clear"]);
  expect(searchExternalCredentials("SafeLandUSA").map(item => item.name)).toContain("PEC / Veriforce Basic Orientation (SafeLandUSA)");
  expect(searchExternalCredentials("API 1184").map(item => item.name)).toEqual(["API 1184 Pipeline Facility Construction Inspector"]);
});

it("distinguishes initial training, competence assessment, and reassessment by product code", () => {
  expect(searchExternalCredentials("OPITO 9067").map(item => item.name)).toEqual(["OPITO Banksman and Slinger Initial Training (9067)"]);
  expect(searchExternalCredentials("OPITO 9068").map(item => item.name)).toEqual(["OPITO Banksman & Slinger Competence Assessment (9068)"]);
  expect(searchExternalCredentials("OPITO 9069").map(item => item.name)).toEqual(["OPITO Banksman & Slinger Competence Reassessment (9069)"]);
});
