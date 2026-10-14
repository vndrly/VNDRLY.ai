import React from "react";
import { render,screen,fireEvent,cleanup } from "@testing-library/react";
import { afterEach,it,expect,vi } from "vitest";
const mock=vi.hoisted(()=>({data:null as any,send:vi.fn().mockResolvedValue({})}));
vi.mock("@/hooks/useColors",()=>({useColors:()=>({primary:"#159cae",text:"#ddd",card:"#222"})}));
vi.mock("@/lib/use-live-meetings",()=>({useLiveMeetings:()=>({data:mock.data,busy:false,error:"",send:mock.send,reload:vi.fn(),unavailable:false,contextKey:"test"})}));
vi.mock("./TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
vi.mock("react-native",()=>({useWindowDimensions:()=>({width:1200,height:900}),Platform:{OS:"web"},Share:{share:vi.fn()},View:({children}:any)=><div>{children}</div>,ScrollView:({children}:any)=><div>{children}</div>,Text:({children}:any)=><span>{children}</span>,Modal:({children,visible}:any)=>visible?<div>{children}</div>:null,TextInput:({value,onChangeText,accessibilityLabel}:any)=><input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)}/> }));
import Lobby from "./MeetingAdmissionLobby";
const id="b04608be-31d4-40b0-a5d1-ab39bbde9195";
const meeting={occurrenceId:id,title:"Crew briefing",agenda:null,hostName:"Host",startedAt:null,plannedEndsAt:null,connectedCount:0,admissionMode:"host_approval",ownAdmissionState:"pending",requestedAt:null,canManage:false,canEnter:false,canRequest:true,status:"live",version:2};
afterEach(()=>{cleanup();mock.send.mockClear();});
it("keeps room contents hidden until admission and requests only this user's entry",()=>{
 mock.data={meeting,requests:[],members:[]};render(<Lobby occurrenceId={id}><div>Private room contents</div></Lobby>);
 expect(screen.queryByText("Private room contents")).toBeNull();fireEvent.click(screen.getByText("Ask to join"));
 expect(mock.send).toHaveBeenCalledWith(`/api/work-hub/live-meetings/${id}/request-admission`,{},null,"POST");
});
it("dismisses the popup without deciding and keeps the waiting-room control",()=>{
 mock.data={meeting:{...meeting,ownAdmissionState:"admitted",canManage:true,canEnter:true},requests:[{userId:12,name:"Alex",requestedAt:"2026-10-14T17:00:00Z"}],members:[]};render(<Lobby occurrenceId={id}><div>Private room contents</div></Lobby>);
 expect(screen.getByText("Private room contents")).toBeTruthy();expect(screen.getByText("Alex")).toBeTruthy();fireEvent.click(screen.getByText("Close"));expect(mock.send).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("Waiting room · 1"));fireEvent.click(screen.getByText("Admit"));expect(mock.send).toHaveBeenCalledWith(`/api/work-hub/live-meetings/${id}/admission/12`,{decision:"admit"},2,"POST");
});
