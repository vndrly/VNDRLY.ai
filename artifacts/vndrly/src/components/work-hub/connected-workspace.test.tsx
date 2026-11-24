import React from "react";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({request:vi.fn(),accounts:[] as any[]}));
vi.mock("./connector-client",()=>({connectorRequest:m.request,useConnectorScope:()=>"user-one",useInboxCounts:()=>({counts:{gmail:17,outlook:23},total:40}),useAccounts:()=>({data:{accounts:m.accounts}}),enc:encodeURIComponent}));
vi.mock("./chrome",()=>({WorkHubMiniCardButton:({children,type="button",...props}:any)=><button type={type} {...props}>{children}</button>}));
vi.mock("./provider-logo",()=>({ProviderLogo:()=> <span/>}));
import {ConnectorTree,ConnectedWorkspace} from "./connected-workspace";
const account={id:"account-one",provider:"gmail" as const,label:"fixture@example.com",status:"connected"};
function mount(selection:any){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ConnectedWorkspace selection={selection} onSelect={vi.fn()}/></QueryClientProvider>);}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();m.accounts=[];m.request.mockReset();m.request.mockImplementation(async(path:string)=>path.includes("/messages/message-one")?{id:"message-one",from:"sender@example.com",subject:"Fixture mail",text:"Fixture body",to:["fixture@example.com"],attachments:[]}:{items:[]});});afterEach(cleanup);
it("reads the selected account message inside Communications",async()=>{mount({account,kind:"email",folder:{id:"INBOX",name:"Inbox"},message:{id:"message-one"}});await screen.findByText("Fixture body");expect(m.request).toHaveBeenCalledWith("/accounts/account-one/messages/message-one",undefined,expect.any(AbortSignal));});
it("sends a composed message through the selected account without opening a provider site",async()=>{
 mount({account,kind:"email"});fireEvent.click(screen.getByRole("button",{name:"Compose"}));
 fireEvent.change(screen.getByLabelText("To",{exact:true}),{target:{value:"recipient@example.com"}});fireEvent.change(screen.getByLabelText("Subject"),{target:{value:"Fixture subject"}});fireEvent.change(screen.getByLabelText("Email message"),{target:{value:"Fixture message"}});
 fireEvent.click(screen.getByRole("button",{name:"Send"}));await waitFor(()=>expect(m.request).toHaveBeenCalledWith("/accounts/account-one/mail",expect.objectContaining({draft:false,operationId:expect.any(String),mail:expect.objectContaining({to:["recipient@example.com"],text:"Fixture message"})})));expect(screen.queryAllByRole("link")).toHaveLength(0);
});

it("shows Emails with a right-hand inbox total and separate account counts", async()=>{
 m.accounts=[{id:"gmail",provider:"gmail",label:"one@example.com",status:"connected"},{id:"outlook",provider:"outlook",label:"two@example.com",status:"connected"}];
 render(<QueryClientProvider client={new QueryClient()}><ConnectorTree kind="email" onSelect={vi.fn()}/></QueryClientProvider>);
 expect(screen.getByText("Emails")).toBeTruthy();
 expect(screen.queryByText("Email(s)")).toBeNull();
 expect(screen.getByLabelText("Total inbox emails").textContent).toBe("40");
 expect(screen.getAllByLabelText("Account inbox emails").map(x=>x.textContent)).toEqual(["17","23"]);
});
it("opens Inbox directly without waiting for folder selection",async()=>{
 mount({account,kind:"email"});
 await waitFor(()=>expect(m.request).toHaveBeenCalledWith("/accounts/account-one/messages?folder=INBOX&limit=50",undefined,expect.any(AbortSignal)));
});

it("pages forward and back without appending rows and clears selection",async()=>{
 m.request.mockImplementation(async(path:string)=>path.includes("/folder-counts")?{INBOX:100}:path.includes("cursor=")?{items:[{id:"second",subject:"Second page",from:"Sender"}]}:path.includes("/messages?")?{items:[{id:"first",subject:"First page",from:"Sender"}],next:"page-two"}:{items:[]});
 mount({account,kind:"email"});await screen.findByText("First page");
 fireEvent.click(screen.getByLabelText("Select First page"));
 fireEvent.click(screen.getByLabelText("Next email page"));await screen.findByText("Second page");
 expect(screen.queryByText("First page")).toBeNull();expect(screen.queryByText("1 selected")).toBeNull();
 expect(screen.getByText("Emails 51–51 of 100")).toBeTruthy();
 fireEvent.click(screen.getByLabelText("Previous email page"));await screen.findByText("First page");
 expect(screen.queryByText("Second page")).toBeNull();
});

it("toggles the compact search row and Cancel clears it",async()=>{
 mount({account,kind:"email"});
 expect(screen.queryByRole("textbox",{name:"Search email"})).toBeNull();
 const toggle=screen.getByRole("button",{name:"Toggle email search"});
 fireEvent.click(toggle);
 expect(screen.getByRole("textbox",{name:"Search email"})).toBeTruthy();
 fireEvent.click(toggle);
 expect(screen.queryByRole("textbox",{name:"Search email"})).toBeNull();
 fireEvent.click(toggle);
 fireEvent.change(screen.getByRole("textbox",{name:"Search email"}),{target:{value:"query"}});
 fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
 expect(screen.queryByRole("textbox",{name:"Search email"})).toBeNull();
 expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

it("returns from the mailbox to the account chooser",()=>{
 const back=vi.fn();
 render(<QueryClientProvider client={new QueryClient()}><ConnectedWorkspace selection={{account,kind:"email"}} onSelect={vi.fn()} onBack={back}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Back to email accounts"}));
 expect(back).toHaveBeenCalledOnce();
});

it("shows folder totals separately without blocking messages",async()=>{
 m.request.mockImplementation(async(path:string)=>path.includes("/folder-counts?")?{INBOX:42,SENT:0}:path.includes("/folders?")?{items:[{id:"INBOX",name:"Inbox"},{id:"SENT",name:"Sent"}]}: {items:[{id:"first",subject:"Visible message"}]});
 mount({account,kind:"email"});
 await screen.findByText("Visible message");
 await waitFor(()=>expect(screen.getByLabelText("Inbox message count").textContent).toBe("42"));
 expect(screen.getByLabelText("Sent message count").textContent).toBe("0");
});

it("returns from an open message to its message list",async()=>{
 mount({account,kind:"email",folder:{id:"INBOX",name:"Inbox"},message:{id:"message-one",subject:"Fixture mail"}});
 await screen.findByText("Fixture body");
 fireEvent.click(screen.getByRole("button",{name:"Back to messages"}));
 expect(screen.queryByText("Fixture body")).toBeNull();
 expect(screen.getByRole("button",{name:"Back to email accounts"})).toBeTruthy();
});

it("resizes the folder pane with bounded keyboard controls",()=>{
 mount({account,kind:"email"});
 const divider=screen.getByRole("separator",{name:"Resize email folders"});
 expect(divider.getAttribute("aria-valuenow")).toBe("180");
 fireEvent.keyDown(divider,{key:"ArrowRight"});
 expect(divider.getAttribute("aria-valuenow")).toBe("196");
 for(let i=0;i<20;i++) fireEvent.keyDown(divider,{key:"ArrowLeft"});
 expect(divider.getAttribute("aria-valuenow")).toBe("120");
});

it("selects displayed mail for bulk delete and keeps failures selected",async()=>{
 m.request.mockImplementation(async(path:string,body:any)=>{
  if(body){if(path.includes("/two/")) throw Error("fixture failure");return {};}
  if(path.includes("/messages?"))return {items:[{id:"one",subject:"First",from:"Sender"},{id:"two",subject:"Second",from:"Sender"}]};
  return {items:[]};
 });
 mount({account,kind:"email"});await screen.findByText("First");
 fireEvent.click(screen.getByLabelText("Select all visible messages"));
 expect(screen.getByText("2 selected")).toBeTruthy();
 fireEvent.click(screen.getByLabelText("Delete selected messages"));
 await screen.findByText(/1 message action/);
 expect(screen.queryByText("First")).toBeNull();expect((screen.getByLabelText("Select Second") as HTMLInputElement).checked).toBe(true);
 expect(m.request).not.toHaveBeenCalledWith("/accounts/account-one/messages/one",undefined,expect.anything());
});
it("stars a row without opening it and moves selected mail to a chosen folder",async()=>{
 m.request.mockImplementation(async(path:string,body:any)=>body?{}:path.includes("/folders?")?{items:[{id:"custom",name:"Project"}]}:path.includes("/messages?")?{items:[{id:"one",subject:"First",from:"Sender"}]}:{items:[]});
 mount({account,kind:"email"});await screen.findByText("First");
 fireEvent.click(screen.getByLabelText("Star First"));await screen.findByLabelText("Unstar First");
 fireEvent.click(screen.getByLabelText("Select First"));fireEvent.change(screen.getByLabelText("Move selected messages to"),{target:{value:"custom"}});fireEvent.click(screen.getByText("Move selected"));
 await waitFor(()=>expect(m.request).toHaveBeenCalledWith("/accounts/account-one/messages/one/action",{action:"move",destination:"custom",source:"INBOX"}));
 await waitFor(()=>expect(screen.queryByText("First")).toBeNull());
});

it("recovers a composer after closing and reopening without sending",async()=>{
 mount({account,kind:"email"});fireEvent.click(screen.getByLabelText("Compose"));
 fireEvent.change(screen.getByLabelText("Subject"),{target:{value:"Unfinished draft"}});
 fireEvent.change(screen.getByLabelText("Email message"),{target:{value:"Keep this text"}});
 fireEvent.click(screen.getByText("Cancel"));fireEvent.click(screen.getByLabelText("Compose"));
 expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Unfinished draft");
 expect((screen.getByLabelText("Email message") as HTMLTextAreaElement).value).toBe("Keep this text");
 expect(m.request.mock.calls.some(([,body])=>body?.mail)).toBe(false);
});
it("builds Reply All without duplicate recipients or the mailbox owner",async()=>{
 m.request.mockImplementation(async(path:string)=>path.endsWith("/message-one")?{id:"message-one",from:"Sender <sender@example.com>",to:["fixture@example.com","other@example.com"],cc:["OTHER@example.com","copy@example.com"],subject:"Discussion",text:"Body",attachments:[]}:{items:[]});
 mount({account,kind:"email",message:{id:"message-one"}});await screen.findByText("Body");
 fireEvent.click(screen.getByLabelText("Reply all"));
 expect((screen.getByLabelText("To",{exact:true}) as HTMLInputElement).value).toBe("sender@example.com, other@example.com");
 expect((screen.getByLabelText("Cc",{exact:true}) as HTMLInputElement).value).toBe("copy@example.com");
 expect((screen.getByLabelText("Bcc",{exact:true}) as HTMLInputElement).value).toBe("");
});
it("shows cached summaries immediately during a pending refresh",async()=>{
 const key=JSON.stringify(["mail-summaries","user-one",account.id,"INBOX",undefined,"",50]);
 sessionStorage.setItem(key,JSON.stringify({savedAt:Date.now(),value:{items:[{id:"cached",subject:"Cached mail",from:"Sender"}]}}));
 m.request.mockImplementation(()=>new Promise(()=>{}));mount({account,kind:"email"});
 expect(screen.getByText("Cached mail")).toBeTruthy();
});

it("recovers expired provider pagination to a fresh first page", async () => {
 let reads = 0;
 m.request.mockImplementation(async (path:string) => {
   if (path.includes("cursor=")) throw Error("Invalid provider cursor");
   if (path.includes("/messages?")) return {items:[{id:"one",subject:++reads > 1 ? "Refreshed first page" : "First page",from:"Sender"}],next:"expired"};
   return {items:[]};
 });
 mount({account,kind:"email"}); await screen.findByText("First page");
 fireEvent.click(screen.getByLabelText("Select First page"));
 fireEvent.click(screen.getByLabelText("Next email page"));
 await screen.findByText("Refreshed first page");
 expect(screen.queryByText("Invalid provider cursor")).toBeNull();
 expect(screen.queryByText("1 selected")).toBeNull();
 expect((screen.getByLabelText("Previous email page") as HTMLButtonElement).disabled).toBe(true);
});
