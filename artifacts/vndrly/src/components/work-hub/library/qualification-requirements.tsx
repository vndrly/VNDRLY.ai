import {useTranslation} from 'react-i18next';
import type {z} from 'zod/v4';
import type {TrainingQualificationContextSchema} from '@workspace/api-zod';

export default function QualificationRequirements({items=[]}:{items?:z.infer<typeof TrainingQualificationContextSchema>[]}) {
 const {t}=useTranslation();
 if (!items.length) return null;
 return <details className="rounded-xl border border-[var(--brand-primary)] p-3" data-testid="qualification-requirements">
  <summary className="cursor-pointer font-semibold">{t('trainingQualifications.heading')}</summary>
  <p className="mt-2 text-sm">{t('trainingQualifications.help')}</p>
  {items.map(item=><section key={item.programId} className="mt-3 space-y-2 border-t pt-3">
   <h3 className="font-semibold">{item.title}</h3>
   <p className="text-sm">{item.audience}</p>
   <p>{item.requirement}</p>
   <p className="text-sm">{item.renewal}</p>
   <ul className="list-disc pl-5">{item.sourceUrls.map((url,index)=><li key={url}><a href={url} target="_blank" rel="noopener noreferrer" className="underline">{t('trainingPolicy.scopeSource',{number:index+1})}</a></li>)}</ul>
  </section>)}
 </details>;
}
