import { CERTIFICATION_EQUIVALENTS, certificationProgramById } from '@workspace/api-zod/certification-program-links';
type Progress = { id: string; title: string; complete: boolean; standalone?: boolean; groupingOnly?: boolean };
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
/** Only explicit VNDRLY/U certification assignments determine these logos. */
export function certificationLogoStatuses(certifications: Progress[]) {
  const result: Record<string, 'assigned' | 'completed'> = {};
  for (const { programId } of CERTIFICATION_EQUIVALENTS) {
    const program = certificationProgramById(programId);
    if (!program) continue;
    const matches = certifications.filter(c => !c.standalone && !c.groupingOnly &&
      (c.id === programId || normalize(c.title) === normalize(program.title)));
    if (matches.length) result[programId] = matches.every(c => c.complete) ? 'completed' : 'assigned';
  }
  return result;
}
