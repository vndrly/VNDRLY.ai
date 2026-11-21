import {CatalogCredentialEditSchema} from '@workspace/api-zod/catalog-profile';
import {GATEKEEPING_COURSE,GATEKEEPING_PROGRAM} from './gatekeeping-training';
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db} from '@workspace/db';
import {z} from 'zod/v4';
import {vndrlyUCatalog} from '../data/vndrly-u-catalog';
import {libraryAuthority,LibraryError,type LibraryActor,type LibraryTx} from './library-core';
import {companyLibraryPeople,expandLibraryAudience} from './library-audience';
import {queueCampaignNotice} from './form-campaign-service';
import {pausedNotificationUserIds} from '../lib/notification-company-hold';
import onlineInstruction from '../data/online-instruction.json';
import onlineCertifications from '../data/online-certifications.json';
import {onlineExamAction,onlineExamRead,type OnlineCertificationProgress} from './online-certification';
import {instructionAction,instructionRead,type InstructionCourse,type InstructionProgress} from './online-instruction';

const instructionCourses=new Map(onlineInstruction.courses.map(c=>[c.id,c as InstructionCourse]));
export function completedCatalogInstruction(courseId:string, progress:InstructionProgress|undefined) {
 const course=instructionCourses.get(courseId);
 return !!course && !!progress && progress.version===course.version && course.sessions.length>0 &&
  course.sessions.every(s=>progress.reviewed.includes(s.id)&&s.checks.every(q=>progress.responses[q.id]?.attempts.some(a=>a.correct)));
}

export async function readCatalogExam(actor:LibraryActor,programId:string){
 const exam=onlineCertifications.exams.find(e=>e.programId===programId);
 if(!exam)return {available:false,assigned:false};
 const {owner}=await libraryAuthority(db,actor),target=catalogTarget(programId);
 const assigned=await db.execute(sql`SELECT course_id FROM vndrly_u_assignments WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId}`);
 const eligible=target.courseIds.every(id=>assigned.rows.some(r=>r.course_id===id));
 const record=await db.execute(sql`SELECT progress FROM vndrly_u_certifications WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId} AND program_id=${programId}`);
 return {available:true,assigned:eligible,...onlineExamRead(exam,(record.rows[0]?.progress as OnlineCertificationProgress|undefined)??null)};
}
export async function updateCatalogExam(actor:LibraryActor,programId:string,input:unknown){
 const exam=onlineCertifications.exams.find(e=>e.programId===programId);
 if(!exam)throw new LibraryError('Certification examination not found',404);
 return db.transaction(async tx=>{
  const {owner}=await libraryAuthority(tx,actor),target=catalogTarget(programId);
  const assigned=await tx.execute(sql`SELECT course_id,progress FROM vndrly_u_assignments WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId} FOR SHARE`);
  if(!target.courseIds.every(id=>assigned.rows.some(r=>r.course_id===id)))throw new LibraryError('This certification is not assigned to you',403);
  if(programId==='VUC116' && !target.courseIds.every(id=>completedCatalogInstruction(id,(assigned.rows.find(r=>r.course_id===id)?.progress as {instruction?:InstructionProgress}|undefined)?.instruction)))
   throw new LibraryError('Complete Gatekeeping and the other Site Security components before the final examination',409);
  await tx.execute(sql`INSERT INTO vndrly_u_certifications(id,owner_type,owner_id,user_id,program_id,progress) VALUES(${randomUUID()},${owner.type},${owner.id},${actor.userId},${programId},${JSON.stringify({attempts:[]})}::jsonb) ON CONFLICT(owner_type,owner_id,user_id,program_id) DO NOTHING`);
  const result=await tx.execute(sql`SELECT id,progress FROM vndrly_u_certifications WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId} AND program_id=${programId} FOR UPDATE`);
  const record=result.rows[0];let next:OnlineCertificationProgress;
  try{next=onlineExamAction(exam,record.progress as OnlineCertificationProgress,input,new Date().toISOString());}
  catch(error){throw new LibraryError(error instanceof Error?error.message:'Invalid examination action',400);}
  await tx.execute(sql`UPDATE vndrly_u_certifications SET progress=${JSON.stringify(next)}::jsonb,updated_at=now() WHERE id=${record.id}`);
  return {available:true,assigned:true,...onlineExamRead(exam,next)};
 });
}
export async function readCatalogInstruction(actor:LibraryActor,courseId:string){
 const course=instructionCourses.get(courseId);
 if(!course)return {available:false,assigned:false};
 const {owner}=await libraryAuthority(db,actor);
 const result=await db.execute(sql`SELECT progress FROM vndrly_u_assignments WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId} AND course_id=${courseId}`);
 const row=result.rows[0];
 const progress=(row?.progress as {instruction?:InstructionProgress}|undefined)?.instruction??null;
 return {available:true,assigned:!!row,...instructionRead(course,progress)};
}
export async function updateCatalogInstruction(actor:LibraryActor,courseId:string,input:unknown){
 const course=instructionCourses.get(courseId);
 if(!course)throw new LibraryError('Online instruction is not available for this course yet',404);
 return db.transaction(async tx=>{
  const {owner}=await libraryAuthority(tx,actor);
  const result=await tx.execute(sql`SELECT id,progress FROM vndrly_u_assignments WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId} AND course_id=${courseId} FOR UPDATE`);
  const row=result.rows[0];
  if(!row)throw new LibraryError('This course is not assigned to you',403);
  const previous=(row.progress??{}) as {instruction?:InstructionProgress};
  let next:ReturnType<typeof instructionAction>;
  try{next=instructionAction(course,previous.instruction??null,input,new Date().toISOString());}
  catch(error){throw new LibraryError(error instanceof Error?error.message:'Invalid learning action',400);}
  await tx.execute(sql`UPDATE vndrly_u_assignments SET progress=${JSON.stringify({...previous,instruction:next.progress})}::jsonb,updated_at=now() WHERE id=${row.id}`);
  if(courseId===GATEKEEPING_COURSE && completedCatalogInstruction(courseId,next.progress)) {
   const award={attempts:[],credential:{id:randomUUID(),awardedAt:next.progress.updatedAt,programId:GATEKEEPING_PROGRAM}};
   await tx.execute(sql`INSERT INTO vndrly_u_certifications(id,owner_type,owner_id,user_id,program_id,progress)
    VALUES(${randomUUID()},${owner.type},${owner.id},${actor.userId},${GATEKEEPING_PROGRAM},${JSON.stringify(award)}::jsonb)
    ON CONFLICT(owner_type,owner_id,user_id,program_id) DO UPDATE SET
      progress=vndrly_u_certifications.progress || jsonb_build_object('credential',EXCLUDED.progress->'credential'),updated_at=now()
    WHERE vndrly_u_certifications.progress->'credential' IS NULL`);
  }
  return {available:true,assigned:true,...instructionRead(course,next.progress),feedback:next.feedback};
 });
}

export function catalogTarget(id:string) {
 const program=vndrlyUCatalog.programs.find(p=>p.id===id);
 const course=vndrlyUCatalog.courses.find(c=>c.id===id);
 if(!program&&!course)throw new LibraryError('Course or certification not found',404);
 return {id,title:(program??course)!.title,courseIds:program?[...new Set(program.courseIds)]:[id],kind:program?'certification':'course'};
}
const courseById=new Map(vndrlyUCatalog.courses.map(c=>[c.id,c]));

export async function catalogTrainingState(actor:LibraryActor) {
 const {owner,member}=await libraryAuthority(db,actor);
 const assignments=await db.execute(sql`SELECT id,course_id AS "courseId",sources,progress FROM vndrly_u_assignments WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId}`);
 const requests=await db.execute(sql`SELECT id,target_id AS "targetId",status,reason FROM vndrly_u_training_requests WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId} ORDER BY created_at DESC`);
 const awards=await db.execute(sql`SELECT program_id AS "programId",progress FROM vndrly_u_certifications WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId}`);
 const courses=assignments.rows.flatMap(row=>{
  const course=courseById.get(String(row.courseId));if(!course)return [];
  const progress=(row.progress??{}) as {reviewed?:string[];completedAt?:string;score?:number;instruction?:InstructionProgress};
  const instruction=instructionCourses.get(course.id),saved=progress.instruction;
  const benchmarks=instruction?instruction.sessions.map(session=>({id:session.id,title:session.title,
   complete:!!saved?.reviewed.includes(session.id)&&session.checks.every(q=>saved?.responses[q.id]?.attempts.some(a=>a.correct)),
   reviewedAt:saved?.reviewed.includes(session.id)?saved.updatedAt:null,
  })):course.lessons.map(lesson=>({id:lesson.id,title:lesson.title,complete:!!progress.reviewed?.includes(lesson.id),reviewedAt:progress.reviewed?.includes(lesson.id)?progress.completedAt??null:null}));
  const percent=benchmarks.length?Math.round(100*benchmarks.filter(b=>b.complete).length/benchmarks.length):0;
  return [{id:course.id,title:course.title,sources:row.sources as string[],percent,benchmarks,completedAt:progress.completedAt??null,score:progress.score??null}];
 });
 const programs=vndrlyUCatalog.programs.filter(p=>courses.some(c=>c.sources.includes(p.id)) || p.id===GATEKEEPING_PROGRAM && courses.some(c=>c.id===GATEKEEPING_COURSE)).map(p=>{
  const members=p.courseIds.map(id=>courses.find(c=>c.id===id)).filter((c):c is typeof courses[number]=>!!c);
  const award=awards.rows.find(a=>a.programId===p.id)?.progress as (OnlineCertificationProgress & {credential?:{expiresAt?:string};profileRecord?:{certNumber:string;awardedAt:string|null;expiresAt:string|null;removedAt?:string}})|undefined;
  const percent=p.courseIds.length?Math.round(members.reduce((sum,c)=>sum+c.percent,0)/p.courseIds.length):0;
  const exam=onlineCertifications.exams.some(e=>e.programId===p.id);
  return {id:p.id,title:p.title,parentProgramId:p.parentProgramId,percent,complete:percent===100&&(!exam||!!award?.credential),certNumber:award?.profileRecord?.certNumber??'',profileHidden:!!award?.profileRecord?.removedAt,expiresAt:award?.profileRecord&&'expiresAt' in award.profileRecord?award.profileRecord.expiresAt:award?.credential?.expiresAt??null,awardedAt:award?.profileRecord&&'awardedAt' in award.profileRecord?award.profileRecord.awardedAt:award?.credential?.awardedAt??null,score:award?.attempts.at(-1)?.score??null,courses:members};
 });
 return {canManage:member.role==='admin',assignments:assignments.rows,requests:requests.rows,programs,courses};
}

async function assignTarget(tx:LibraryTx,actor:LibraryActor,targetId:string,userIds:number[]) {
 const {owner,people,excluded}=await expandLibraryAudience(tx,actor,{mode:'selected',userIds,groupIds:[]});
 if(excluded.length)throw new LibraryError('Recipient is not in this company',400);
 const target=catalogTarget(targetId);
 const held=await pausedNotificationUserIds(people.map(person=>person.userId));
 for(const person of people)for(const courseId of target.courseIds) {
  if(!courseById.has(courseId))throw new LibraryError('Certification course not found',409);
  const sources=JSON.stringify([targetId]);
  const result=await tx.execute(sql`INSERT INTO vndrly_u_assignments(id,owner_type,owner_id,user_id,course_id,sources,assigned_by)
    VALUES(${randomUUID()},${owner.type},${owner.id},${person.userId},${courseId},${sources}::jsonb,${actor.userId})
    ON CONFLICT(owner_type,owner_id,user_id,course_id) DO UPDATE SET
    sources=(SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(vndrly_u_assignments.sources || EXCLUDED.sources)),updated_at=now()
    RETURNING id`);
  if(!held.has(person.userId))await queueCampaignNotice(tx,{userIds:[person.userId],key:`catalog-assigned:${result.rows[0].id}:${targetId}`,title:'Training assigned',body:target.title,link:`/work-hub/course/${courseId}`,at:new Date()});
 }
 return {assigned:people.length,targetId};
}

export async function assignCatalogTraining(actor:LibraryActor,input:unknown) {
 const data=z.object({targetId:z.string(),audience:z.unknown()}).parse(input);
 return db.transaction(async tx=>{
  const audience=await expandLibraryAudience(tx,actor,data.audience);
  return assignTarget(tx,actor,data.targetId,audience.people.map(p=>p.userId));
 });
}

export async function requestCatalogTraining(actor:LibraryActor,input:unknown) {
 const {targetId}=z.object({targetId:z.string()}).parse(input),target=catalogTarget(targetId);
 return db.transaction(async tx=>{
  const {owner}=await libraryAuthority(tx,actor);
  const result=await tx.execute(sql`INSERT INTO vndrly_u_training_requests(id,owner_type,owner_id,user_id,target_id)
    VALUES(${randomUUID()},${owner.type},${owner.id},${actor.userId},${targetId})
    ON CONFLICT(owner_type,owner_id,user_id,target_id) WHERE status='pending' DO NOTHING RETURNING id`);
  if(result.rows.length) {
   const admins=(await companyLibraryPeople(tx,owner)).filter(p=>p.role==='admin');
   await queueCampaignNotice(tx,{userIds:admins.map(p=>p.userId),key:`training-request:${result.rows[0].id}`,title:'Training requested',body:target.title,link:'/work-hub/training-requests',at:new Date()});
  }
  return {status:'pending'};
 });
}

export async function catalogTrainingRequests(actor:LibraryActor) {
 const {owner}=await libraryAuthority(db,actor,true);
 const result=await db.execute(sql`SELECT r.id,r.user_id AS "userId",u.display_name AS "name",r.target_id AS "targetId",r.status,r.reason,r.created_at AS "createdAt"
 FROM vndrly_u_training_requests r JOIN users u ON u.id=r.user_id
 WHERE r.owner_type=${owner.type} AND r.owner_id=${owner.id} ORDER BY r.created_at DESC`);
 return {items:result.rows.map(row=>({...row,target:catalogTarget(String(row.targetId))})),pending:result.rows.filter(r=>r.status==='pending').length};
}

export async function reviewCatalogTrainingRequest(actor:LibraryActor,id:string,input:unknown) {
 z.uuid().parse(id);
 const data=z.object({action:z.enum(['approve','decline']),reason:z.string().max(2000).optional()}).parse(input);
 return db.transaction(async tx=>{
  const {owner}=await libraryAuthority(tx,actor,true,true);
  const result=await tx.execute(sql`SELECT * FROM vndrly_u_training_requests WHERE id=${id} AND owner_type=${owner.type} AND owner_id=${owner.id} FOR UPDATE`);
  const request=result.rows[0];if(!request)throw new LibraryError('Training request not found',404);
  if(request.status!=='pending')return {status:request.status};
  if(data.action==='approve')await assignTarget(tx,actor,String(request.target_id),[Number(request.user_id)]);
  const status=data.action==='approve'?'approved':'declined';
  await tx.execute(sql`UPDATE vndrly_u_training_requests SET status=${status},reason=${data.reason??null},reviewed_by=${actor.userId},reviewed_at=now() WHERE id=${id}`);
  await queueCampaignNotice(tx,{userIds:[Number(request.user_id)],key:`training-request-reviewed:${id}`,title:`Training request ${status}`,body:catalogTarget(String(request.target_id)).title,link:`/work-hub/${String(request.target_id).includes('-')?'course':'bundle'}/${request.target_id}`,at:new Date()});
  return {status};
 });
}

export async function saveCatalogReview(actor:LibraryActor,courseId:string,input:unknown) {
 const course=courseById.get(courseId);if(!course)throw new LibraryError('Course not found',404);
 const {lessonId}=z.object({lessonId:z.string()}).parse(input);
 if(!course.lessons.some(l=>l.id===lessonId))throw new LibraryError('Lesson not found',400);
 return db.transaction(async tx=>{
  const {owner}=await libraryAuthority(tx,actor);
  const result=await tx.execute(sql`SELECT id,progress FROM vndrly_u_assignments WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId} AND course_id=${courseId} FOR UPDATE`);
  const row=result.rows[0];if(!row)throw new LibraryError('This course is not assigned to you',403);
  const progress=(row.progress??{}) as {reviewed?:string[];startedAt?:string};
  const next={...progress,startedAt:progress.startedAt??new Date().toISOString(),reviewed:[...new Set([...(progress.reviewed??[]),lessonId])]};
  await tx.execute(sql`UPDATE vndrly_u_assignments SET progress=${JSON.stringify(next)}::jsonb,updated_at=now() WHERE id=${row.id}`);
  return {progress:next};
 });
}

/** Profile record changes preserve assessment attempts, awards and course evidence. */
export async function updateCatalogCredential(actor:LibraryActor,programId:string,input:unknown,remove=false) {
 const target=catalogTarget(programId);
 if(target.kind!=='certification')throw new LibraryError('Certification not found',404);
 const data=remove?null:CatalogCredentialEditSchema.parse(input);
 return db.transaction(async tx=>{
  const {owner}=await libraryAuthority(tx,actor);
  const records=await tx.execute(sql`SELECT id,progress FROM vndrly_u_certifications WHERE owner_type=${owner.type} AND owner_id=${owner.id} AND user_id=${actor.userId} AND program_id=${programId} FOR UPDATE`);
  const record=records.rows[0];
  if(!record)throw new LibraryError('Certification record not found',404);
  const previous=record.progress as OnlineCertificationProgress & {profileRecord?:Record<string,unknown>};
  if(!previous.credential)throw new LibraryError('Certification has not been awarded',409);
  const profileRecord=remove?{...previous.profileRecord,removedAt:new Date().toISOString()}:data;
  await tx.execute(sql`UPDATE vndrly_u_certifications SET progress=${JSON.stringify({...previous,profileRecord})}::jsonb,updated_at=now() WHERE id=${record.id} AND user_id=${actor.userId}`);
  return {saved:true};
 });
}
