import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const env=vi.hoisted(()=>({request:vi.fn(),crews:[] as any[]}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{userId:1,vendorId:1054,partnerId:null,role:"vendor",membershipRole:"admin"}})}));
vi.mock("@/lib/work-hub-client",async original=>({...await original<any>(),workHubRequest:env.request}));
import {WorkCrews} from "./work-crews";
const crew={id:"11111111-1111-4111-8111-111111111111",name:"Travel crew",purpose:"Travel",noExpiry:false,expired:false,expiresAt:"2027-01-01T00:00:00Z",members:[{userId:1,name:"John"},{userId:2,name:"Ann"}]};
beforeEach(()=>{env.crews=[];env.request.mockReset().mockImplementation(async (path:string,init?:RequestInit)=>init?.method==='POST'?{resource:{name:"Travel crew",memberCount:2}}:{canManage:true,workers:[{userId:1,name:"John"},{userId:2,name:"Ann"},{userId:3,name:"Other worker"}],crews:env.crews});});
afterEach(cleanup);
function mount(){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><WorkCrews/></QueryClientProvider>);}
it("orders worker choices by their last names, including a multiword surname",async()=>{
 env.request.mockResolvedValue({canManage:true,crews:[],workers:[{userId:1,name:'Alice Zane',lastName:'Zane'},{userId:2,name:'Beth Adams',lastName:'Adams'},{userId:3,name:'Chris Cruz',lastName:'de la Cruz'}]});
 mount();fireEvent.click(screen.getByRole('button',{name:'Create work crew'}));
 const pool=within(screen.getByRole('group',{name:'Company workers'}));await pool.findByLabelText('Beth Adams');
 expect(pool.getAllByRole('checkbox').map(input=>input.closest('label')?.textContent)).toEqual(['Beth Adams','Chris Cruz','Alice Zane (you)']);
});
it("creates a crew from selected company workers with an explicit expiration bypass",async()=>{
 mount();fireEvent.click(screen.getByRole('button',{name:'Create work crew'}));
 const form=within(screen.getByRole('form',{name:'Create work crew'}));
 fireEvent.change(form.getByLabelText('Crew name'),{target:{value:'Travel crew'}});
 fireEvent.click(await form.findByLabelText('John (you)'));fireEvent.click(form.getByLabelText('Ann'));
 expect((form.getByLabelText('Do not expire') as HTMLInputElement).checked).toBe(false);fireEvent.click(form.getByLabelText('Do not expire'));
 fireEvent.click(form.getByRole('button',{name:'Create work crew'}));
 await screen.findByRole('status');
 const payload=JSON.parse(env.request.mock.calls.find(([,init])=>init?.method==='POST')![1].body).payload;
 expect(payload).toMatchObject({name:'Travel crew',userIds:[1,2],noExpiry:true});
});
it("shows the whole crew before assignment and reuses the operation after a lost response",async()=>{
 env.crews=[crew];let posts=0;
 env.request.mockImplementation(async (_path:string,init?:RequestInit)=>{if(init?.method==='POST'){if(++posts===1)throw Error('Response lost');return {resource:{memberCount:2}};}return {canManage:true,workers:[],crews:env.crews};});
 mount();fireEvent.click(await screen.findByRole('button',{name:'Assign job'}));
 const form=within(screen.getByRole('form',{name:'Assign job to crew'}));expect(form.getByText('John, Ann')).toBeTruthy();
 fireEvent.change(form.getByLabelText('Job title'),{target:{value:'Out-of-town job'}});fireEvent.click(form.getByRole('button',{name:'Assign to whole crew'}));
 await screen.findByRole('alert');await waitFor(()=>expect((form.getByRole('button',{name:'Assign to whole crew'}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(form.getByRole('button',{name:'Assign to whole crew'}));await screen.findByRole('status');
 const commands=env.request.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(init.body));
 expect(commands[0].operationId).toBe(commands[1].operationId);expect(commands[0].payload.title).toBe('Out-of-town job');
});
