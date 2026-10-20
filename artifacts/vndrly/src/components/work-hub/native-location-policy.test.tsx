import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
const m=vi.hoisted(()=>({request:vi.fn(),manage:true}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{userId:8,vendorId:3,role:"vendor",activeMembershipId:2}})}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{language:"en"}})}));
vi.mock("@/components/png-pill-rollover",()=>({PngPillButton:({children,...p}:any)=><button {...p}>{children}</button>}));
vi.mock("@/lib/native-operations-client",async original=>({...await original<object>(),nativeOperationsRequest:m.request}));
import NativeOperations from "./native-operations";
const policy={enabled:true,locationRequests:true,photoRequests:true,automaticArrival:true,dutyModes:["manual"],grants:[]};
const status=()=>({policy,company:{type:"vendor",id:3},userId:8,vendorId:3,consent:{locationSharing:false},duty:{active:false},canManagePolicy:m.manage,devices:[],workers:[],requests:[]});
function mount(){m.request.mockImplementation(async(p:string)=>p==="/status"?status():policy);return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><NativeOperations/></QueryClientProvider>);}
afterEach(()=>{cleanup();m.manage=true;vi.clearAllMocks();});
it("lets only company policy managers enable the driver pause slider, preserving policy",async()=>{
 mount();const slider=await screen.findByRole("switch",{name:"Allow drivers to pause run location sharing"});expect(slider.getAttribute("aria-checked")).toBe("false");fireEvent.click(slider);
 await waitFor(()=>expect(m.request).toHaveBeenCalledWith("/policy",expect.objectContaining({method:"PUT",body:JSON.stringify({...policy,allowDriverLocationPause:true})})));
});
it("does not expose company pause settings to a worker",async()=>{
 m.manage=false;mount();await screen.findByText("Off duty");expect(screen.queryByRole("switch",{name:"Allow drivers to pause run location sharing"})).toBeNull();
});
