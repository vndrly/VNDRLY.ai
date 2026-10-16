import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('@/lib/api',()=>({apiFetch:mocks.api}));
vi.mock('@/lib/auth',()=>({captureAuthScope:()=>({}),isAuthScopeCurrent:()=>true}));
vi.mock('@/hooks/useColors',()=>({useColors:()=>({text:'black',border:'gray',destructive:'red'})}));
vi.mock('@/components/TogglePillButton',()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
import FleetRunBilling from './FleetRunBilling';
afterEach(()=>{cleanup();mocks.api.mockReset();});
it('uses the real catalog service AFE override and invalidates it when origin changes',async()=>{
 const change=vi.fn();mocks.api.mockResolvedValue({workTypes:[{id:8,name:'Catalog hauling',rateCents:12500,afeNumber:'SERVICE-AFE'}],tickets:[],afeRequired:true,siteAfe:'SITE-AFE'});
 const view=render(<FleetRunBilling siteId={4} onChange={change} disabled={false}/>);
 await waitFor(()=>expect((screen.getByRole('button',{name:'Run as new ticket'}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'Run as new ticket'}));fireEvent.click(screen.getByRole('button',{name:/Catalog hauling/}));
 await waitFor(()=>expect(change.mock.calls.at(-1)?.[0]).toMatchObject({mode:'new_ticket',workTypeId:8,afeNumber:'SERVICE-AFE'}));
 expect((screen.getByLabelText('AFE') as HTMLInputElement).value).toBe('SERVICE-AFE');
 expect(mocks.api.mock.calls.some(c=>c[0].includes('afeNumber=SERVICE-AFE'))).toBe(true);
 view.rerender(<FleetRunBilling siteId={5} onChange={change} disabled={false}/>);await waitFor(()=>expect(change.mock.calls.at(-1)?.[0]).toBeNull());
});
it('shows a redacted hourly service without inventing or exposing a price',async()=>{
 mocks.api.mockResolvedValue({workTypes:[{id:8,name:'Private hourly hauling',unit:'per_hour',afeNumber:''}],tickets:[],afeRequired:false,siteAfe:''});
 render(<FleetRunBilling siteId={4} fleetId='60000000-0000-4000-8000-000000000001' onChange={()=>{}} disabled={false}/>);
 await waitFor(()=>expect((screen.getByRole('button',{name:'Run as new ticket'}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'Run as new ticket'}));
 const service=screen.getByRole('button',{name:/Private hourly hauling/});expect(service.textContent).toContain('hour');expect(service.textContent).not.toMatch(/\$|NaN|undefined/);
});
it('refreshes exact Detail billing permissions and invalidates selection when the Detail changes',async()=>{
 const change=vi.fn(),first='60000000-0000-4000-8000-000000000001',second='60000000-0000-4000-8000-000000000002';
 mocks.api.mockResolvedValue({workTypes:[{id:8,name:'Scoped hauling',unit:'per_job',afeNumber:''}],tickets:[],afeRequired:false,siteAfe:''});
 const view=render(<FleetRunBilling siteId={4} fleetId={first} onChange={change} disabled={false}/>);
 await waitFor(()=>expect(mocks.api.mock.calls.some(c=>c[0].includes(`fleetId=${first}`))).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:'Run as new ticket'}));fireEvent.click(screen.getByRole('button',{name:/Scoped hauling/}));
 await waitFor(()=>expect(change.mock.calls.at(-1)?.[0]).toMatchObject({workTypeId:8}));
 view.rerender(<FleetRunBilling siteId={4} fleetId={second} onChange={change} disabled={false}/>);
 await waitFor(()=>expect(mocks.api.mock.calls.some(c=>c[0].includes(`fleetId=${second}`))).toBe(true));expect(change.mock.calls.at(-1)?.[0]).toBeNull();
});
