import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const {auth,navigate}=vi.hoisted(()=>({auth:{user:{userId:1084},logout:vi.fn()},navigate:vi.fn()}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>auth}));
vi.mock('wouter',()=>({useLocation:()=>['/',navigate]}));
vi.mock('@/components/png-pill-rollover',()=>({PngPillButton:({children,color,...props}:any)=><button {...props}>{children}</button>}));
import DemoEntry from './demo-entry';
import DemoGuide from './demo-guide';
import {DEMO_STORAGE_KEY} from '@/lib/demo-guide';
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();auth.user={userId:1084};});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('public flyout selects a role and sends no credentials; failed entry stays on the page',async()=>{
 const request=vi.fn(async(_url:string,_init:RequestInit)=>({ok:false}));vi.stubGlobal('fetch',request);
 render(<DemoEntry/>);fireEvent.click(screen.getByRole('button',{name:'Demo'}));
 expect(screen.getAllByRole('radio')).toHaveLength(4);
 fireEvent.click(screen.getByRole('radio',{name:/Fleet Ops vendor/}));fireEvent.click(screen.getByRole('button',{name:'Guide me through'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy());
 expect(JSON.parse(request.mock.calls[0][1].body as string)).toEqual({persona:'fleet'});
 expect(sessionStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
});
it('guide opens an actual matching ticket and keeps progress after collapsing',async()=>{
 sessionStorage.setItem(DEMO_STORAGE_KEY,JSON.stringify({persona:'field',guided:true,step:0}));
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({items:[{id:55,status:'awaiting_acceptance'}],total:1})})));
 render(<DemoGuide/>);await waitFor(()=>expect(fetch).toHaveBeenCalled());
 expect(fetch).toHaveBeenCalledWith('/api/tickets',expect.objectContaining({cache:'no-store'}));
 fireEvent.click(screen.getByRole('button',{name:'Show me in the app'}));expect(navigate).toHaveBeenCalledWith('/tickets/55');
 fireEvent.click(screen.getByRole('button',{name:'Next / Skip'}));expect(screen.getByText('Travel and arrive')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Collapse'}));expect(screen.queryByText('Travel and arrive')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Guide'}));expect(screen.getByText('Travel and arrive')).toBeTruthy();
});
it('a stale demo choice never adds a guide to a real account',()=>{
 auth.user={userId:1};sessionStorage.setItem(DEMO_STORAGE_KEY,JSON.stringify({persona:'field',guided:true}));
 render(<DemoGuide/>);expect(screen.queryByLabelText('VNDRLY demo helper')).toBeNull();
});
