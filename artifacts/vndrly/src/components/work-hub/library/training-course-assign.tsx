import React from 'react';
import {z} from 'zod/v4';
import {useLibrary} from './use-library';
import AssignmentReview from './assignment-review';
const schema=z.object({positions:z.array(z.object({id:z.string(),label:z.string(),userIds:z.array(z.number())}))});
export default function TrainingCourseAssign({itemId,onSaved}:{itemId:string;onSaved:()=>Promise<unknown>}){
 const api=useLibrary(`/api/work-hub/library/${itemId}/training-policy`,v=>schema.parse(v));
 if(api.error)return <AssignmentReview kind="training" initialItemId={itemId} onSaved={onSaved}/>;
 if(!api.data)return <p role="status">Loading assignment options…</p>;
 return <section aria-label="Assign this training" className="training-policy-typography space-y-4"><h2 className="text-xl font-bold">ASSIGN</h2><AssignmentReview kind="training" initialItemId={itemId} positions={api.data.positions} onSaved={onSaved}/></section>;
}
