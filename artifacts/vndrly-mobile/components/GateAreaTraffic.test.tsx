import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const state=vi.hoisted(()=>({canOperate:true,read:vi.fn(),record:vi.fn()}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{id:7},activeMembershipId:1})}));
vi.mock('@/hooks/useColors',()=>({useColors:()=>({foreground:'#fff',primary:'#f90'})}));
vi.mock('@/hooks/use-gate-operating-context',()=>({useGateOperatingContext:()=>({canOperate:()=>state.canOperate})}));
vi.mock('@/lib/gate-traffic',async()=>({parallelGateGroup:(await import('@workspace/gate-booth')).parallelGateGroup,readGateAreaTraffic:state.read,recordGateMovement:state.record}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('./TogglePillButton',()=>({default:({children,disabled,onPress}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
vi.mock('expo-crypto',()=>({randomUUID:()=> 'stable-operation'}));
import GateAreaTraffic from './GateAreaTraffic';
beforeEach(()=>{state.canOperate=true;state.record.mockReset();state.read.mockResolvedValue({gates:[{id:'inner',siteId:2,name:'Inner',active:true,topology:{area:'secure',parentGateId:null}}],movementGateIds:['inner'],visits:[{id:4,firstName:'Pat',lastName:'Driver',vehiclePlate:'ABC',checkOutTime:null,movements:[],presence:{currentGateId:null,expectedGateId:'inner',label:'Awaiting arrival'}}]});});
afterEach(cleanup);
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><GateAreaTraffic siteId={2} gateId="inner"/></QueryClientProvider>);}
it('browsing another gate cannot record an internal arrival',async()=>{state.canOperate=false;mount();const button=await screen.findByText('gateMovement.enter');expect((button as HTMLButtonElement).disabled).toBe(true);fireEvent.click(button);expect(state.record).not.toHaveBeenCalled();});
it('retains operation ID on uncertain-response retry',async()=>{state.record.mockRejectedValueOnce(Error('timeout')).mockResolvedValueOnce({});mount();fireEvent.click(await screen.findByText('gateMovement.enter'));await screen.findByText('timeout');await waitFor(()=>expect((screen.getByText('gateMovement.enter') as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByText('gateMovement.enter'));await waitFor(()=>expect(state.record).toHaveBeenCalledTimes(2));expect(state.record.mock.calls[0][0]).toEqual(state.record.mock.calls[1][0]);expect(state.record.mock.calls[0][0]).toMatchObject({siteId:2,gateId:'inner',visitId:4,kind:'enter',operationId:'stable-operation'});});
