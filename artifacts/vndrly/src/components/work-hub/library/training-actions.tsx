import React from 'react';
import {useLocation} from 'wouter';
import {Pill} from './editor-controls';
export type TrainingView='policy'|'review'|'training'|'assign';
export function TrainingActions({itemId,selected,canManage=true}:{itemId:string;selected?:TrainingView;canManage?:boolean}){
 const [,navigate]=useLocation();
 return <nav aria-label="Training controls" className="flex flex-wrap gap-2">{(['policy','review','training','assign'] as const).filter(view=>canManage||view==='training').map(view=><Pill key={view} color="blue" solid={selected===view} onPress={()=>navigate(`/work-hub/library/${itemId}?view=${view}`)}>{view.toUpperCase()}</Pill>)}</nav>;
}
