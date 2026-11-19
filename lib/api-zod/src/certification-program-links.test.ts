import { expect, it } from 'vitest';
import { certificationProgram, certificationProgramById } from './certification-program-links';
import { EXTERNAL_CERTIFICATION_CATALOG } from './external-certification-catalog';
import { CERTIFICATION_PROGRAM_REFERENCES } from './certification-program-references';
import { CERTIFICATION_EXTERNAL_MAPPINGS } from './certification-external-mappings';
it('maps all 114 external credentials and aliases to distinct curriculum counterparts', () => {
 expect(EXTERNAL_CERTIFICATION_CATALOG).toHaveLength(114);
 expect(CERTIFICATION_EXTERNAL_MAPPINGS).toHaveLength(114);
 const ids = new Set();
 for (const credential of EXTERNAL_CERTIFICATION_CATALOG) {
  const program = certificationProgram(credential.name)!;
  expect(program, credential.name).toBeDefined();
  expect(certificationProgramById(program.id)).toBe(program);
  expect(program.courses.length).toBeGreaterThan(0);
  for (const alias of credential.aliases ?? []) expect(certificationProgram(alias)).toBe(program);
  ids.add(program.id);
 }
 expect(ids.size).toBe(114);
});
it('keeps all constituent courses connected and the umbrella separate', () => {
 expect(CERTIFICATION_PROGRAM_REFERENCES).toHaveLength(116);
 expect(certificationProgramById('VUC116')?.title).toContain('Site Security');
 expect(certificationProgramById('VUC115')?.title).toContain('Umbrella');
 expect(new Set(CERTIFICATION_PROGRAM_REFERENCES.flatMap(p=>p.courses.map(c=>c.id))).size).toBe(651);
 expect(CERTIFICATION_EXTERNAL_MAPPINGS.some(m=>String(m.programId)==='VUC115')).toBe(false);
});
it.each([
 ['OPITO 9014','VUC051'],['OPITO 9240','VUC084'],['API 510 Pressure Vessel Inspector','VUC035'],
 ['API 570 Piping Inspector','VUC036'],['CCO Rigger Level II','VUC026'],
 ['IADC WellSharp Well Servicing','VUC006'],['IWCF Drilling Well Control','VUC007'],
 ['AMPP Cathodic Protection Specialist (CP4)','VUC110'],['ASNT NDT Level III','VUC046'],
])('preserves the specialty for %s', (name,id)=>expect(certificationProgram(name)?.id).toBe(id));
it.each(['Unknown certification','javascript:bad'])('does not invent mapping for %s',name=>expect(certificationProgram(name)).toBeUndefined());
it('normalizes whitespace and case',()=>expect(certificationProgram('  api 510 pressure vessel inspector  ')?.id).toBe('VUC035'));
