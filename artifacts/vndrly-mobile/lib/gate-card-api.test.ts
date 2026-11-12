import { expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({api:vi.fn(async()=>({})),changeOver:vi.fn(async()=>({}))}));
vi.mock("./api",()=>({apiFetch:mocks.api}));vi.mock("./change-over-api",()=>({changeOverRequest:mocks.changeOver}));
import {gateArrivalsApi} from "./gate-arrivals-api";
import {readGateAreaTraffic,recordGateMovement} from "./gate-traffic";
it("reads arrival candidates and linked proof without making a check-in",async()=>{
 await gateArrivalsApi.list(42);await gateArrivalsApi.get(42,"run/id");await gateArrivalsApi.visitLinks(42,7);
 expect(mocks.api.mock.calls).toEqual([["/api/gate-arrivals?siteLocationId=42"],["/api/gate-arrivals/run%2Fid?siteLocationId=42"],["/api/gate-arrivals/visit/7?siteLocationId=42"]]);
});
it("retains gate scope and the same operation ID when retrying movement",async()=>{
 const command={siteId:42,gateId:"gate-x",visitId:7,operationId:"same-operation",kind:"enter" as const};
 await readGateAreaTraffic(42);await recordGateMovement(command);await recordGateMovement(command);
 expect(mocks.changeOver.mock.calls).toEqual([["/movements?siteId=42"],["/movements",command],["/movements",command]]);
});
