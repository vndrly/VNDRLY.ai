import { expect, it } from "vitest";
import { meetingAdmissionDecision } from "./meeting-admission-policy";
const member = { currentMember:true, owner:false, companyAdmin:false, ended:false, mode:"host_approval" as const, state:"pending" as const, removed:false, participant:true };
it("keeps pending members in the lobby and lets admitted members enter", () => {
  expect(meetingAdmissionDecision(member)).toEqual({discover:true,enter:false,request:true,manage:false});
  expect(meetingAdmissionDecision({...member,state:"admitted"} ).enter).toBe(true);
});
it("opens only to current company members, never removed people", () => {
  expect(meetingAdmissionDecision({...member,mode:"company_open",participant:false}).enter).toBe(true);
  expect(meetingAdmissionDecision({...member,mode:"company_open",removed:true}).enter).toBe(false);
  expect(meetingAdmissionDecision({...member,currentMember:false,companyAdmin:true}).manage).toBe(false);
  expect(meetingAdmissionDecision({...member,currentMember:false}).discover).toBe(false);
});
it("preserves legacy eligibility and keeps ended and declined requests closed", () => {
  expect(meetingAdmissionDecision({...member,mode:null,state:null}).enter).toBe(true);
  expect(meetingAdmissionDecision({...member,mode:null,state:null,participant:false}).discover).toBe(false);
  expect(meetingAdmissionDecision({...member,state:"declined"}).request).toBe(false);
  expect(meetingAdmissionDecision({...member,ended:true,owner:true}).enter).toBe(false);
  expect(meetingAdmissionDecision({...member,owner:true}).manage).toBe(true);
});
