import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import en from '@/lib/locales/en.json';
const env=vi.hoisted(()=>({api:vi.fn(),generation:1,listeners:[] as (()=>void)[],user:{id:17,role:'vendor',vendorId:4}}));
vi.mock('@/lib/api',()=>({apiFetch:env.api}));
vi.mock('@/lib/auth',()=>({getUser:async()=>env.user,captureAuthScope:()=>({generation:env.generation}),isAuthScopeCurrent:(s:any)=>s.generation===env.generation,subscribeUser:(f:()=>void)=>{env.listeners.push(f);return()=>{}},subscribeToken:()=>()=>{}}));
vi.mock('@/hooks/useColors',()=>({useColors:()=>({text:'#fff',mutedForeground:'#aaa',border:'#444'})}));
vi.mock('@/components/TogglePillButton',()=>({default:({children,onPress,disabled,accessibilityLabel}:any)=><button disabled={disabled} onClick={onPress} aria-label={accessibilityLabel}>{children}</button>}));
vi.mock('react-native',()=>({View:({children}:any)=><div>{children}</div>,Text:({children}:any)=><span>{children}</span>,TextInput:({onChangeText,accessibilityLabel,value,editable}:any)=><input aria-label={accessibilityLabel} disabled={editable===false} value={value} onChange={e=>onChangeText(e.target.value)}/>}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key.split('.').reduce((v:any,k)=>v?.[k],en)??key})}));
vi.mock('@/lib/native-uuid',()=>({nativeUuid:()=>crypto.randomUUID()}));
import {InventoryRecovery} from './InventoryRecovery';
const assetId='11111111-1111-4111-8111-111111111111';
const detail={id:assetId,version:4,holderUserId:17,lastCustody:{holderDisplayName:'Recorded driver',holderUserId:17,recordedAt:'2026-10-07T12:00:00Z'},gpsTag:{status:'not_connected',location:null}};
const props={assetId,owner:{type:'vendor' as const,id:4},canManage:false,onRefresh:vi.fn()};
beforeEach(()=>{env.api.mockReset();env.generation=1;env.listeners=[];props.onRefresh.mockReset()});afterEach(cleanup);
async function open(){fireEvent.click(screen.getByRole('button',{name:'Inventory recovery and identifier review'}));await screen.findByText('Recorded driver');}
describe('native Inventory recovery',()=>{
 it('records own-holder loss with exact reviewed request and no physical loss claim',async()=>{
  env.api.mockImplementation(async(path:string,init:any)=>init?.method==='POST'?{assetId,...JSON.parse(init.body),version:5,status:'applied',holderUserId:17,reportedAt:'2026-10-07T12:00:00Z',physicalLossVerified:false}:detail);
  render(<InventoryRecovery {...props}/>);await open();fireEvent.click(screen.getByRole('button',{name:'Report missing'}));fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Unable to locate recorded equipment'}});fireEvent.click(screen.getByRole('button',{name:'Review exact request'}));fireEvent.click(screen.getByRole('button',{name:'Confirm reviewed request'}));await screen.findByText('Canonical record saved.');
  const call=env.api.mock.calls.find(c=>c[1]?.method==='POST')!;expect(call[0]).toBe(`/api/implementation-a/assets/${assetId}/loss-report`);expect(JSON.parse(call[1].body)).toMatchObject({expectedVersion:4,condition:'missing',confirmed:true});expect(props.onRefresh).toHaveBeenCalledOnce();
 });
 it('retains exact UUID/version/body after unknown result and refuses substituted receipt',async()=>{
  let count=0;env.api.mockImplementation(async(_path:string,init:any)=>{if(init?.method==='POST'){if(++count===1)throw Error('network lost');return {assetId:'other',...JSON.parse(init.body),version:5,status:'applied',physicalLossVerified:false}}return detail});
  render(<InventoryRecovery {...props}/>);await open();fireEvent.click(screen.getByRole('button',{name:'Report stolen'}));fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Reported stolen'}});fireEvent.click(screen.getByRole('button',{name:'Review exact request'}));fireEvent.click(screen.getByRole('button',{name:'Confirm reviewed request'}));await screen.findByRole('button',{name:'Retry exact request'});fireEvent.click(screen.getByRole('button',{name:'Retry exact request'}));await waitFor(()=>expect(count).toBe(2));const calls=env.api.mock.calls.filter(c=>c[1]?.method==='POST');expect(calls[0][1].body).toBe(calls[1][1].body);expect(props.onRefresh).not.toHaveBeenCalled();
 });
 it('clears current records and pending review after account invalidation',async()=>{
  env.api.mockResolvedValue(detail);render(<InventoryRecovery {...props}/>);await open();fireEvent.click(screen.getByRole('button',{name:'Report missing'}));env.generation++;env.listeners.forEach(f=>f());await waitFor(()=>expect(screen.queryByLabelText('Reason')).toBeNull());expect(screen.queryByText('Recorded driver')).toBeNull();
 });
 it('uses exact manager claim and saved claim receipt without exposing another owner',async()=>{
  env.api.mockImplementation(async(path:string,init:any)=>{if(init?.method==='POST'){const b=JSON.parse(init.body);return {id:b.claimId,assetId,operationId:b.operationId,version:1,status:'pending_review',alias:b.alias,ownershipTransferred:false,otherOwnerDisclosed:false}}return path.endsWith('/identifier-claims')?{claims:[],incoming:[],truncated:false,incomingTruncated:false}:detail;});
  render(<InventoryRecovery {...props} canManage/>);await open();fireEvent.click(screen.getByRole('button',{name:'Request identifier review'}));fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Serial collision needs mediation'}});fireEvent.change(screen.getByLabelText('Identifier'),{target:{value:'SYNTHETIC-SERIAL-1'}});fireEvent.click(screen.getByRole('button',{name:'Review exact request'}));fireEvent.click(screen.getByRole('button',{name:'Confirm reviewed request'}));await screen.findByText('Canonical record saved.');const call=env.api.mock.calls.find(c=>c[1]?.method==='POST')!;expect(JSON.parse(call[1].body)).toMatchObject({expectedVersion:4,alias:{kind:'serial',value:'SYNTHETIC-SERIAL-1'},confirmed:true});expect(screen.queryByText('Platform identifier review queue')).toBeNull();
 });
 it('does not expose loss controls for another holder or claim controls without manager authority',async()=>{
  env.api.mockResolvedValue({...detail,holderUserId:19});render(<InventoryRecovery {...props}/>);await open();expect(screen.queryByRole('button',{name:'Report missing'})).toBeNull();expect(screen.queryByRole('button',{name:'Request identifier review'})).toBeNull();
 });
});
