import { formatTrainingTitle } from "@/lib/training-title";
import React from 'react';
import {z} from 'zod/v4';
import {Link} from 'wouter';
import {useLibrary} from './use-library';
const schema=z.object({title:z.string(),people:z.array(z.object({userId:z.number(),name:z.string(),status:z.string(),instanceId:z.string().nullable(),contentVersion:z.number().nullable(),originalPercent:z.number().nullable(),remediatedPercent:z.number().nullable(),examPercent:z.number().nullable()}))});
export default function TrainingCourseReview({itemId}:{itemId:string}){
 const api=useLibrary(`/api/work-hub/library/${itemId}/training-review`,v=>schema.parse(v));
 if(!api.data)return <p role="status">{api.error||'Loading training completion…'}</p>;
 const people=api.data.people,completed=people.filter(p=>p.status==='completed').length;
 const percent=(n:number|null)=>n===null?'—':`${n.toFixed(1)}%`;
 return <section aria-label="Company training compliance" className="space-y-4"><h2 className="text-xl font-bold">REVIEW — {formatTrainingTitle(api.data.title)}</h2><p>{completed} completed · {people.length-completed} not completed</p><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['Person','Completion status','Original score','After remediation','Exam','Record'].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{people.map(p=><tr key={p.userId} className="border-t"><td className="p-2">{p.name}</td><td className="p-2">{p.status.replaceAll('_',' ')}</td><td className="p-2">{percent(p.originalPercent)}</td><td className="p-2">{percent(p.remediatedPercent)}</td><td className="p-2">{percent(p.examPercent)}</td><td className="p-2">{p.instanceId&&<Link className="underline" href={`/work-hub/assignment/${p.instanceId}`}>Review record</Link>}</td></tr>)}</tbody></table></div></section>;
}
