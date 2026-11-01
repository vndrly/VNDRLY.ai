import React from 'react';
import {Link,useLocation} from 'wouter';
import {Pill} from './editor-controls';

export type TrainingView='policy'|'review'|'training'|'assign';
export function TrainingActions({itemId,selected,canManage=true,appearance='pills'}:{itemId:string;selected?:TrainingView;canManage?:boolean;appearance?:'pills'|'links'}){
 const [,navigate]=useLocation();
 return <nav aria-label="Training controls" className="flex flex-wrap gap-2">{(['policy','review','training'] as const).filter(view=>(canManage||view==='training')).map(view=>appearance==='links'?<Link key={view} href={`/work-hub/library/${itemId}?view=${view}`} className="inline-flex min-h-8 items-center justify-center rounded-md border border-[var(--brand-primary)] px-3 py-1.5 text-xs font-semibold no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--brand-primary)_14%,transparent)] hover:text-[var(--brand-primary)]" aria-current={selected===view?'page':undefined}>{view.toUpperCase()}</Link>:<Pill key={view} color="blue" solid={selected===view} onPress={()=>navigate(`/work-hub/library/${itemId}?view=${view}`)}>{view.toUpperCase()}</Pill>)}</nav>;
}
