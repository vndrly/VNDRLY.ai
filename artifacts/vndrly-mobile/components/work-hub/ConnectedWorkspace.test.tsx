import React from "react";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("./connector-client",()=>({request:m.request,useConnectorScope:()=>"user-one",useInboxCounts:()=>({counts:{},total:0}),useAccounts:()=>({data:{accounts:[]}}),enc:encodeURIComponent}));
vi.mock("expo-router",()=>({useFocusEffect: (callback:any)=>React.useEffect(callback,[callback])}));
vi.mock("react-native",()=>({AppState:{currentState:"active",addEventListener:()=>({remove:vi.fn()})},View:({children}:any)=><div>{children}</div>,ScrollView:({children}:any)=><div>{children}</div>,Text:({children}:any)=><span>{children}</span>,TextInput:({accessibilityLabel,value,onChangeText}:any)=><input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)}/>,StyleSheet:{create:(v:any)=>v}}));
vi.mock("@/components/ModalDraft",()=>({ModalPressable:({children,onPress,accessibilityLabel}:any)=><button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>}));
vi.mock("@/components/ProfileMiniCardButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
vi.mock("@/hooks/use-brand",()=>({useBrand:()=>({primary:"#00bcd4"})}));
vi.mock("./ProviderLogo",()=>({default:()=> <span/>}));
vi.mock("expo-file-system",()=>({File:class{},Paths:{cache:"cache"}}));
vi.mock("expo-sharing",()=>({}));vi.mock("expo-crypto",()=>({randomUUID:()=>"123e4567-e89b-42d3-a456-426614174000"}));vi.mock("@/lib/meeting-files",()=>({pickMeetingFile:vi.fn()}));
vi.mock("@/components/SphereBackButton",()=>({default:({onPress,accessibilityLabel}:any)=><button aria-label={accessibilityLabel} onClick={onPress}/>}));
import ConnectedWorkspace from "./ConnectedWorkspace";
const account={id:"account-two",provider:"outlook" as const,label:"fixture@example.com",status:"connected"};
function mount(selection:any){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ConnectedWorkspace selection={selection} onSelect={vi.fn()}/></QueryClientProvider>);}
beforeEach(()=>{m.request.mockReset();m.request.mockImplementation(async(path:string)=>path.includes("/messages/message-one")?{id:"message-one",from:"sender@example.com",subject:"Fixture mail",text:"Fixture body",attachments:[]}:{items:[]});});afterEach(cleanup);
it("reads a selected mailbox message inside native Communications",async()=>{mount({account,kind:"email",folder:{id:"inbox",name:"Inbox"},message:{id:"message-one"}});await screen.findByText("Fixture body");expect(m.request).toHaveBeenCalledWith("/accounts/account-two/messages/message-one",undefined,expect.any(AbortSignal));});
it("sends through the selected native account",async()=>{mount({account,kind:"email"});fireEvent.click(screen.getByRole("button",{name:"Compose"}));fireEvent.change(screen.getByLabelText("to"),{target:{value:"recipient@example.com"}});fireEvent.change(screen.getByLabelText("subject"),{target:{value:"Fixture subject"}});fireEvent.change(screen.getByLabelText("text"),{target:{value:"Fixture message"}});fireEvent.click(screen.getByRole("button",{name:"Send"}));await waitFor(()=>expect(m.request).toHaveBeenCalledWith("/accounts/account-two/mail",expect.objectContaining({draft:false,mail:expect.objectContaining({to:["recipient@example.com"],text:"Fixture message"})})));});

it("returns from the mailbox to the account chooser",()=>{
 const back=vi.fn();
 render(<QueryClientProvider client={new QueryClient()}><ConnectedWorkspace selection={{account,kind:"email"}} onSelect={vi.fn()} onBack={back}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Back to email accounts"}));
 expect(back).toHaveBeenCalledOnce();
});

it("returns from an open message to its message list",async()=>{
 mount({account,kind:"email",folder:{id:"INBOX",name:"Inbox"},message:{id:"message-one",subject:"Fixture mail"}});
 await screen.findByText("Fixture body");
 fireEvent.click(screen.getByRole("button",{name:"Back to messages"}));
 expect(screen.queryByText("Fixture body")).toBeNull();
 expect(screen.getByRole("button",{name:"Back to email accounts"})).toBeTruthy();
});

it("collapses and reopens the selected mailbox without moving messages into the folder pane",async()=>{
 m.request.mockImplementation(async(path:string)=>{
  if(path.includes("/folder-counts?")) return {inbox:1};
  if(path.includes("/folders?")) return {items:[{id:"inbox",name:"Inbox"}]};
  if(path.includes("/messages?")) return {items:[{id:"message-one",subject:"Fixture mail",from:"sender@example.com"}]};
  return {items:[]};
 });
 mount({account,kind:"email",folder:{id:"inbox",name:"Inbox"}});
 await screen.findByText("Fixture mail");
 fireEvent.click(screen.getByRole("button",{name:"Collapse Inbox"}));
 expect(screen.queryByText("Fixture mail")).toBeNull();
 expect(screen.getByText("Select a mailbox to view messages.")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Expand Inbox"}));
 await screen.findByText("Fixture mail");
});

it("pages through mailbox messages with the web companion controls",async()=>{
 m.request.mockImplementation(async(path:string)=>{
  if(path.includes("/folder-counts?")) return {inbox:51};
  if(path.includes("/folders?")) return {items:[{id:"inbox",name:"Inbox"}]};
  if(path.includes("cursor=second")) return {items:[{id:"message-two",subject:"Second page mail",from:"sender@example.com"}]};
  if(path.includes("/messages?")) return {items:[{id:"message-one",subject:"First page mail",from:"sender@example.com"}],next:"second"};
  return {items:[]};
 });
 mount({account,kind:"email",folder:{id:"inbox",name:"Inbox"}});
 await screen.findByText("First page mail");
 expect(m.request).toHaveBeenCalledWith(expect.stringContaining("limit=50"),undefined,expect.any(AbortSignal));
 fireEvent.click(screen.getByRole("button",{name:"Next email page"}));
 await screen.findByText("Second page mail");
 expect(screen.queryByText("First page mail")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Previous email page"}));
 await screen.findByText("First page mail");
});
