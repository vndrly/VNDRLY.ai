import { describe,it,expect } from "vitest";
import { hasAssignmentOverlap,validateScheduleRange } from "./site-schedule-policy";
const window = (id:string,start:string,end:string) => ({id,startsAt:new Date(start),endsAt:new Date(end)});
describe("site schedule policy",()=>{
 it("blocks overnight and nested overlaps but allows a shared boundary",()=>{
  const night=window("night","2026-10-24T23:00:00Z","2026-10-25T11:00:00Z");
  expect(hasAssignmentOverlap([night,window("other","2026-10-25T10:00:00Z","2026-10-25T12:00:00Z")])).toBe(true);
  expect(hasAssignmentOverlap([night,window("inside","2026-10-25T01:00:00Z","2026-10-25T02:00:00Z")])).toBe(true);
  expect(hasAssignmentOverlap([night,window("day","2026-10-25T11:00:00Z","2026-10-25T23:00:00Z")])).toBe(false);
 });
 it("rejects invalid, reversed, and excessively large date ranges",()=>{
  expect(validateScheduleRange("2026-02-30","2026-03-01")).toBe(false);
  expect(validateScheduleRange("2026-10-25","2026-10-24")).toBe(false);
  expect(validateScheduleRange("2026-01-01","2026-12-31")).toBe(false);
  expect(validateScheduleRange("2026-10-24","2026-10-30")).toBe(true);
 });
});
