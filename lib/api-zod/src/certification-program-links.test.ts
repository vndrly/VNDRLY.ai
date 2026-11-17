import { expect, it } from 'vitest';
import { certificationProgram, certificationProgramById } from './certification-program-links';
import { EXTERNAL_CERTIFICATION_CATALOG } from './external-certification-catalog';
it('links the flagship and its aliases directly without a company lookup', () => {
  for (const name of ['PEC / Veriforce Basic Orientation (SafeLandUSA)', 'SafeLandUSA', 'PEC Basic Orientation', 'SafeLand USA', '  pec  ']) {
    expect(certificationProgram(name)).toMatchObject({id:'OG01',title:'VNDRLY/U | Energy Safety Core | Field Safety Orientation'});
  }
});
it.each([
  ['OPITO 9014','OG03'], ['OPITO 9240','OG28'],
  ['API 510 Pressure Vessel Inspector','OG20'], ['API 570 Piping Inspector','OG21'],
  ['CCO Rigger Level II','OG33'], ['CCO Signalperson','OG32'],
  ['IADC WellSharp Well Servicing','OG16'], ['IWCF Drilling Well Control','OG42'],
  ['CDL Class A','OG13'], ['Hazmat Endorsement','OG13'],
  ['H2S Awareness','OG03'], ['H2S Clear','OG03'], ['HazWoper 40','OG10'],
])('routes %s to the specific existing program %s', (name,id) => {
  expect(certificationProgram(name)?.id).toBe(id);
});
it('resolves every mapped choice and its aliases to an existing program with courses', () => {
  const mapped = EXTERNAL_CERTIFICATION_CATALOG.filter(c => certificationProgram(c.name));
  expect(mapped).toHaveLength(43);
  for (const credential of mapped) {
    const program = certificationProgram(credential.name)!;
    expect(certificationProgramById(program.id)).toBe(program);
    expect(program.courses.length).toBeGreaterThan(0);
    for (const alias of credential.aliases ?? []) expect(certificationProgram(alias)).toBe(program);
  }
});
it.each(['AMPP Cathodic Protection Specialist (CP4)', 'API 577 Welding Inspection and Metallurgy',
  'OSHA Outreach 10-Hour Construction', 'CCO Tower Crane Operator', 'ASNT NDT Level III',
  'Respirator Fit Test', 'Unknown certification', 'javascript:bad'])(
  'does not substitute a different specialty for %s', name => {
    expect(certificationProgram(name)).toBeUndefined();
  },
);
it('rejects unknown program IDs', () => {
  expect(certificationProgramById('OG99')).toBeUndefined();
});
