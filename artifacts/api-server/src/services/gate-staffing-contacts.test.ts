import { expect, it, vi } from "vitest";
import { readGateStaffingContacts } from "./gate-staffing-contacts";
const session={userId:7,vendorId:4,role:"vendor",activeMembershipId:9,sv:2};
it("lists volunteers first without requiring On Call, availability or rest", async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{site_id:12}]}).mockResolvedValueOnce({rows:[
    {user_id:1,name:"A staff",phone:null,email:null,native_operations:{onCallActive:true}},
    {user_id:2,name:"Z volunteer",phone:"555",email:null,native_operations:{pickupShifts:true,onCallActive:false}},
  ]});
  const authorize=vi.fn().mockResolvedValue({});
  const result=await readGateStaffingContacts(session,"alert",{query} as never,authorize as never);
  expect(authorize).toHaveBeenCalledWith({query},session,12);
  expect(result.people.map(p=>[p.userId,p.pickupShifts,p.onCall])).toEqual([[2,true,false],[1,false,true]]);
  expect(query.mock.calls[0][1]).toEqual(["alert",4]);
});
it("does not disclose contacts for another company's alert or an unauthorized actor",async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[]});
  const authorize=vi.fn();
  await expect(readGateStaffingContacts(session,"other",{query} as never,authorize as never)).rejects.toMatchObject({status:404,code:"staffing_contacts.not_found"});
  expect(authorize).not.toHaveBeenCalled();
  query.mockResolvedValueOnce({rows:[{site_id:12}]});authorize.mockRejectedValue(Error("forbidden"));
  await expect(readGateStaffingContacts(session,"alert",{query} as never,authorize as never)).rejects.toThrow("forbidden");
  expect(query).toHaveBeenCalledTimes(2);
});
