import React from 'react';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
const state=vi.hoisted(()=>({data:null as any}));
vi.mock('@tanstack/react-query',()=>({useQuery:(options:any)=>({data:options.queryKey.includes('safety-summary')?{score:72,maximum:110,bonus:3,incomplete:false}:state.data})}));
vi.mock('./repository-client',()=>({useRepository:()=>({user:{userId:7},owner:{type:'vendor',id:1},pending:false})}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({})}));
import {CertificationProgress,TrainingCompletionTotal,certificateDisplayTitle} from './repository-certifications';
beforeEach(()=>{
 cleanup();
 const course={id:'standalone-courses',title:'Standalone Courses',standalone:true,complete:false,completedCount:2,totalCount:7,percent:29,
  steps:[{id:'s',title:'Start course',type:'course',href:'/work-hub/training/assignment',complete:false,ordinal:3,progressState:'next'}]};
 const cert={id:'cert',title:'Earned certification',complete:true,completedCount:4,totalCount:4,percent:100,steps:[]};
 state.data={certifications:[],overallPercent:63,displayGroups:[{title:'Certifications',items:[cert]},{title:'Standalone Courses',items:[course]}],profileGroups:[{title:'Certifications',items:[cert]}]};
});
it('renders the persisted overall percentage without counting supplied course steps',()=>{
 render(<TrainingCompletionTotal/>);
 expect(screen.getByLabelText('Overall training completion').textContent).toBe('63%');
 expect(screen.getByLabelText('Company safety score').textContent).toBe('72/110');
 expect(screen.getByLabelText('Safety bonus points').textContent).toBe('+3');
});
it('shortens company-prefixed certificate titles while preserving standalone labels',()=>{
 expect(certificateDisplayTitle('GateGo | Shared foundation — training assurance')).toBe('Shared foundation | Training Assurance');
 expect(certificateDisplayTitle('Standalone Courses')).toBe('Standalone Courses');
});
it('keeps every saved course group closed initially',()=>{
 render(<CertificationProgress/>);
 expect(document.querySelectorAll('details').length).toBe(2);
 expect(document.querySelector('details[open]')).toBeNull();
});
it('uses saved grouping rather than reconstructing groups from certifications',()=>{
 state.data.displayGroups=[state.data.displayGroups[0]];
 render(<CertificationProgress/>);
 expect(screen.getByRole('region',{name:'Certifications'})).toBeTruthy();
 expect(screen.queryByRole('region',{name:'Standalone Courses'})).toBeNull();
});
it('renders persisted counts, percentage, ordinal and next-step state verbatim',()=>{
 render(<CertificationProgress/>);
 document.querySelectorAll('details > summary').forEach(summary=>fireEvent.click(summary));
 expect(screen.getByText('29% complete')).toBeTruthy();
 expect(screen.getByText('2 / 7 complete')).toBeTruthy();
 const progress=screen.getByRole('list',{name:'Standalone Courses progress'});
 expect(progress.querySelector('[aria-current="step"]')?.textContent).toBe('3Next step');
 expect(screen.getByRole('link',{name:'Start course'}).getAttribute('href')).toBe('/work-hub/training/assignment');
});
it('uses the separately persisted earned-certification profile groups',()=>{
 render(<CertificationProgress profile/>);
 expect(screen.queryByText('Standalone Courses')).toBeNull();
 expect(screen.getAllByText('Earned certification').length).toBeGreaterThan(0);
});
