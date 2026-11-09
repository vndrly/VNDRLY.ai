import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({request:vi.fn(),checkout:vi.fn(),data:{} as any}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{userId:1}})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({i18n:{language:'en'}})}));
vi.mock('@/lib/change-over-api',()=>({changeOverRequest:(path:string,body?:any)=>body?mocks.request(path,body):Promise.resolve(mocks.data)}));
vi.mock('@/lib/visits-api',()=>({visitsApi:{gateCheckOut:mocks.checkout}}));
vi.mock('./work-hub/chrome',()=>({BrandedSelect:(props:any)=><select {...props}/>}));
import {GateAreaTraffic,GateMovementLocationSummary,gateCheckInDestinationDefaults,parallelGateGroup} from './gate-area-traffic';
afterEach(()=>{cleanup();vi.clearAllMocks();});
const gates=[{id:'main',name:'Main',active:true,topology:null},{id:'one',name:'Well 1',active:true,topology:{area:'Area 1'}},{id:'two',name:'Well 2',active:true,topology:{area:'Area 2'}}];
const visit=(id:number,current:string,expected:string|null=null,exit=false)=>({id,firstName:'Visitor'+id,lastName:'Test',movements:[],checkOutTime:null,presence:{currentGateId:current,expectedGateId:expected,expectedSiteExit:exit,label:'On site'}});
function show(gateId:string,view:any){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateAreaTraffic siteId={1} gateId={gateId} view={view}/></QueryClientProvider>);}
it('shows only this secure area then lets the gatekeeper find an unexpected arrival already on site',async()=>{
 mocks.data={gates,visits:[visit(1,'one'),visit(2,'two')]};show('one','on_site');await screen.findByText('Visitor1 Test');expect(screen.queryByText('Visitor2 Test')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Find someone/}));await screen.findByText('Visitor2 Test');
 const second=screen.getByText('Visitor2 Test').closest('article')!;fireEvent.click(second.querySelector('button')!);await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('/movements',expect.objectContaining({visitId:2,gateId:'one',kind:'enter'})));
});
it('uses the established site checkout for an expected Main Gate departure',async()=>{
 mocks.checkout.mockResolvedValue({});mocks.data={gates,visits:[visit(3,'main',null,true)]};show('main','departures');fireEvent.click(await screen.findByRole('button',{name:'Check out'}));await waitFor(()=>expect(mocks.checkout).toHaveBeenCalledWith(3,undefined,undefined,undefined,'main'));expect(mocks.request).not.toHaveBeenCalled();
});
it('does not invent an expected arrival at a different secure area',async()=>{mocks.data={gates,visits:[visit(4,'one','two'),visit(5,'main',null,true)]};show('two','arrivals');await screen.findByText('Visitor4 Test');expect(screen.queryByText('Visitor5 Test')).toBeNull();});

it('keeps confirmed arrivals neutral and restricts their controls to the responsible gate',async()=>{
 const arrived=visit(6,'one');arrived.movements=[{operationId:'arrival',kind:'enter',gateId:'one',gateName:'Well 1',area:'Area 1',destination:'remain',at:new Date().toISOString()}] as any;
 mocks.data={gates,visits:[arrived]};show('one','arrivals');const row=(await screen.findByText('Visitor6 Test')).closest('article')!;
 expect(row.className).not.toContain('gate-movement-pending');expect(screen.queryByRole('button',{name:'Confirm arrival'})).toBeNull();expect(screen.getByRole('button',{name:'Check out'})).toBeTruthy();
});
it('marks expected arrivals pending and confirms only at their destination gate',async()=>{
 mocks.data={gates,visits:[visit(7,'main','one')]};show('one','arrivals');const row=(await screen.findByText('Visitor7 Test')).closest('article')!;expect(row.className).toContain('gate-movement-pending');
 fireEvent.click(screen.getByRole('button',{name:'Confirm arrival'}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('/movements',expect.objectContaining({visitId:7,gateId:'one',kind:'enter'})));
});
it('allows early outer checkout but does not offer outer checkout for confirmed inner presence',async()=>{
 mocks.data={gates,visits:[visit(8,'main','one'),visit(9,'one')]};show('main','on_site');await screen.findByText('Visitor8 Test');const rows=screen.getAllByRole('article');expect(rows[0].querySelector('button')?.textContent).toBe('Check out');expect(rows[1].querySelector('button')).toBeNull();
});
it('offers an ungated named destination on inner checkout using the destination contract',async()=>{
 mocks.data={gates:[{...gates[0],topology:{area:'',destinations:[{id:'yard',name:'Equipment yard',gateId:null}]}},{...gates[1],topology:{area:'Area 1',parentGateId:'main'}}],visits:[visit(10,'one')]};show('one','on_site');await screen.findByText('Visitor10 Test');fireEvent.change(screen.getByRole('combobox'),{target:{value:'yard'}});fireEvent.click(screen.getByRole('button',{name:'Check out'}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('/movements',expect.objectContaining({kind:'leave',destinationId:'yard'})));
});
it('shows a stale-state failure and refreshes the queue',async()=>{
 mocks.request.mockRejectedValueOnce(new Error('Presence changed. Refresh and try again.'));
 mocks.data={gates,visits:[visit(11,'main','one')]};show('one','arrivals');fireEvent.click(await screen.findByRole('button',{name:'Confirm arrival'}));await screen.findByText('Presence changed. Refresh and try again.');expect(screen.getByRole('button',{name:'Confirm arrival'}).hasAttribute('disabled')).toBe(false);
});

it('shows last confirmed location separately from intended destination and disclaims live GPS',async()=>{
 const v=visit(12,'main','one');Object.assign(v.presence,{lastConfirmedGateId:'main',lastConfirmedLocation:'Warwick Completions 1',intendedDestination:'Warwick Roman Completions 2'});mocks.data={gates,visits:[v]};
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateMovementLocationSummary siteId={1} gateId="one"/></QueryClientProvider>);
 await screen.findByText('Last confirmed location: Warwick Completions 1');expect(screen.getByText('Intended destination: Warwick Roman Completions 2')).toBeTruthy();expect(screen.getByText(/not live GPS/)).toBeTruthy();
});

it('defaults the sole active child without inventing a choice when several children exist',()=>{
 const child={...gates[1],topology:{area:'Area 1',parentGateId:'main'}};expect(gateCheckInDestinationDefaults([gates[0],child] as any,'main')).toEqual({destinationGateId:'one',destinationId:undefined});
 expect(gateCheckInDestinationDefaults([gates[0],child,{...gates[2],topology:{area:'Area 2',parentGateId:'main'}}] as any,'main').destinationGateId).toBeUndefined();
});
it('respects an explicit named default including an ungated destination',()=>{
 const main={...gates[0],topology:{destinations:[{id:'yard',name:'Equipment yard',gateId:null},{id:'well',name:'Well',gateId:'one'}],defaultDestinationId:'yard'}};
 expect(gateCheckInDestinationDefaults([main] as any,'main')).toEqual({destinationId:'yard',destinationGateId:undefined});
});
it('routes or clears a pending destination from the outer gate without an inner confirmation',async()=>{
 mocks.data={gates:[gates[0],{...gates[1],topology:{area:'Area 1',parentGateId:'main'}}],visits:[visit(13,'main','one')]};show('main','on_site');await screen.findByText('Visitor13 Test');
 fireEvent.click(screen.getByRole('button',{name:'Set destination'}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('/movements',expect.objectContaining({visitId:13,kind:'route',destination:'remain'})));
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'one'}});fireEvent.click(screen.getByRole('button',{name:'Set destination'}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('/movements',expect.objectContaining({visitId:13,kind:'route',destinationGateId:'one'})));
});
it('supports an ungated-only destination configuration and shows the early-exit audit note',async()=>{
 const v=visit(14,'main');v.movements=[{operationId:'exit',kind:'site_exit',gateId:'main',gateName:'Main',at:new Date().toISOString(),destination:'site_exit',note:'Exited before inner arrival'}] as any;
 mocks.data={gates:[{...gates[0],topology:{area:'',destinations:[{id:'yard',name:'Equipment yard',gateId:null}]}}],visits:[v]};show('main','on_site');await screen.findByText('Visitor14 Test');expect(screen.getByText(/Exited before inner arrival/)).toBeTruthy();
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'yard'}});fireEvent.click(screen.getByRole('button',{name:'Set destination'}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('/movements',expect.objectContaining({kind:'route',destinationId:'yard'})));
});
it('allows checkout at a parallel gate for confirmed presence in the same area',async()=>{
 mocks.data={gates:[gates[0],gates[1],{...gates[2],topology:{area:'Area 1',kind:'parallel',parallelGateId:'one'}}],visits:[visit(15,'one')]};show('two','on_site');await screen.findByText('Visitor15 Test');expect(screen.queryByRole('button',{name:'Confirm arrival'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Check out'}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('/movements',expect.objectContaining({visitId:15,gateId:'two',kind:'leave'})));
});
it('does not offer confirmation at a parallel gate when arrival is assigned to its sibling',async()=>{
 mocks.data={gates:[gates[0],gates[1],{...gates[2],topology:{area:'Area 1',kind:'parallel',parallelGateId:'one'}}],visits:[visit(16,'main','one')]};show('two','arrivals');await screen.findByText('No internal movements in this queue.');expect(screen.queryByRole('button',{name:'Confirm arrival'})).toBeNull();
});

it('shares outer visits across an undirected parallel gate group in both directions',async()=>{
 const sibling={...gates[0],id:'side',name:'Side',topology:{area:'',parallelGateId:'main'}};
 const first={...visit(17,'main'),entryGateId:'main'},second={...visit(18,'side'),entryGateId:'side'};mocks.data={gates:[...gates,sibling],visits:[first,second]};
 show('main','on_site');await screen.findByText('Visitor17 Test');expect(screen.getByText('Visitor18 Test')).toBeTruthy();cleanup();show('side','on_site');await screen.findByText('Visitor18 Test');expect(screen.getByText('Visitor17 Test')).toBeTruthy();
});
it('resolves parallel gate groups transitively and excludes unrelated roots',()=>{
 const chain=[{id:'a',topology:null},{id:'b',topology:{parallelGateId:'a'}},{id:'c',topology:{parallelGateId:'b'}},{id:'other',topology:null}] as any;
 expect([...parallelGateGroup(chain,'a')].sort()).toEqual(['a','b','c']);expect([...parallelGateGroup(chain,'c')].sort()).toEqual(['a','b','c']);
});
