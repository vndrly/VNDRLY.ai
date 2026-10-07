import {and,eq,sql} from "drizzle-orm";
import {db,workHubMeetingsTable as meetings,workHubMeetingOccurrencesTable as occurrences,workHubMeetingParticipantsTable as participants,workHubClientOperationsTable as operations,workHubAuditLogTable as audit} from "@workspace/db";
import type {SessionPayload} from "../lib/session";
import {validateAssistantSession} from "../assistant/chatgpt-grant-store";
import {createWorkHubAccess,requireWorkHubCapability} from "../work-hub/context-access";
import {calendarSnapshotSchema} from "./calendar-reschedule";
import {createCalendarResponse} from "./calendar-response";
/** Own recorded RSVP only. This never invokes meeting audio, recording consent or external invitations. */
export function calendarResponseForSession(session:SessionPayload){
 const userId=session.userId;if(!userId||!session.activeMembershipId||!session.sv)throw Error("calendar.forbidden");
 const service=createCalendarResponse({now:()=>new Date(),transaction:(input,actorUserId,run)=>db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`calendar-response:${actorUserId}:${input.operationId}`},0))`);
  const [occurrence]=await tx.select().from(occurrences).where(eq(occurrences.id,input.occurrenceId)).for("update");if(!occurrence)throw Error("calendar.forbidden");
  const [meeting]=await tx.select().from(meetings).where(eq(meetings.id,occurrence.meetingId)).for("update");if(!meeting||!["vendor","partner"].includes(meeting.ownerOrgType))throw Error("calendar.forbidden");
  const people=await tx.select().from(participants).where(eq(participants.occurrenceId,occurrence.id)).for("update"),active=people.filter(person=>!person.removedAt);
  const prior=await tx.select().from(operations).where(and(eq(operations.userId,actorUserId),eq(operations.operationId,input.operationId),eq(operations.commandKind,"calendar.response")));
  if(prior.length>1||prior.length===1&&(prior[0].ownerOrgType!==meeting.ownerOrgType||prior[0].ownerOrgId!==meeting.ownerOrgId||!prior[0].resultJson))throw Error("calendar.operation_conflict");
  const snapshot=calendarSnapshotSchema.parse({occurrenceId:occurrence.id,meetingId:meeting.id,ownerType:meeting.ownerOrgType,ownerId:meeting.ownerOrgId,title:meeting.title,agenda:meeting.agenda,timezone:meeting.timezone,createdById:meeting.createdById,startsAt:occurrence.startsAt.toISOString(),endsAt:occurrence.endsAt?.toISOString()??null,status:occurrence.status,participantUserIds:active.map(person=>person.userId)});
  const history=await tx.execute<{result_json:unknown}>(sql`select distinct on(user_id) result_json from work_hub_client_operations where command_kind='calendar.response' and owner_org_type=${meeting.ownerOrgType} and owner_org_id=${meeting.ownerOrgId} and result_json->>'occurrenceId'=${occurrence.id} and user_id in(select user_id from work_hub_meeting_participants where occurrence_id=${occurrence.id} and removed_at is null) order by user_id,applied_at desc limit 100`);
  return run({snapshot,responses:active.map(person=>({userId:person.userId,response:person.rsvp as "pending"|"accepted"|"declined"})),responseReceipts:history.rows.map(row=>row.result_json),prior:prior[0]?.resultJson??null,
   async authorize(){
    await tx.execute(sql`select id from users where id=${actorUserId} for share`);await tx.execute(sql`select id from user_org_memberships where id=${session.activeMembershipId} for share`);
    const current=await validateAssistantSession(session,tx),own=meeting.ownerOrgType==="vendor"?current.vendorId===meeting.ownerOrgId:current.partnerId===meeting.ownerOrgId;
    if(!own||current.userId!==actorUserId||!active.some(person=>person.userId===actorUserId))throw Error("calendar.forbidden");
    const access=createWorkHubAccess({session:{...current,userId:actorUserId},owner:{type:meeting.ownerOrgType as "vendor"|"partner",id:meeting.ownerOrgId},context:{kind:"organization",id:meeting.ownerOrgId},participant:true});requireWorkHubCapability(access,"channel.read");
    return{canManage:access.capabilities.has("meeting.host")&&(meeting.createdById===actorUserId||current.membershipRole==="admin")};
   },
   async save(receipt){
    await tx.update(participants).set({rsvp:receipt.response}).where(and(eq(participants.occurrenceId,occurrence.id),eq(participants.userId,actorUserId)));
    await tx.insert(operations).values({userId:actorUserId,operationId:input.operationId,commandKind:"calendar.response",ownerOrgType:meeting.ownerOrgType,ownerOrgId:meeting.ownerOrgId,resultJson:receipt,appliedAt:new Date(receipt.recordedAt)});
    await tx.insert(audit).values({actorUserId,ownerOrgType:meeting.ownerOrgType,ownerOrgId:meeting.ownerOrgId,action:"calendar.response",subjectType:"meeting_occurrence",subjectId:occurrence.id,source:"canonical_api",operationId:input.operationId,metadata:receipt});
   },
  });
 })});
 return{execute:(raw:unknown)=>service.execute(raw,userId),readback:(raw:unknown)=>service.readback(raw,userId),inspect:(id:unknown)=>service.inspect(id,userId)};
}
