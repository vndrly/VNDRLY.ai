import React from "react";
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import type {FleetWorkSession} from "@workspace/api-zod";
import FleetRecoverySources from "./fleet-recovery-sources";
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"en"}})}));
vi.mock("./png-pill-rollover",()=>({PngPillButton:({children,...props}:React.ComponentProps<"button">)=><button {...props}>{children}</button>}));
afterEach(cleanup);
it("pages original reports without executing work and refuses to combine changed case revisions",async()=>{
 const source={operationId:"one",kind:"activity.note",driverReport:true,assignmentMatches:true,capturedAt:"2026-10-16T12:00:00Z",receivedAt:"2026-10-17T12:00:00Z",timeZone:"America/Chicago",action:null,notes:"Original retained report",inspectionOutcome:null,quantity:null,reading:null,commodity:null,evidence:null};
 const page={caseId:"case",caseVersion:1,canonicalApplied:false,historicalDetailVerified:true,source:"retained_original_reports",detail:{name:"Original Detail",version:1},sources:[source],nextCursor:"1:2"};
 const recoverySources=vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce({...page,caseVersion:2,sources:[{...source,operationId:"two",notes:"Different case revision"}],nextCursor:null}),captureReconciliation=vi.fn();
 render(<FleetRecoverySources caseId="case" session={{recoverySources,captureReconciliation} as unknown as FleetWorkSession}/>);
 fireEvent.click(screen.getByRole("button",{name:"Review retained original reports"}));await screen.findByText("Original retained report");expect(captureReconciliation).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Read more originals"}));await screen.findByRole("alert");expect(screen.queryByText("Different case revision")).toBeNull();expect(screen.getByText("Original retained report")).toBeTruthy();expect(recoverySources).toHaveBeenNthCalledWith(2,"case","1:2");
});
