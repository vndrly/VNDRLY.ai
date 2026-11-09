import { cleanup,render,screen,waitFor,fireEvent } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { AccountNextSteps } from "./next-steps";
const mocks=vi.hoisted(()=>({user:{userId:7,activeMembershipId:2,vendorId:4,role:"vendor"},summary:{setup:[] as any[],credentials:[] as any[],firstWatch:null as any}}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:mocks.user})}));
vi.mock("@/lib/work-hub-client",()=>({ownerForUser:()=>({type:"vendor",id:4}),isWorkHubAdmin:()=>mocks.user.role==="vendor"}));
vi.mock('@/lib/onboarding-logo-upload',()=>({uploadOnboardingLogo:vi.fn(async()=>'/api/storage/objects/uploads/11111111-1111-4111-8111-111111111111')}));
let cache:QueryClient;
beforeEach(()=>{mocks.user.role="vendor";mocks.summary={setup:[],credentials:[],firstWatch:null};vi.stubGlobal("fetch",vi.fn(async(path:string)=>({ok:true,json:async()=>path==="/api/account-next-steps"?mocks.summary:{items:[]}})));cache=new QueryClient({defaultOptions:{queries:{retry:false}}});});
afterEach(()=>{cleanup();cache.clear();vi.unstubAllGlobals();});
function mount(surface:"dashboard"|"work-hub"="work-hub"){render(<QueryClientProvider client={cache}><p>Dashboard ready</p><AccountNextSteps surface={surface}/></QueryClientProvider>);}
it("loads saved setup without requesting training or showing certification course progress",async()=>{
  mocks.summary.setup=[{title:"Set up and publish your service catalog",href:"/vendor-catalog"}];mount();
  expect(await screen.findByText("Set up and publish your service catalog")).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.map(c=>c[0])).toEqual(["/api/account-next-steps"]);
  expect(screen.queryByText(/Assigned training|VNDRLY U|Add or update your certifications/)).toBeNull();
});
it("keeps worker credentials separate and only renders saved unfinished items",async()=>{
  mocks.user.role="field_employee";mocks.summary.credentials=[{title:"Update Safety certificate",href:"/field/compliance"}];mount();
  expect(await screen.findByText("Worker credentials")).toBeTruthy();expect(screen.getByText("Update Safety certificate")).toBeTruthy();expect(screen.queryByText("Recommended setup")).toBeNull();
});
it("shows only the current gate action and the saved station context",async()=>{
  mocks.summary.firstWatch={complete:false,action:{title:"Create a shift for this gate station",href:"/work-hub/calendar?siteId=1&stationId=main"},message:null,context:{siteName:"Lease A",stationName:"Main"}};mount("dashboard");
  expect(await screen.findByText("Lease A · Main")).toBeTruthy();expect(screen.getByText("Create a shift for this gate station")).toBeTruthy();expect(screen.queryByText("Assign employees to shifts")).toBeNull();
});
it("does not gate dashboard usability on the helper request",async()=>{
  vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}));mount();
  expect(screen.getByText("Dashboard ready")).toBeTruthy();expect(screen.getByTestId("account-next-steps").getAttribute("data-state")).toBe("loading");
});
it("hides first-watch setup only after the server confirms completion",async()=>{
  mocks.summary.firstWatch={complete:true,action:null,message:null,context:null};mount();
  await waitFor(()=>expect(screen.getByTestId("account-next-steps").getAttribute("data-state")).toBe("settled"));
  expect(screen.queryByText("Start Your First Gate Watch")).toBeNull();
});

it('offers COI upload without blocking other setup and hides it after a saved upload',async()=>{
  Object.assign(mocks.summary,{coiUploadNeeded:true});
  mocks.summary.setup=[{title:'Complete company profile',href:'/vendors/4'}];
  vi.mocked(fetch).mockImplementation(async(path:any)=>{
    if(path==='/api/account-next-steps/coi')Object.assign(mocks.summary,{coiUploadNeeded:false});
    return {ok:true,json:async()=>path==='/api/account-next-steps'?{...mocks.summary}:{items:[]}} as Response;
  });
  mount();
  const input=await screen.findByLabelText('Upload Certificate of Insurance (COI)');
  expect(screen.getByText('Complete company profile')).toBeTruthy();
  fireEvent.change(input,{target:{files:[new File(['coi'],'coi.pdf',{type:'application/pdf'})]}});
  await waitFor(()=>expect(screen.queryByLabelText('Upload Certificate of Insurance (COI)')).toBeNull());
  expect(fetch).toHaveBeenCalledWith('/api/account-next-steps/coi',expect.objectContaining({method:'POST'}));
});

it('tracks the whole card until partner checks finish without blocking the dashboard',async()=>{
  let finish!: (response:Response)=>void;
  vi.mocked(fetch).mockImplementation(async(path:any)=>path==='/api/account-next-steps'
    ? {ok:true,json:async()=>({...mocks.summary})} as Response
    : new Promise<Response>(resolve=>{finish=resolve;}));
  mocks.summary.setup=[{title:'Complete company profile',href:'/vendors/4'}];
  mount('dashboard');
  expect(screen.getByText('Dashboard ready')).toBeTruthy();
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  expect(screen.getByTestId('account-next-steps').getAttribute('data-state')).toBe('loading');
  finish({ok:true,json:async()=>({items:[]})} as Response);
  await waitFor(()=>expect(screen.getByTestId('account-next-steps').getAttribute('data-state')).toBe('settled'));
});
