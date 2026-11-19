import { LEGACY_CERTIFICATION_PROGRAM_REFERENCES } from './certification-legacy-references';
import { EXTERNAL_CERTIFICATION_CATALOG } from './external-certification-catalog';
import { CERTIFICATION_PROGRAM_REFERENCES } from './certification-program-references';

import { CERTIFICATION_EXTERNAL_MAPPINGS } from './certification-external-mappings';

// Curriculum counterparts do not grant external credentials or transfer credit.
export type CertificationProgram = typeof CERTIFICATION_PROGRAM_REFERENCES[number] | typeof LEGACY_CERTIFICATION_PROGRAM_REFERENCES[number];
const programsById = new Map<string, CertificationProgram>(
  [...LEGACY_CERTIFICATION_PROGRAM_REFERENCES, ...CERTIFICATION_PROGRAM_REFERENCES].map(program => [program.id, program]),
);
export function certificationProgramById(id: string) {
  return programsById.get(id);
}
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// Resolve the crosswalk once; no company library or assignment lookup is involved.
const programsByName = new Map<string, CertificationProgram>();
for (const {externalCertification:name, programId} of CERTIFICATION_EXTERNAL_MAPPINGS) {
  const program = programsById.get(programId);
  if (!program) throw new Error(`Unknown certification program: ${programId}`);
  programsByName.set(normalize(name), program);
  const credential = EXTERNAL_CERTIFICATION_CATALOG.find(entry => entry.name === name);
  for (const alias of credential?.aliases ?? []) programsByName.set(normalize(alias), program);
}
export function certificationProgram(name: string) {
  return programsByName.get(normalize(name));
}

// Preserve shorthand choices already stored on employee records.
for (const [name, id] of Object.entries({
  'PEC':'VUC001', 'SafeLand USA':'VUC001',
  'H2S Clear':'VUC003', 'H2S Awareness':'VUC003',
  'HazWoper 40':'VUC013', 'CDL Class A':'VUC029', 'Hazmat Endorsement':'VUC029',
})) programsByName.set(normalize(name), programsById.get(id)!);
