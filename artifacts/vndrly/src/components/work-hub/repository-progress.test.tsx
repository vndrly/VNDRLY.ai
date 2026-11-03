import React from 'react';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
const state=vi.hoisted(()=>({data:{certifications:[{id:'course',title:'Assigned course',standalone:true,complete:true,steps:[{id:'s',title:'Start course',href:'/work-hub/training/assignment',complete:true}]},{id:'cert',title:'Earned certification',complete:true,steps:[]}]}}));
vi.mock('@tanstack/react-query',()=>({useQuery:(options:any)=>({data:options.queryKey.includes('safety-summary')?{score:72,maximum:110,bonus:3,incomplete:false}:state.data})}));
vi.mock('./repository-client',()=>({useRepository:()=>({user:{userId:7},owner:{type:'vendor',id:1},pending:false})}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({})}));
import {CertificationProgress,TrainingCompletionTotal,certificateDisplayTitle} from './repository-certifications';
beforeEach(cleanup);
it('shows the company safety score and earned bonus beside training completion',()=>{
 render(<TrainingCompletionTotal/>);
 expect(screen.getByLabelText('Company safety score').textContent).toBe('72/110');
 expect(screen.getByLabelText('Safety bonus points').textContent).toBe('+3');
 expect(screen.getByLabelText('Overall training completion')).toBeTruthy();
});
it('shortens company-prefixed certificate titles while preserving standalone labels',()=>{
 expect(certificateDisplayTitle('GateGo | Shared foundation — training assurance')).toBe('Shared foundation | Training Assurance');
 expect(certificateDisplayTitle('GateGo | Shared foundation — common worker')).toBe('Shared foundation | Common Worker');
 expect(certificateDisplayTitle('Standalone Courses')).toBe('Standalone Courses');
});
it('counts a shared course once in overall training completion',()=>{
 const certification=state.data.certifications[1];
 certification.steps=[state.data.certifications[0].steps[0],{id:'pending',title:'Pending',href:'/pending',complete:false}];
 try {
  render(<TrainingCompletionTotal/>);
  expect(screen.getByLabelText('Overall training completion').textContent).toBe('50%');
 } finally { certification.steps=[]; }
});
it('keeps every course group closed initially',()=>{
 render(<CertificationProgress/>);
 expect(document.querySelectorAll('details').length).toBeGreaterThan(0);
 expect(document.querySelector('details[open]')).toBeNull();
});
it('groups a directly assigned course under its certification without duplicating it',()=>{
 const certification=state.data.certifications[1];
 certification.steps=[{id:'course',title:'Required course',href:'/work-hub/training/assignment',complete:true}];
 try {
  render(<CertificationProgress/>); document.querySelectorAll("details > summary").forEach(summary=>fireEvent.click(summary));
  expect(screen.getByRole('region',{name:'Certifications'})).toBeTruthy();
  expect(screen.getByRole('list',{name:'Earned certification progress'})).toBeTruthy();
  expect(screen.queryByRole('region',{name:'Standalone Courses'})).toBeNull();
  expect(screen.queryByText('Assigned course')).toBeNull();
  expect(screen.getByRole('link',{name:'Required course'})).toBeTruthy();
 } finally { certification.steps=[]; }
});
it('shows a pending course as the next step before it is completed',()=>{
 state.data.certifications[0].complete=false;
 state.data.certifications[0].steps[0].complete=false;
 try {
  render(<CertificationProgress/>); document.querySelectorAll("details > summary").forEach(summary=>fireEvent.click(summary));
  const progress=screen.getByRole('list',{name:'Standalone Courses progress'});
  expect(progress.querySelector('[aria-current="step"]')).toBeTruthy();
  expect(screen.getByText('Next step')).toBeTruthy();
  expect(screen.getByRole('link',{name:'Start course'}).getAttribute('href')).toBe('/work-hub/training/assignment');
 } finally {
  state.data.certifications[0].complete=true;
  state.data.certifications[0].steps[0].complete=true;
 }
});
it('shows assigned training with a working course link on Work Hub',()=>{render(<CertificationProgress/>); document.querySelectorAll("details > summary").forEach(summary=>fireEvent.click(summary));expect(screen.getByRole('list',{name:'Standalone Courses progress'})).toBeTruthy();expect(screen.getByRole('link',{name:'Start course'}).getAttribute('href')).toBe('/work-hub/training/assignment');});
it('does not claim standalone course completion as a profile certification',()=>{render(<CertificationProgress profile/>);expect(screen.queryByText('Assigned course')).toBeNull();expect(screen.getAllByText('Earned certification').length).toBeGreaterThan(0);});

