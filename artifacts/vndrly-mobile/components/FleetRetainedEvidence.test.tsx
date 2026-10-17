import {Platform} from "react-native";
import React from "react";import {it,expect,vi} from "vitest";import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import FleetRetainedEvidence from "./FleetRetainedEvidence";
vi.mock("@/lib/api",()=>({getApiBase:()=>"https://vndrly.ai"}));
vi.mock("@/lib/auth",()=>({getToken:async()=>"synthetic-test-token",captureAuthScope:()=>({}),isAuthScopeCurrent:()=>true}));
vi.mock("expo-image-picker",()=>({requestCameraPermissionsAsync:async()=>({status:"granted"}),requestMediaLibraryPermissionsAsync:async()=>({status:"granted"}),launchCameraAsync:async()=>({canceled:false,assets:[{uri:"private-camera",mimeType:"image/jpeg"}]}),launchImageLibraryAsync:async()=>({canceled:false,assets:[{uri:"private-library",mimeType:"image/jpeg"}]})}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button onClick={onPress} disabled={disabled}>{children}</button>}));
Object.defineProperty(Platform,"OS",{value:"ios",configurable:true});
it("retains more than one capture without waiting for connectivity or clearing an earlier pending photo",async()=>{
 const captureEvidence=vi.fn().mockResolvedValue({durability:"durable",canonicalApplied:false}),onChanged=vi.fn(),session={captureEvidence,scope:{userId:7}} as any,run={id:"run",driverUserId:7} as any;
 render(<FleetRetainedEvidence session={session} run={run} onChanged={onChanged}/>);
 fireEvent.click(screen.getByRole("button",{name:"Capture Fleet image"}));await waitFor(()=>expect(captureEvidence).toHaveBeenCalledOnce());await waitFor(()=>expect((screen.getByRole("button",{name:"Choose Fleet image"}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole("button",{name:"Choose Fleet image"}));await waitFor(()=>expect(captureEvidence).toHaveBeenCalledTimes(2));expect(captureEvidence.mock.calls.map(call=>call[1])).toEqual(["private-camera","private-library"]);expect(await screen.findByText(/Saved on this device.*photo pending sync/)).toBeTruthy();
});
