import {sql} from 'drizzle-orm';
import {db} from '@workspace/db';
import {AssignmentMetadataSchema,LibraryMetadataSchema} from '@workspace/api-zod';
import {isCanonicalEnergySafetyCourse} from '../work-hub/certification-issuer';
export type CredentialEvidence={name:string;expirationDate:string|null};
const key=(value:string)=>value.trim().toLowerCase().replace(/[\s_-]+/g,' ');
export function assessServiceCredentials(required:string[],evidence:CredentialEvidence[],today=new Date().toISOString().slice(0,10)){
 const requirements=[...new Set(required.map(s=>s.trim()).filter(Boolean))];
 const missing:string[]=[],expired:string[]=[];
 for(const name of requirements){const matches=evidence.filter(c=>key(c.name)===key(name));
 if(!matches.length)missing.push(name);else if(!matches.some(c=>!c.expirationDate||c.expirationDate.slice(0,10)>=today))expired.push(name);}
 return {status:!requirements.length?'not_configured':missing.length||expired.length?'needs_review':'recorded_match',required:requirements,missing,expired,assignmentAllowed:true};
}
export async function serviceCredentialAdvisories(workTypeIds:number[],people:{id:number;userId:number|null;pecCertification:boolean;pecExpirationDate:string|null}[]){
 const work=(await db.execute(sql`SELECT required_certifications,blocking_certifications FROM work_types WHERE id IN (${sql.join(workTypeIds.map(id=>sql`${id}`),sql`,`)})`)).rows;
 const required=work.flatMap(w=>[...(w.required_certifications as string[]??[]),...(w.blocking_certifications as string[]??[])]);
 if(!people.length)return new Map();
 const ids=people.map(p=>p.id);
 const certs=(await db.execute(sql`SELECT employee_id,name,expiration_date FROM employee_certifications WHERE employee_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND deleted_at IS NULL`)).rows;
 const userIds=people.flatMap(p=>p.userId?[p.userId]:[]);
 const training=userIds.length?(await db.execute(sql`SELECT i.assignee_user_id,i.assignment_metadata,t.library_metadata FROM work_hub_form_instances i JOIN work_hub_form_templates t ON t.id=i.template_id WHERE i.assignee_user_id IN (${sql.join(userIds.map(id=>sql`${id}`),sql`,`)})`)).rows:[];
 return new Map(people.map(p=>{
 const evidence:CredentialEvidence[]=certs.filter(c=>c.employee_id===p.id).map(c=>({name:String(c.name),expirationDate:c.expiration_date?String(c.expiration_date):null}));
 if(p.pecCertification)evidence.push({name:'PEC',expirationDate:p.pecExpirationDate});
 for(const row of training.filter(r=>r.assignee_user_id===p.userId)){
 const a=AssignmentMetadataSchema.safeParse(row.assignment_metadata),m=LibraryMetadataSchema.safeParse(row.library_metadata);
 if(!a.success||!m.success||!isCanonicalEnergySafetyCourse(m.data))continue;
 if(a.data.progress.certificationExam?.attempts.some(at=>at.passed&&at.submittedAt&&at.credential?.familyId==='G99'&&at.credential.contentVersion===a.data.contentVersion&&at.credential.contentVersion===m.data.contentVersion&&at.credential.courseSha256===m.data.safetyResource?.sourceSha256))evidence.push({name:'VNDRLY Energy Safety Core',expirationDate:a.data.refresherDueAt??null});
 }
 return [p.id,assessServiceCredentials(required,evidence)] as const;
 }));
}
