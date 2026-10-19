import React from "react";
import {it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import FleetCommercialWork from "./FleetCommercialWork";
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button onClick={onPress} disabled={disabled}>{children}</button>}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"en"}})}));
vi.mock("@/hooks/useColors",()=>({useColors:()=>({text:"#fff",primary:"#f90",card:"#383b3f"})}));
it("captures an exact original quantity while offline without approving charges or closing the ticket",async()=>{
 const captureQuantity=vi.fn().mockResolvedValue({canonicalApplied:false,state:"outcome_unknown"}),captureOfficeReview=vi.fn(),session={scope:{userId:7},captureQuantity,captureOfficeReview,commercialReview:vi.fn().mockRejectedValue(Error("offline"))} as any;
 render(<FleetCommercialWork session={session} run={{id:"run",driverUserId:7,stops:[]} as any} pending={false} onChanged={()=>{}}/>);
 fireEvent.change(screen.getByLabelText("Reported quantity"),{target:{value:"123.456789"}});fireEvent.click(screen.getByRole("button",{name:"Save reported quantity"}));
 await waitFor(()=>expect(captureQuantity).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({quantity:"123.456789"})));
 expect(await screen.findByText("Saved on this device; server confirmation is pending.")).toBeTruthy();expect(captureOfficeReview).not.toHaveBeenCalled();
});
it("requires explicit office source selection, charge approval and a separate ticket submission",async()=>{
 let revision=0;const page=()=>({activityId:"run",activityVersion:4,canReview:true,ticket:{id:12,version:3,status:revision===3?"submitted":"in_progress"},billing:{context:{vendorId:1},pricing:{mode:"priced",rateCard:{unitRate:"0.0125",basis:"per_barrel",extras:[]}},review:{status:revision>=2?"reviewed":"pending"}},charges:[],quantities:[{evidence:{id:"quantity",quantity:"123.456789",unit:"barrel",kind:"delivered",source:"manual",evidenceReferences:[]},review:revision>=1?{revision:1,decision:"accept_as_billable"}:null}],nextCursor:null});
 const captureOfficeReview=vi.fn().mockImplementation(async()=>{revision++;return {canonicalApplied:true,state:"applied"};}),session={scope:{userId:8},commercialReview:vi.fn().mockImplementation(async()=>page()),captureOfficeReview} as any;
 render(<FleetCommercialWork session={session} run={{id:"run",driverUserId:7,status:"submitted_for_review"} as any} pending={false} onChanged={()=>{}}/>);
 await screen.findByText("123.456789 barrel");fireEvent.change(screen.getByLabelText("Review reason"),{target:{value:"Receipt checked"}});fireEvent.click(screen.getByRole("button",{name:"Accept for billing"}));
 const chosen=await screen.findByRole("checkbox",{name:"Use for run charges: quantity"});fireEvent.click(chosen);fireEvent.click(screen.getByRole("button",{name:"Use existing ticket tax rules"}));fireEvent.click(screen.getByRole("button",{name:"Approve run charges"}));
 await waitFor(()=>expect(captureOfficeReview).toHaveBeenCalledTimes(2));expect(captureOfficeReview.mock.calls[1][1]).toMatchObject({kind:"charge.review",quantityReviews:[{evidenceId:"quantity",revision:1}]});expect(captureOfficeReview.mock.calls.some(call=>call[1].kind==="ticket.finalize")).toBe(false);
 fireEvent.click(await screen.findByRole("button",{name:"Review ticket submission"}));fireEvent.click(await screen.findByRole("button",{name:"Finalize and submit ticket"}));expect(await screen.findByText("Ticket submitted; saved status verified.")).toBeTruthy();expect(captureOfficeReview.mock.calls[2][1]).toEqual({kind:"ticket.finalize",finalizeDayMinimums:false});
});
