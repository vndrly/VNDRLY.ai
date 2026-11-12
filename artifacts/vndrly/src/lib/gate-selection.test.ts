import { clearGateSelections, saveGateSelection } from "@/lib/gate-selection";
import { afterEach, expect, it } from "vitest";
import { readGateSelection } from "./gate-selection";
afterEach(()=>{clearGateSelections();localStorage.clear();});
it("shares site and gate only within the same user and membership",()=>{
 const user={userId:1,activeMembershipId:2,vendorId:3};
 saveGateSelection(user,42,"gate-42");
 expect(readGateSelection(user)).toEqual({siteId:"42",stationId:"gate-42"});
 expect(readGateSelection({...user,activeMembershipId:4})).toBeNull();
 expect(readGateSelection({...user,userId:5})).toBeNull();
});
it("does not persist an invalid or anonymous scope",()=>{
 saveGateSelection(null,42,"gate");saveGateSelection({userId:1},NaN,"gate");
 expect(localStorage.length).toBe(0);
});
