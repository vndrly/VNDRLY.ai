import React from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import VndrlyUCatalog from './work-hub/library/VndrlyUCatalog';
import {ManagedCrews} from './implementation-a/ManagedCrews';
import FinanceRoleAssignments from './FinanceRoleAssignments';
const state=vi.hoisted(()=>({user:{id:7,vendorId:2,role:'field_employee',vendorRole:'field'} as any,send:vi.fn(),read:vi.fn(),push:vi.fn(),data:{} as Record<string,any>}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:state.user})}));
vi.mock('@/hooks/useColors',()=>({useColors:()=>({text:'#fff',primary:'#00ffff',card:'#222',background:'#333',mutedForeground:'#aaa',destructive:'#f00'})}));
vi.mock('@/lib/use-form-campaigns',()=>({useFormCampaigns:(path:string)=>{state.read(path);return {data:state.data[path],loading:false,busy:false,error:'',send:state.send,reload:vi.fn()};}}));
vi.mock('expo-router',()=>({router:{push:state.push}}));
vi.mock('@/components/work-hub/TaskAssignment',()=>({default:()=>null}));
afterEach(cleanup);
beforeEach(()=>{vi.clearAllMocks();state.user={id:7,vendorId:2,role:'field_employee',vendorRole:'field'};state.data={};});
it('shows assigned and completed certifications in Mine, with renewal and expiration',()=>{
 state.data['/api/work-hub/catalog']={programs:[{id:'expired',title:'Expired certification',courseIds:[]},{id:'assigned',title:'Assigned certification',courseIds:[]},{id:'other',title:'Other certification',courseIds:[]}],courses:[]};
 state.data['/api/work-hub/catalog/training/state']={programs:[{id:'expired',complete:true,expiresAt:'2020-01-01',awardedAt:'2019-01-01'},{id:'assigned',complete:false}]};
 render(<VndrlyUCatalog kind="programs" mine/>);
 expect(screen.getByText(/Expired certification/)).toBeTruthy();expect(screen.getByText('Assigned certification')).toBeTruthy();expect(screen.queryByText('Other certification')).toBeNull();expect(screen.getByText('Expired')).toBeTruthy();fireEvent.click(screen.getByText('Renew'));expect(state.push).toHaveBeenCalledWith('/work-hub/bundle/expired');
});
it('keeps checklist administration hidden from gatekeepers and excludes others tasks',()=>{
 state.data['/api/work-hub/tasks']=[{id:'mine',title:'My task',assigneeUserId:7,status:'open'},{id:'other',title:'Other task',assigneeUserId:8,status:'open'}];
 render(<ManagedCrews/>);expect(screen.getByText('My task')).toBeTruthy();expect(screen.queryByText('Other task')).toBeNull();expect(screen.queryByText('Modify')).toBeNull();expect(state.read).not.toHaveBeenCalledWith('/api/work-hub/admin/checklists');
});
it('opens checklist administration for office staff',()=>{
 state.user.vendorRole='office';render(<ManagedCrews/>);fireEvent.click(screen.getByText('Modify'));expect(screen.getByText('Created checklists')).toBeTruthy();expect(screen.getByText('Create checklist')).toBeTruthy();
});
it('does not expose finance assignments without backend permission',()=>{
 state.data['/api/work-hub/finance?orgType=vendor&orgId=2']={permissions:{administer:false},members:[],grants:[]};render(<FinanceRoleAssignments/>);expect(screen.queryByText('Finance role assignments')).toBeNull();
});
