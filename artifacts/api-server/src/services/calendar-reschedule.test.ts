import { expect, it, vi } from "vitest";
import { calendarRescheduleInputSchema, calendarSnapshotFingerprint, createCalendarReschedule, type CalendarSnapshot } from "./calendar-reschedule";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const saved: CalendarSnapshot = { occurrenceId:id(1), meetingId:id(2), ownerType:"vendor",ownerId:7,title:"Recorded meeting",agenda:null,timezone:"UTC",createdById:9,startsAt:"2026-10-07T10:00:00Z",endsAt:"2026-10-07T11:00:00Z",status:"scheduled",participantUserIds:[9,10] };
const command = { operationId:id(3),occurrenceId:id(1),expectedFingerprint:calendarSnapshotFingerprint(saved),startsAt:"2026-10-08T10:00:00Z",endsAt:"2026-10-08T11:00:00Z",timezone:"UTC" };
function fixture() {
  let snapshot = structuredClone(saved), prior: unknown = null;
  const authorize = vi.fn(async()=>{}), save = vi.fn(async(next:CalendarSnapshot,receipt:unknown)=>{snapshot=next;prior=receipt;});
  const service = createCalendarReschedule({now:()=>new Date("2026-10-07T09:00:00Z"),transaction:async(_input,_actor,run)=>run({snapshot,prior,authorize,save})});
  return { service, authorize, save, replace:(value:CalendarSnapshot)=>{snapshot=value;} };
}
it("saves exactly once and recovers the exact original operation after the schedule changed",async()=>{
 const f=fixture(), first=await f.service.execute(command,9);
 expect(first.receipt).toMatchObject({status:"rescheduled",attendeeAcceptanceVerified:false,externalInvitationsSent:false,snapshot:{startsAt:command.startsAt}});
 expect(await f.service.readback(command,9)).toEqual({...first,replayed:true});
 expect(await f.service.execute(command,9)).toEqual({...first,replayed:true});
 expect(f.save).toHaveBeenCalledTimes(1);expect(f.authorize).toHaveBeenCalledTimes(3);
 await expect(f.service.execute({...command,startsAt:"2026-10-08T09:00:00Z"},9)).rejects.toThrow("operation_conflict");
});
it("rejects stale participants or calendar facts and terminal occurrences without effects",async()=>{
 for(const snapshot of [{...saved,participantUserIds:[9,11]},{...saved,title:"Edited"},{...saved,status:"cancelled"},{...saved,status:"ended"}]) {
  const f=fixture();f.replace(snapshot);await expect(f.service.execute(command,9)).rejects.toThrow();expect(f.save).not.toHaveBeenCalled();
 }
});
it("rechecks authority on saved replay and readback; proven absence never executes",async()=>{
 const f=fixture();expect(await f.service.readback(command,9)).toEqual({receipt:null,replayed:false});expect(f.save).not.toHaveBeenCalled();
 await f.service.execute(command,9);f.authorize.mockRejectedValue(Error("revoked"));
 await expect(f.service.execute(command,9)).rejects.toThrow("revoked");await expect(f.service.readback(command,9)).rejects.toThrow("revoked");expect(f.save).toHaveBeenCalledTimes(1);
});
it("requires exact UTC interval/IANA zone and ignores no extra confirmation or participants",()=>{
 for(const input of [{...command,endsAt:command.startsAt},{...command,timezone:"made-up-zone"},{...command,startsAt:"2026-10-08T10:00:00-05:00"},{...command,confirmed:true},{...command,participantUserIds:[99]}])expect(calendarRescheduleInputSchema.safeParse(input).success).toBe(false);
});
it("returns only authorized exact snapshot evidence without a command or saved effect",async()=>{
 const f=fixture();expect(await f.service.inspect(id(1),9)).toEqual({snapshot:saved,fingerprint:calendarSnapshotFingerprint(saved),executionStarted:false});expect(f.save).not.toHaveBeenCalled();
 f.authorize.mockRejectedValue(Error("revoked"));await expect(f.service.inspect(id(1),9)).rejects.toThrow("revoked");
});
it("refuses a parent timezone change that would silently affect other occurrences",async()=>{
 const f=fixture();await expect(f.service.execute({...command,timezone:"America/Chicago"},9)).rejects.toThrow("shared_timezone_change");expect(f.save).not.toHaveBeenCalled();
});
