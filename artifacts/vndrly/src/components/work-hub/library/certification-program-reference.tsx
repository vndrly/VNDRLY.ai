import type { CertificationProgram } from '@workspace/api-zod/certification-program-links';
import { useTranslation } from 'react-i18next';

/** The existing program definition, independent of company assignments and completion records. */
export default function CertificationProgramReference({program}: {program: CertificationProgram}) {
  const {i18n} = useTranslation();
  return <article className="min-w-0 space-y-4 rounded-xl border-2 border-[var(--brand-primary)] bg-[#242426] p-4 text-[#ececec]" data-testid="certification-program-reference">
    <h2 className="break-words text-xl font-bold">{program.title}</h2>
    <p className="whitespace-pre-line break-words text-sm leading-6">{program.description}</p>
    <h3 className="font-bold">{i18n.language.startsWith('es') ? 'Cursos incluidos' : 'Included courses'}</h3>
    <ul>{program.courses.map(course => <li key={course.id} className="border-t border-white/10 py-3 text-sm">{course.title}</li>)}</ul>
  </article>;
}
