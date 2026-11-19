import {CatalogCourseRow} from './vndrly-u-catalog';
import {CERTIFICATION_EQUIVALENTS} from '@workspace/api-zod/certification-program-links';
import type { CertificationProgram } from '@workspace/api-zod/certification-program-links';
import { useTranslation } from 'react-i18next';

/** The existing program definition, independent of company assignments and completion records. */
export default function CertificationProgramReference({program}: {program: CertificationProgram}) {
  const {i18n} = useTranslation();
  const equivalent=CERTIFICATION_EQUIVALENTS.find(m=>m.programId===program.id)?.externalCertification;
  return <article className="min-w-0 space-y-4 rounded-xl border-2 border-[var(--brand-primary)] bg-[#242426] p-4 text-[#ececec]" data-testid="certification-program-reference">
    <h2 className="break-words text-xl font-bold">{program.title}</h2>
    {equivalent&&<p>Equivalent certification: {equivalent}</p>}
    {!/^VUC/.test(program.id)&&<p className="whitespace-pre-line break-words text-sm leading-6">{program.description}</p>}
    <h3 className="font-bold">{i18n.language.startsWith('es') ? 'Cursos incluidos' : 'Included courses'}</h3>
    <div>{program.courses.map(course => /^VUC/.test(course.id)?<CatalogCourseRow key={course.id} {...course}/>:<p key={course.id}>{course.title}</p>)}</div>
  </article>;
}
