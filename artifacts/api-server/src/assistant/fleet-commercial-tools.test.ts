import {expect,it} from "vitest";
import {fleetCommercialToolRequest,FLEET_COMMERCIAL_TOOLS} from "./fleet-commercial-tools";
it("binds original commercial operations to the trusted confirmation key and rejects model scope",()=>{
 const input={idempotencyKey:"approved-test",runId:"11111111-1111-4111-8111-111111111111",expectedVersion:3,ticketVersion:2,reason:"Saved approved rate"};
 expect(fleetCommercialToolRequest("resolve_fleet_activity_price",input)).toMatchObject({method:"POST",path:"/fleet/work/assistant",body:{kind:"price.resolve",runId:input.runId,expectedVersion:3}});
 expect(fleetCommercialToolRequest("resolve_fleet_activity_price",{...input,scope:{userId:99}})).toHaveProperty("error");
 expect(new Set(FLEET_COMMERCIAL_TOOLS.map(row=>row.name)).size).toBe(FLEET_COMMERCIAL_TOOLS.length);
});
