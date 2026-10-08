import {describe,it,expect} from "vitest";
import {GateIdentityInput,gateIdentityDeadline} from "./gate-identity";
describe("reviewed Gate identity policy",()=>{
 it("expires image thirty days after the visit, with a bounded fallback for open visits",()=>{expect(gateIdentityDeadline({check_in_time:"2026-01-01Z",check_out_time:"2026-01-02Z"}).toISOString()).toBe("2026-02-01T00:00:00.000Z");expect(gateIdentityDeadline({check_in_time:"2026-01-01Z"}).toISOString()).toBe("2026-01-31T00:00:00.000Z");});
 it("requires review and refuses complete document numbers",()=>{const body={operationId:"21e1896d-cbbe-4846-913f-ed3d9f760d19",objectPath:"/objects/uploads/21e1896d-cbbe-4846-913f-ed3d9f760d19",capturedAt:"2026-01-01T00:00:00Z",reviewConfirmed:true,source:"visionkit_document_scan",fields:{firstName:"Test",lastName:"Visitor",documentType:"ID",issuingRegion:"OK"}};expect(GateIdentityInput.safeParse(body).success).toBe(true);expect(GateIdentityInput.safeParse({...body,reviewConfirmed:false}).success).toBe(false);expect(GateIdentityInput.safeParse({...body,fields:{...body.fields,documentNumber:"private"}}).success).toBe(false);});
});
