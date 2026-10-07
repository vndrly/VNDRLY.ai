import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FilesInventory} from './FilesInventory';
import en from '@/lib/locales/en.json';
const env=vi.hoisted(()=>({api:vi.fn(),generation:1,listeners:new Set<()=>void>()}));
vi.mock('@/lib/api',()=>({apiFetch:env.api,getApiBase:()=>''}));
vi.mock('@/lib/auth',()=>({captureAuthScope:()=>({generation:env.generation}),isAuthScopeCurrent:(s:any)=>s.generation===env.generation,subscribeUser:(fn:()=>void)=>{env.listeners.add(fn);return()=>env.listeners.delete(fn)},subscribeToken:()=>()=>{}}));
vi.mock('@/hooks/useColors',()=>({useColors:()=>({})}));
vi.mock('@/components/TogglePillButton',()=>({default:({children,accessibilityLabel,onPress,disabled}:any)=><button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>}));
vi.mock('@/lib/meeting-files',()=>({pickMeetingFile:vi.fn()}));
vi.mock('@/lib/work-hub-file-upload',()=>({uploadWorkHubFile:vi.fn()}));
vi.mock('@/lib/photos',()=>({captureAndUploadImage:vi.fn()}));
vi.mock('expo-crypto',()=>({}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,args:any)=>{const value=key.split('.').reduce((node:any,k)=>node?.[k],en)??key;return String(value).replace(/\{\{(\w+)\}\}/g,(_,k)=>String(args?.[k]??''))}})}));
const asset={id:'asset-1',name:'Truck',version:4,hold:'Inspection; repair',holds:[{id:'hold-1',reason:'Inspection',placedAt:'2026-10-07T01:00:00Z',source:'inventory' as const,canRelease:true},{id:'hold-2',reason:'Repair',placedAt:'2026-10-07T01:00:00Z',source:'fleet_maintenance' as const,canRelease:false}]};
const props={owner:{type:'vendor' as const,id:7},capabilities:{canUploadFile:false,canCreateNote:false,canEditNote:false,canCreateAsset:false,canManageAsset:true,canCheckOutAsset:false,canVerifyIssuedAsset:false,canViewExports:false,allowedExportDatasets:[],canManageGateLocations:false},files:[],notes:[],assets:[asset],channels:[],onRefresh:vi.fn()};
const open=()=>{fireEvent.click(screen.getByRole('button',{name:'Release hold: Inspection'}));fireEvent.change(screen.getByLabelText('Reason for releasing this hold'),{target:{value:'Reviewed inspection'}})};
beforeEach(()=>{env.api.mockReset();env.generation=1;props.onRefresh.mockClear()});
afterEach(cleanup);
describe('Inventory explicit hold release',()=>{
 it('releases only the selected hold with exact version and reason; Fleet holds have no release control',async()=>{
 env.api.mockImplementation(async (_:string,init:any)=>({...JSON.parse(init.body),assetId:'asset-1',holdId:'hold-1',version:5,status:'applied',physicalRepairVerified:false}));
 render(<FilesInventory {...props}/>);expect(screen.queryByRole('button',{name:'Release hold: Repair'})).toBeNull();open();fireEvent.click(screen.getByRole('button',{name:'Confirm hold release'}));
 await screen.findByText('The selected hold release was saved. Other holds remain.');expect(env.api.mock.calls[0][0]).toBe('/api/implementation-a/assets/asset-1/holds/hold-1/release');expect(JSON.parse(env.api.mock.calls[0][1].body)).toMatchObject({expectedVersion:4,reason:'Reviewed inspection'});expect(screen.getByText('Repair')).toBeTruthy();expect(props.onRefresh).toHaveBeenCalledOnce();
 });
 it('locks the exact request after dropped response even when the asset version changes',async()=>{
 env.api.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async (_:string,init:any)=>({...JSON.parse(init.body),assetId:'asset-1',holdId:'hold-1',version:5,status:'applied',physicalRepairVerified:false}));
 const view=render(<FilesInventory {...props}/>);open();fireEvent.click(screen.getByRole('button',{name:'Confirm hold release'}));await screen.findByText(/The result is unknown/);view.rerender(<FilesInventory {...props} assets={[{...asset,version:9,holds:[asset.holds[1]]}]}/>);fireEvent.click(screen.getByRole('button',{name:'Confirm hold release'}));await screen.findByText(/selected hold release was saved/);expect(env.api.mock.calls[1][1].body).toBe(env.api.mock.calls[0][1].body);
 });
 it('does not claim success from mismatched receipt and clears pending on account change',async()=>{
 env.api.mockResolvedValue({assetId:'other',holdId:'hold-1',operationId:'wrong',version:5,status:'applied',physicalRepairVerified:false});render(<FilesInventory {...props}/>);open();fireEvent.click(screen.getByRole('button',{name:'Confirm hold release'}));await screen.findAllByText(/The result is unknown/);expect(props.onRefresh).not.toHaveBeenCalled();env.generation++;env.listeners.forEach(fn=>fn());await waitFor(()=>expect(screen.queryByRole('button',{name:'Confirm hold release'})).toBeNull());
 });
});
