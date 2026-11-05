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
import {GateAreaTraffic} from './gate-area-traffic';
afterEach(()=>{cleanup();vi.clearAllMocks();});
const gates=[{id:'main',name:'Main',active:true,topology:null},{id:'one',name:'Well 1',active:true,topology:{area:'Area 1'}},{id:'two',name:'Well 2',active:true,topology:{area:'Area 2'}}];
const visit=(id:number,current:string,expected:string|null=null,exit=false)=>({id,firstName:'Visitor'+id,lastName:'Test',movements:[],checkOutTime:null,presence:{currentGateId:current,expectedGateId:expected,expectedSiteExit:exit,label:'On site'}});
function show(gateId:string,view:any){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateAreaTraffic siteId={1} gateId={gateId} view={view}/></QueryClientProvider>);}
it('shows only this secure area then lets the gatekeeper find an unexpected arrival already on site',async()=>{
 mocks.data={gates,visits:[visit(1,'one'),visit(2,'two')]};show('one','on_site');await screen.findByText('Visitor1 Test');expect(screen.queryByText('Visitor2 Test')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Find someone/}));await screen.findByText('Visitor2 Test');
 const second=screen.getByText('Visitor2 Test').closest('article')!;fireEvent.click(second.querySelectorAll('button')[1]);await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith('/movements',expect.objectContaining({visitId:2,gateId:'one',kind:'enter'})));
});
it('uses the established site checkout for an expected Main Gate departure',async()=>{
 mocks.checkout.mockResolvedValue({});mocks.data={gates,visits:[visit(3,'main',null,true)]};show('main','departures');fireEvent.click(await screen.findByRole('button',{name:'Confirm site departure'}));await waitFor(()=>expect(mocks.checkout).toHaveBeenCalledWith(3,undefined,undefined,undefined,'main'));expect(mocks.request).not.toHaveBeenCalled();
});
it('does not invent an expected arrival at a different secure area',async()=>{mocks.data={gates,visits:[visit(4,'one','two'),visit(5,'main',null,true)]};show('two','arrivals');await screen.findByText('Visitor4 Test');expect(screen.queryByText('Visitor5 Test')).toBeNull();});
