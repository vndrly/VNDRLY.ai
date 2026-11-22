import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ api: vi.fn(), created: vi.fn(), sequence: 0 }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mock.sequence).padStart(12,"0")}` }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 7, vendorId: 4, activeMembershipId: 2 } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "blue", text: "black" }) }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({generation:1}), isAuthScopeCurrent: () => true }));
vi.mock("@/lib/api", () => ({ apiFetch: mock.api }));
vi.mock("@/components/ProfileMiniCardButton", () => ({ default: ({ children, onPress, disabled, loading, accessibilityLabel }: any) => <button aria-label={accessibilityLabel} disabled={disabled || loading} onClick={onPress}>{children}</button> }));
vi.mock("@/components/ModalDraft", () => ({
 ModalTextInput: ({accessibilityLabel,value,onChangeText}:any) => <input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)}/>,
 ModalPressable: ({children,accessibilityLabel,accessibilityState,onPress}:any) => <button aria-label={accessibilityLabel} aria-pressed={accessibilityState.checked} onClick={onPress}>{children}</button>,
}));
import NewConversation from "./NewConversation";
beforeEach(() => { mock.api.mockReset(); mock.created.mockReset(); mock.api.mockImplementation(async (_path:string, init?:RequestInit) => init?.method === "POST" ? {channel:{id:"chat-id"}} : [{id:7,displayName:"Me"},{id:8,displayName:"Riley"},{id:9,displayName:"Rowan"}]); });
afterEach(cleanup);
it("starts a multi-person chat without adding the current user twice", async () => {
 render(<NewConversation kind="chat" onCreated={mock.created} onCancel={()=>{}}/>);
 fireEvent.click(await screen.findByRole("button", {name:"Riley"}));
 fireEvent.click(screen.getByRole("button", {name:"Rowan"}));
 expect(screen.queryByRole("button",{name:"Me"})).toBeNull();
 fireEvent.click(screen.getByRole("button", {name:"Start Chat"}));
 await waitFor(()=>expect(mock.created).toHaveBeenCalledWith("chat-id"));
 const request=mock.api.mock.calls.find(([path])=>path==="/api/work-hub/channels/start-chat");
 expect(JSON.parse(request![1].body)).toMatchObject({participantUserIds:[8,9]});
});
it("retries a failed private-channel creation with the same operation id", async () => {
 let attempts=0;
 mock.api.mockImplementation(async (_path:string,init?:RequestInit)=>{if(init?.method==="POST"){if(++attempts===1)throw Error("Connection interrupted");return {resource:{id:"channel-id"}};}return [{id:8,displayName:"Riley"}];});
 render(<NewConversation kind="channel" onCreated={mock.created} onCancel={()=>{}}/>);
 fireEvent.change(screen.getByLabelText("New channel name"),{target:{value:"Dispatch"}});
 fireEvent.click(screen.getByRole("button",{name:"Private channel"}));
 fireEvent.click(await screen.findByRole("button",{name:"Riley"}));
 fireEvent.click(screen.getByRole("button",{name:"Create Channel"}));
 await screen.findByText("Connection interrupted");
 fireEvent.click(screen.getByRole("button",{name:"Create Channel"}));
 await waitFor(()=>expect(mock.created).toHaveBeenCalledWith("channel-id"));
 const bodies=mock.api.mock.calls.filter(([,init])=>init?.method==="POST").map(([,init])=>JSON.parse(init.body));
 expect(bodies[1]).toEqual(bodies[0]);
 expect(bodies[0]).toMatchObject({owner:{type:"vendor",id:4},payload:{name:"Dispatch",visibility:"private",participantUserIds:[8]}});
});
