/** Proposal policy only. Inputs must come from current authorized canonical reads;
 * this pure function cannot certify authorization, send invitations or execute writes. */
import { z } from 'zod';
export interface CalendarCommitment {
 occurrenceId:string; startsAt:string; endsAt:string; timezone:string;
 mustKeep:boolean; priority:number|null; travelMinutes:number|null;
 participantUserIds:number[]; dependencies:string[];
 openings?:{source:'find_work_hub_meeting_times';participantUserIds:number[];slots:{startsAt:string;endsAt:string}[]};
 contact?:{channelId:string;body:string;invitationSaved:boolean;reply:'unknown'|'unanswered'|'accepted'|'declined';startsAt:string;endsAt:string};
}
export interface CalendarPolicyInput {now:string;planningTimezone:string|null;closeOfBusiness:string|null;commitments:CalendarCommitment[]}
export interface CalendarProposal {toolName:'manage_work_hub_meeting'|'send_work_hub_message';arguments:Record<string,unknown>}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp=z.string().max(40).refine(s=>/Z$/.test(s)&&Number.isFinite(Date.parse(s)));
const commitmentSchema=z.object({occurrenceId:z.string().regex(uuid),startsAt:timestamp,endsAt:timestamp,timezone:z.string().min(1).max(100),mustKeep:z.boolean(),priority:z.number().finite().nullable(),travelMinutes:z.number().int().min(0).max(1440).nullable(),participantUserIds:z.array(z.number().int().positive()).max(100),dependencies:z.array(z.string().regex(uuid)).max(20),openings:z.object({source:z.literal('find_work_hub_meeting_times'),participantUserIds:z.array(z.number().int().positive()).max(100),slots:z.array(z.object({startsAt:timestamp,endsAt:timestamp}).strict()).max(10)}).strict().optional(),contact:z.object({channelId:z.string().regex(uuid),body:z.string().min(1).max(12000),invitationSaved:z.boolean(),reply:z.enum(['unknown','unanswered','accepted','declined']),startsAt:timestamp,endsAt:timestamp}).strict().optional()}).strict();
export const CalendarPolicyInputSchema=z.object({now:timestamp,planningTimezone:z.string().max(100).nullable(),closeOfBusiness:z.string().max(5).nullable(),commitments:z.array(commitmentSchema).min(1).max(20)}).strict();
const instant=(s:string)=>/Z$/.test(s)&&Number.isFinite(Date.parse(s));
function parts(at:number,timezone:string){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));}
function deadline(now:string,timezone:string,clock:string){
 if(!instant(now)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock))throw Error('deadline');
 const p=parts(Date.parse(now),timezone);const tomorrow=new Date(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day)+1));
 const date=tomorrow.toISOString().slice(0,10),center=Date.parse(`${date}T${clock}:00Z`),matches:number[]=[];
 // Resolve actual IANA offsets, including half/quarter-hour zones. Ambiguous local times refuse.
 for(let delta=-14*60;delta<=14*60;delta++){const candidate=center+delta*60000,q=parts(candidate,timezone);if(`${q.year}-${q.month}-${q.day}`===date&&`${q.hour}:${q.minute}`===clock)matches.push(candidate);}
 if(matches.length!==1)throw Error('ambiguous deadline');return matches[0]!;
}
export function proposeCalendarPlan(raw:unknown){
 const proposals:CalendarProposal[]=[],contacts:{occurrenceId:string;state:'proposal'|'invitation_sent'|'accepted'|'unanswered'|'declined'}[]=[];
 const result=(state:'proposed'|'needs_info'|'priority_order_no_slot',issues:string[],end?:number)=>({state,issues,deadline:end===undefined?null:new Date(end).toISOString(),executionStarted:false as const,limitation:'Priority-first earliest-slot proposal; global feasibility is not established. Current authority and all saved evidence must be rechecked before preparation.',proposals:state==='proposed'?proposals:[],contacts});
 const parsed=CalendarPolicyInputSchema.safeParse(raw);if(!parsed.success)return result('needs_info',['Provide valid bounded canonical calendar observations.']);const input=parsed.data;
 let end:number;try{if(!input.planningTimezone||!input.closeOfBusiness)throw Error();end=deadline(input.now,input.planningTimezone,input.closeOfBusiness);}catch{return result('needs_info',['Provide an unambiguous planning timezone and close-of-business time.']);}
 if(!input.commitments.length||input.commitments.length>20)return result('needs_info',['Provide one to twenty exact saved commitments.'],end);
 const byId=new Map(input.commitments.map(c=>[c.occurrenceId,c]));
 if(byId.size!==input.commitments.length)return result('needs_info',['Duplicate occurrence IDs.'],end);
 for(const c of input.commitments){
  try{parts(Date.parse(input.now),c.timezone);}catch{return result('needs_info',['Provide each saved commitment timezone.'],end);}
  if(!uuid.test(c.occurrenceId)||!instant(c.startsAt)||!instant(c.endsAt)||Date.parse(c.endsAt)<=Date.parse(c.startsAt)||typeof c.mustKeep!=='boolean'||c.travelMinutes===null||!Number.isInteger(c.travelMinutes)||c.travelMinutes<0||c.travelMinutes>1440||(!c.mustKeep&&(c.priority===null||!Number.isFinite(c.priority)))||c.dependencies.some(d=>!byId.has(d)||d===c.occurrenceId))return result('needs_info',['Supply exact saved IDs, times, must-keep, priority, travel and dependencies.'],end);
  if(!c.mustKeep&&(!c.openings||c.openings.source!=='find_work_hub_meeting_times'||c.openings.slots.length>10||!c.participantUserIds.length||c.participantUserIds.length>100||c.participantUserIds.some(id=>!Number.isInteger(id)||id<=0)||new Set(c.participantUserIds).size!==c.participantUserIds.length||[...c.participantUserIds].sort().join(',')!==[...c.openings.participantUserIds].sort().join(',')))return result('needs_info',['Read current openings for exactly the saved participants.'],end);
  if(c.contact&&(typeof c.contact.invitationSaved!=='boolean'||!['unknown','unanswered','accepted','declined'].includes(c.contact.reply)||!instant(c.contact.startsAt)||!instant(c.contact.endsAt)||!uuid.test(c.contact.channelId)||!c.contact.body.trim()||c.contact.body.length>12000))return result('needs_info',['Provide an exact authorized contact channel and proposed message.'],end);
 }
 const placed=new Map(input.commitments.filter(c=>c.mustKeep).map(c=>[c.occurrenceId,{start:Date.parse(c.startsAt),end:Date.parse(c.endsAt),travel:c.travelMinutes!}]));
 const fixed=[...placed.values()];
 for(let i=0;i<fixed.length;i++)for(let j=i+1;j<fixed.length;j++)if(fixed[i]!.start<fixed[j]!.end&&fixed[j]!.start<fixed[i]!.end)return result('needs_info',['Overlapping immutable commitments require an explicit decision.'],end);
 const pending=input.commitments.filter(c=>!c.mustKeep).sort((a,b)=>a.priority!-b.priority!||a.occurrenceId.localeCompare(b.occurrenceId));
 while(pending.length){const index=pending.findIndex(c=>c.dependencies.every(d=>placed.has(d)));if(index<0)return result('needs_info',['Dependency cycle or unsatisfied immutable dependency.'],end);const c=pending.splice(index,1)[0]!;
  const duration=Date.parse(c.endsAt)-Date.parse(c.startsAt);const slot=[...c.openings!.slots].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)).find(s=>{
   if(!instant(s.startsAt)||!instant(s.endsAt))return false;const start=Date.parse(s.startsAt),finish=Date.parse(s.endsAt),buffer=c.travelMinutes!*60000;
   return finish-start===duration&&start>=Date.parse(input.now)&&finish<=end&&c.dependencies.every(d=>placed.get(d)!.end+buffer<=start)&&[...placed.values()].every(p=>finish+buffer<=p.start||start>=p.end+p.travel*60000);
  });
  if(!slot)return result('priority_order_no_slot',[`No recorded opening fits commitment ${c.occurrenceId}, travel, dependencies and deadline.`],end);
  placed.set(c.occurrenceId,{start:Date.parse(slot.startsAt),end:Date.parse(slot.endsAt),travel:c.travelMinutes!});
  proposals.push({toolName:'manage_work_hub_meeting',arguments:{action:'reschedule',occurrenceId:c.occurrenceId,payload:{startsAt:slot.startsAt,endsAt:slot.endsAt,timezone:c.timezone}}});
  if(c.contact){const matching=Date.parse(c.contact.startsAt)===Date.parse(slot.startsAt)&&Date.parse(c.contact.endsAt)===Date.parse(slot.endsAt);const state=!matching?'proposal':c.contact.reply==='accepted'||c.contact.reply==='unanswered'||c.contact.reply==='declined'?c.contact.reply:c.contact.invitationSaved?'invitation_sent':'proposal';contacts.push({occurrenceId:c.occurrenceId,state});if(state==='proposal'&&!c.contact.invitationSaved&&c.contact.reply==='unknown')proposals.push({toolName:'send_work_hub_message',arguments:{channelId:c.contact.channelId,body:c.contact.body}});}
 }
 // Immutable commitments cannot be moved to repair impossible dependency order.
 for(const c of input.commitments.filter(c=>c.mustKeep))if(c.dependencies.some(d=>placed.get(d)!.end+c.travelMinutes!*60000>placed.get(c.occurrenceId)!.start))return result('priority_order_no_slot',['An immutable commitment conflicts with its dependencies.'],end);
 return result('proposed',[],end);
}
