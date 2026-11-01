import {cleanup,render,screen,fireEvent,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {EquipmentForm} from "./equipment-form";
import {equipmentFixture} from "./fixture.test-data";
const mocks=vi.hoisted(()=>({request:vi.fn(),upload:vi.fn()}));
vi.mock("./client",()=>({equipmentRequest:mocks.request,equipmentPhoto:(p:string)=>p.startsWith("/objects/")?`/api/storage${p}`:p}));
vi.mock("@/lib/fleet-evidence-upload",()=>({uploadFleetEvidence:mocks.upload}));
vi.mock("@/hooks/use-brand",()=>({useBrand:()=>({name:"Company",primary:"#f0b323"})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const show=(props:Partial<React.ComponentProps<typeof EquipmentForm>>={})=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EquipmentForm identity="vendor:1" action="checkout" item={equipmentFixture} items={[equipmentFixture]} onClose={()=>{}} onSaved={async()=>{}} {...props}/></QueryClientProvider>);
it("checks equipment out for a task without reusing catalogue photos as condition evidence",async()=>{
 mocks.request.mockImplementation(async(path:string)=>path==="/options"?{people:[],tickets:[],tasks:[{id:"00000000-0000-4000-8000-000000000002",label:"Repair gate"}],sites:[]}:equipmentFixture);
 show({item:{...equipmentFixture,profile:{...equipmentFixture.profile,photoUrls:["/api/storage/objects/uploads/00000000-0000-4000-8000-000000000003"]}}});
 fireEvent.change(screen.getByLabelText("Work (optional)"),{target:{value:"task"}});await screen.findByRole("option",{name:"Repair gate"});fireEvent.change(screen.getByLabelText("Task"),{target:{value:"00000000-0000-4000-8000-000000000002"}});
 fireEvent.click(screen.getByRole("button",{name:"Check Out Equipment"}));await waitFor(()=>expect(mocks.request.mock.calls.some(c=>c[0].endsWith("/operations"))).toBe(true));
 const input=JSON.parse(mocks.request.mock.calls.find(c=>c[0].endsWith("/operations"))![1].body);expect(input.action).toBe("checkout");expect(input.taskId).toBe("00000000-0000-4000-8000-000000000002");expect(input.photos).toEqual([]);expect(input.assignedUserId).toBeUndefined();
});
it("saves uploaded equipment photos as canonical storage references with tracking",async()=>{
 mocks.upload.mockResolvedValue("/objects/uploads/00000000-0000-4000-8000-000000000003");mocks.request.mockResolvedValue(equipmentFixture);show({action:"add",item:undefined});
 fireEvent.change(screen.getByLabelText("Name"),{target:{value:"New booth"}});fireEvent.click(screen.getByLabelText("Track on Map"));fireEvent.change(screen.getByLabelText("Add photo"),{target:{files:[new File(["photo"],"booth.jpg",{type:"image/jpeg"})]}});await screen.findByAltText("Equipment photo");
 fireEvent.click(screen.getByRole("button",{name:"Add Equipment"}));await waitFor(()=>expect(mocks.request).toHaveBeenCalled());const body=JSON.parse(mocks.request.mock.calls[0][1].body);expect(body.trackOnMap).toBe(true);expect(body.photoUrls).toEqual(["/api/storage/objects/uploads/00000000-0000-4000-8000-000000000003"]);
});
