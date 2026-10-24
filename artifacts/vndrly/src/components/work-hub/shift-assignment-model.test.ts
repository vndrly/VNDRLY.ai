import {describe,it,expect} from "vitest";
import {assignmentConflicts,shiftCell,type ScheduleShift} from "./shift-assignment-model";
const base:ScheduleShift={id:"one",version:1,title:"Day",pattern:"Main Gate Day",date:"2026-10-25",weekday:0,starts:"06:00",ends:"18:00",startsAt:"2026-10-25T11:00:00.000Z",endsAt:"2026-10-25T23:00:00.000Z",timezone:"America/Chicago",required:1,assignees:[]};
describe("weekly assignment selection",()=>{
 it("uses the same cell for the same local weekday across weeks",()=>expect(shiftCell(base)).toBe(shiftCell({...base,date:"2026-11-01"})));
 it("blocks another site or selected shift that overlaps",()=>{
  const busy={userId:7,shiftId:"other",startsAt:"2026-10-25T10:00:00.000Z",endsAt:"2026-10-25T12:00:00.000Z"};
  expect(assignmentConflicts([base],7,[busy])).toHaveLength(1);
  expect(assignmentConflicts([base],8,[busy])).toHaveLength(0);
  expect(assignmentConflicts([base,{...base,id:"two"}],7,[])).toHaveLength(2);
 });
 it("does not treat the same shift or adjacent shifts as a conflict",()=>{
  expect(assignmentConflicts([base],7,[{userId:7,shiftId:"one",startsAt:base.startsAt,endsAt:base.endsAt}])).toHaveLength(0);
  expect(assignmentConflicts([base],7,[{userId:7,shiftId:"two",startsAt:base.endsAt,endsAt:"2026-10-26T11:00:00.000Z"}])).toHaveLength(0);
 });
});
