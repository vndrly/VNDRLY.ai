import React from "react";
import {render,screen,cleanup,fireEvent} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
vi.mock("@expo/vector-icons",()=>({Feather:()=>null}));
const mocks=vi.hoisted(()=>({map:vi.fn(),query:vi.fn()}));
vi.mock("./MapboxNativeMap",()=>({default:(props:any)=>{mocks.map(props);return <div>Location map</div>;}}));
vi.mock("./MapRouteReplay",()=>({default:()=> <div>Replay</div>}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:1},activeMembershipId:1})}));
vi.mock("@/lib/api",()=>({apiFetch:vi.fn()}));
vi.mock("@tanstack/react-query",()=>({useQuery:(q:any)=>mocks.query(q)}));
vi.mock("@/hooks/useColors",()=>({useColors:()=>({primary:"cyan",foreground:"white",card:"black",mutedForeground:"grey"})}));
vi.mock("@/lib/fleet-copy",()=>({useFleetCopy:()=>((text:string)=>text)}));
import FleetMapOverview from "./FleetMapOverview";
afterEach(()=>{cleanup();vi.clearAllMocks();});
function show(){mocks.query.mockImplementation((q:any)=>q.queryKey[0]==="fleet-map-context"?{data:{company:{name:"MidCon",latitude:35.5495535,longitude:-97.282776,address:"Jones"},sites:[]}}:{});render(<FleetMapOverview overview={{companyId:7,fleets:[],runs:[],observations:[]} as any} resources={{equipment:[{id:"truck",name:"Idle truck"}],drivers:[{userId:1,name:"Idle driver"}]} as any} onOpen={vi.fn()}/>);}
it("opens at company coordinates with no reported GPS and lists idle resources",()=>{show();expect(screen.getByText("Idle truck")).toBeTruthy();expect(screen.getByText("Idle driver")).toBeTruthy();expect(screen.getAllByText("No reported location")).toHaveLength(2);expect(screen.getByText("Location map")).toBeTruthy();expect(mocks.map.mock.lastCall![0].center).toEqual([-97.282776,35.5495535]);expect(mocks.map.mock.lastCall![0].controls).toBe(true);});
it("offers recorded history without fabricating an empty run",()=>{show();fireEvent.click(screen.getByText("History & Replay"));expect(screen.getByText("No runs in this view.")).toBeTruthy();expect(screen.queryByText("Replay")).toBeNull();});
it("follows only a reporting driver and returns to company center",()=>{mocks.query.mockReturnValue({data:{company:{name:"MidCon",latitude:35.5,longitude:-97.2},sites:[]}});render(<FleetMapOverview overview={{companyId:7,fleets:[],runs:[{id:"run",siteIds:[9],driverUserId:2,vehicleAssetId:"truck",linkedTicketId:10,status:"in_progress",title:"Synthetic run",events:[]}],observations:[{runId:"run",latitude:36,longitude:-98,freshness:"recent",recordedAt:"2026-01-01T00:00:00Z"}]} as any} resources={{equipment:[],drivers:[{userId:2,name:"Synthetic driver",fleetIds:[]}]} as any} onOpen={vi.fn()}/>);fireEvent.click(screen.getByText("Follow · Synthetic driver"));expect(mocks.map.mock.lastCall![0].center).toEqual([-98,36]);fireEvent.click(screen.getByText("Center company"));expect(mocks.map.mock.lastCall![0].center).toEqual([-97.2,35.5]);});
