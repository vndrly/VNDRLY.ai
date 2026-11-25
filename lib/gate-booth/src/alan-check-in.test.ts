import { expect, it } from "vitest";
import { reconcileAutomatedPlateUpdate } from "../../plate-state/src/index";
import { createSilentGateCheckIn } from "./silent-check-in";
import { registerGateVoiceForm, type GateVoiceDraft } from "./voice-draft";
it("retains Alan Webb check-in across the recorded separate audio turns", () => {
 const draft: GateVoiceDraft = {siteLocationId:9, gateStationId:"test", entryRevision:0};
 const off = registerGateVoiceForm({read:()=>draft,saved:()=>{},open:()=>{draft.silentCheckIn=true;},fillCheckIn:fields=>{ const plate = reconcileAutomatedPlateUpdate({currentPlate:draft.vehiclePlate as string,currentState:draft.plateState as string,automatedPlate:fields.vehiclePlate as string,automatedState:fields.plateState as string}); Object.assign(draft,fields,plate); }});
 const capture=createSilentGateCheckIn({normalizePlateState:value=>value?.toLowerCase()==="oklahoma"?"OK":null,parseSpokenPlateState:value=>/oklahoma/i.test(value)?"OK":null});
 const context={path:"/gate",gateDraft:draft};
 try {
 capture.engage(context);
 for(const text of ["Check in Alan Webb.","Webs towing.","Oklahoma plate.","CDL121","Company Webb's Towing."]) capture.hear(context,text);
 expect(draft).toMatchObject({firstName:"Alan",lastName:"Webb",company:"Webb's Towing",vehiclePlate:"CDL121",plateState:"OK"});
 expect(capture.review(context)?.ready).toBe(true);
 } finally {off();}
});

