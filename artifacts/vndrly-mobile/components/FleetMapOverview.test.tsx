import React from "react";
import {render,screen,cleanup,fireEvent} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
vi.mock("@expo/vector-icons",()=>({Feather:()=>null}));
const mocks=vi.hoisted(()=>({map:vi.fn(),query:vi.fn()}));
vi.mock("./MapboxNativeMap",()=>({default:(props:any)=>{mocks.map(props);return <div>Location map</div>;}}));
vi.mock("./MapRouteReplay",()=>({default:()=> <div>Replay</div>}));
vi.mock("./ImagePill",()=>({default:({children,accessibilityLabel}:any)=><span aria-label={accessibilityLabel}>{children}</span>}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:1},activeMembershipId:1})}));
vi.mock("@/lib/api",()=>({apiFetch:vi.fn()}));
vi.mock("@tanstack/react-query",()=>({useQuery:(q:any)=>mocks.query(q)}));
vi.mock("@/hooks/useColors",()=>({useColors:()=>({primary:"cyan",foreground:"white",card:"black",mutedForeground:"grey"})}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>((text:string)=>text)}));
import FleetMapOverview from "./FleetMapOverview";
afterEach(()=>{cleanup();vi.clearAllMocks();});
function show(){mocks.query.mockImplementation((q:any)=>q.queryKey[0]==="fleet-map-context"?{data:{company:{name:"MidCon",latitude:35.5495535,longitude:-97.282776,address:"Jones"},sites:[]}}:{});render(<FleetMapOverview overview={{companyId:7,fleets:[],runs:[],observations:[]} as any} resources={{equipment:[{id:"truck",name:"Idle truck"}],drivers:[{userId:1,name:"Idle driver"}]} as any} onOpen={vi.fn()}/>);}
function context(data:any){mocks.query.mockImplementation((q:any)=>q.queryKey[0]==="fleet-map-context"?{data}:{});}
it("opens at company coordinates with no reported GPS and lists idle resources",()=>{show();expect(screen.getByText("Idle truck")).toBeTruthy();expect(screen.getByText("Idle driver")).toBeTruthy();expect(screen.getAllByText("No reported location")).toHaveLength(2);expect(screen.getByText("Location map")).toBeTruthy();expect(mocks.map.mock.lastCall![0].center).toEqual([-97.282776,35.5495535]);expect(mocks.map.mock.lastCall![0].controls).toBe(true);});
it("offers recorded history without fabricating an empty run",()=>{show();fireEvent.click(screen.getByText("History & Replay"));expect(screen.getByText("No runs in this view.")).toBeTruthy();expect(screen.queryByText("Replay")).toBeNull();});
it("shows the advisory VNDRLY compliance status on the company marker without replacing location freshness",()=>{
 mocks.query.mockImplementation((q:any)=>q.queryKey[0]==="fleet-map-context"?{data:{company:{name:"MidCon",latitude:35.5,longitude:-97.2},sites:[]}}:q.queryKey[0]==="fleet-map-compliance"?{data:{companyId:7,score:42,status:"red",advisoryOnly:true,evaluatedAt:"2026-10-20T12:00:00Z",categories:[],deductions:[],history:[]}}:{});
 render(<FleetMapOverview overview={{companyId:7,fleets:[],runs:[],observations:[]} as any} resources={{equipment:[],drivers:[]} as any} onOpen={vi.fn()}/>);
 expect(screen.getByLabelText("VNDRLY compliance status · red · 42 out of 100")).toBeTruthy();
 expect(mocks.map.mock.lastCall![0].points.find((p:any)=>p.id==="center")).toMatchObject({color:"#DC2626"});
});
it("follows only a reporting driver and returns to company center",()=>{context({company:{name:"MidCon",latitude:35.5,longitude:-97.2},sites:[]});render(<FleetMapOverview overview={{companyId:7,fleets:[],runs:[{id:"run",siteIds:[9],driverUserId:2,vehicleAssetId:"truck",linkedTicketId:10,status:"in_progress",title:"Synthetic run",events:[]}],observations:[{runId:"run",latitude:36,longitude:-98,freshness:"recent",recordedAt:"2026-01-01T00:00:00Z"}]} as any} resources={{equipment:[],drivers:[{userId:2,name:"Synthetic driver",fleetIds:[]}]} as any} onOpen={vi.fn()}/>);fireEvent.click(screen.getByText("Follow · Synthetic driver"));expect(mocks.map.mock.lastCall![0].center).toEqual([-98,36]);fireEvent.click(screen.getByText("Center company"));expect(mocks.map.mock.lastCall![0].center).toEqual([-97.2,35.5]);});
it("numbers the latest vehicle positions, hides stale pins until requested and supports map expansion",()=>{
 context({company:{name:"Synthetic HQ",latitude:35.5,longitude:-97.2},sites:[]});
 const runs=[{id:"r1",siteIds:[9],driverUserId:2,vehicleAssetId:"truck",linkedTicketId:null,status:"in_progress",title:"Synthetic current",events:[]},{id:"r2",siteIds:[9],driverUserId:3,vehicleAssetId:"trailer",linkedTicketId:null,status:"paused",title:"Synthetic stale",events:[]}];
 const point=(runId:string,freshness:string,recordedAt:string,latitude:number)=>({runId,freshness,recordedAt,latitude,longitude:-98});
 render(<FleetMapOverview overview={{companyId:7,fleets:[],runs,observations:[point("r1","recent","2026-10-15T12:00:00Z",36),point("r1","recent","2026-10-15T11:00:00Z",35),point("r2","stale","2026-10-14T12:00:00Z",34)]} as any} resources={{equipment:[],drivers:[]} as any} onOpen={vi.fn()}/>);
 let points=mocks.map.mock.lastCall![0].points.filter((p:any)=>p.id!=="center");
 expect(points).toHaveLength(1);expect(points[0]).toMatchObject({label:"1",latitude:36,color:"#1E5BD0"});
 fireEvent.click(screen.getByRole("checkbox",{name:"Show stale / paused positions (1)"}));
 points=mocks.map.mock.lastCall![0].points.filter((p:any)=>p.id!=="center");
 expect(points).toHaveLength(2);expect(points[1]).toMatchObject({label:"2",color:"#6b7280"});
 const before=mocks.map.mock.lastCall![0].height;fireEvent.click(screen.getByText("Expand map"));expect(mocks.map.mock.lastCall![0].height).toBeGreaterThan(before);
});
it("labels VNDRLY location source, freshness confidence and capture time",()=>{
 context({company:{name:"Synthetic HQ",latitude:35.5,longitude:-97.2},sites:[]});
 render(<FleetMapOverview overview={{companyId:7,fleets:[],runs:[{id:"r1",siteIds:[9],driverUserId:2,vehicleAssetId:"truck",linkedTicketId:null,status:"in_progress",title:"Synthetic current",events:[]}],observations:[{runId:"r1",vehicleAssetId:"truck",driverUserId:2,latitude:36,longitude:-98,accuracyMeters:18,source:"driver_phone",freshness:"recent",recordedAt:"2026-10-15T12:00:00Z",receivedAt:"2026-10-15T12:00:01Z",physicalProofVerified:false}]} as any} resources={{equipment:[],drivers:[]} as any} onOpen={vi.fn()}/>);
 expect(screen.getAllByText(/VNDRLY driver phone · Current observation/).length).toBeGreaterThan(0);
 expect(screen.getByText(/Phone locations identify the reporting driver/)).toBeTruthy();
});

it("searches recorded history by driver, truck, run or ticket",()=>{
 context({company:{name:"Synthetic HQ",latitude:35.5,longitude:-97.2},sites:[]});
 render(<FleetMapOverview overview={{companyId:7,fleets:[],runs:[{id:"r1",siteIds:[9],driverUserId:2,vehicleAssetId:"truck",linkedTicketId:42,status:"completed",title:"North haul",events:[],labels:{driverName:"Dana Driver",vehicleName:"Truck 12"}},{id:"r2",siteIds:[9],driverUserId:3,vehicleAssetId:"truck2",linkedTicketId:43,status:"completed",title:"South haul",events:[],labels:{driverName:"Pat Driver",vehicleName:"Truck 9"}}],observations:[]} as any} resources={{equipment:[],drivers:[]} as any} onOpen={vi.fn()}/>);
 fireEvent.click(screen.getByText("History & Replay"));
 fireEvent.change(screen.getByLabelText("Search Fleet history"),{target:{value:"Truck 12"}});
 fireEvent.click(screen.getByRole("button",{name:"Choose recorded run"}));
 expect(screen.getByText(/North haul/)).toBeTruthy();expect(screen.queryByText(/South haul/)).toBeNull();
});
