import { expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({read:vi.fn(),remove:vi.fn(),acl:vi.fn(),older:vi.fn()}));
vi.mock("@workspace/db",()=>({siteVisitsTable:{platePhotoUrl:"plate",vehiclePhotoUrl:"vehicle",gateCapture:"capture"},db:{select:()=>({from:()=>({where:state.read})})}}));
vi.mock("../services/gate-identity",()=>({purgeExpiredGateIdentityImages:vi.fn()}));
vi.mock("./objectStorage",()=>({ObjectStorageService:class {
 getStoredObjectAcl=state.acl;listUploadsOlderThan=state.older;deleteStoredObject=state.remove;
 trySetObjectEntityAclPolicy=vi.fn();
}}));
import { cleanupUnattachedGateEvidence } from "./gate-evidence-cleanup";
it("retains original and derived evidence, including attachments saved after the first scan",async()=>{
 const path=(n:number)=>`/objects/uploads/00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
 state.acl.mockResolvedValue({owner:"1",visibility:"private",purpose:"gate-evidence"});
 state.older.mockResolvedValue([path(1),path(2),path(3),path(4)]);
 state.read.mockResolvedValueOnce([{plate:null,vehicle:null,capture:{images:[{originalPath:path(1),objectPath:path(2)}]}}])
 .mockResolvedValueOnce([{plate:null,vehicle:null,capture:{images:[{originalPath:path(3),objectPath:path(3)}]}}]);
 expect(await cleanupUnattachedGateEvidence()).toBe(1);
 expect(state.remove).toHaveBeenCalledExactlyOnceWith(path(4));
});
