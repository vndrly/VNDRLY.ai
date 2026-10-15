import {expect,it} from "vitest";
import {filterOfficeTickets} from "./office-ticket-filters";
import type {MobileOpenTicket} from "./portal-tickets";
const row=(id:number,status:string,createdAt:string,updatedAt=createdAt)=>({id,status,createdAt,updatedAt} as MobileOpenTicket);
it("filters saved statuses and flags, using creation time newest first",()=>{
 const rows=[row(1,"in_progress","2026-10-01","2026-10-15"),row(2,"initiated","2026-10-14"),row(3,"kicked_back","2026-10-13"),row(4,"completed","2026-10-12"),row(5,"cancelled","2026-10-11"),row(6,"submitted","2026-10-10")];
 expect(filterOfficeTickets(rows,"active",[]).map(r=>r.id)).toEqual([2,1]);
 expect(filterOfficeTickets(rows,"completed",[]).map(r=>r.id)).toEqual([4,6]);
 expect(filterOfficeTickets(rows,"kickbacks",[]).map(r=>r.id)).toEqual([3]);
 expect(filterOfficeTickets(rows,"flagged",[1,3]).map(r=>r.id)).toEqual([3,1]);
 expect(rows.map(r=>r.id)).toEqual([1,2,3,4,5,6]);
});
it("uses the existing seven-day stale rule and excludes cancelled or completed records",()=>{
 const rows=[row(1,"in_progress","2020-01-01"),row(2,"completed","2020-01-01"),row(3,"cancelled","2020-01-01"),row(4,"in_progress",new Date().toISOString())];
 expect(filterOfficeTickets(rows,"stale",[]).map(r=>r.id)).toEqual([1]);
});
