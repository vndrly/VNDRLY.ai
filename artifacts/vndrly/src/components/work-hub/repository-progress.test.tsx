import React from 'react';
import {render,screen,cleanup} from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
const state=vi.hoisted(()=>({data:{certifications:[{id:'course',title:'Assigned course',standalone:true,complete:true,steps:[{id:'s',title:'Start course',href:'/work-hub/training/assignment',complete:true}]},{id:'cert',title:'Earned certification',complete:true,steps:[]}]}}));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:state.data})}));
vi.mock('./repository-client',()=>({useRepository:()=>({user:{userId:7},owner:{type:'vendor',id:1},pending:false})}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({})}));
import {CertificationProgress} from './repository-certifications';
beforeEach(cleanup);
it('shows assigned training with a working course link on Work Hub',()=>{render(<CertificationProgress/>);expect(screen.getByText('Assigned course')).toBeTruthy();expect(screen.getByRole('link',{name:'Start course'}).getAttribute('href')).toBe('/work-hub/training/assignment');});
it('does not claim standalone course completion as a profile certification',()=>{render(<CertificationProgress profile/>);expect(screen.queryByText('Assigned course')).toBeNull();expect(screen.getAllByText('Earned certification').length).toBeGreaterThan(0);});

