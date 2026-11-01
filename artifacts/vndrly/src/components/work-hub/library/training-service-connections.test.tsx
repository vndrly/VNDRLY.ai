import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import TrainingServiceConnections from './training-service-connections';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{userId:1,vendorId:7,activeMembershipId:2}})}));
vi.mock('@/components/brand-pill-button',()=>({default:({children,tone,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{tone:string})=><button {...props}>{children}</button>}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('remaining task qualification evidence',()=>{
 it('shows the company course and separates vendor records from assessed practical skills',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({data:{catalogServices:963,total:1,offset:0,pageSize:20,baselineProvisional:true,services:[{id:'VMS-test',name:'Pipeline pigging',deliveryMode:'site',roleMappings:[],sourceUrls:[],scopeNotes:[],gapTopics:[],residualRequirements:[{groupId:'TG43',title:'Pigging method competence',courseId:'G92',role:'Assigned pigging crew',trainingItemId:'company-course',vendorEvidenceRequired:['Approved launcher procedure and actual pipeline identity.'],practicalAssessmentRequired:['Observed role performance by a qualified pigging assessor.'],scopeConfirmation:'Confirm actual launcher/receiver duties.'}]}]}})})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TrainingServiceConnections familyId=""/></QueryClientProvider>);
  expect(await screen.findByText('Pipeline pigging')).toBeTruthy();
  expect(screen.getByRole('link',{name:'trainingPolicy.taskCourse'}).getAttribute('href')).toBe('/work-hub/library/company-course');
  expect(screen.getByText('Approved launcher procedure and actual pipeline identity.')).toBeTruthy();
  expect(screen.getByText('Observed role performance by a qualified pigging assessor.')).toBeTruthy();
  expect(screen.getByText('trainingPolicy.vendorEvidence')).toBeTruthy();
  expect(screen.getByText('trainingPolicy.practicalEvidence')).toBeTruthy();
 });
 it('shows a preserved H2S service without inventing a master catalog match',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({data:{catalogServices:963,total:0,offset:0,pageSize:20,baselineProvisional:true,services:[],extensions:[{id:'h2s_monitoring_safety_trailer',name:'H2S Monitoring & Safety Trailer',deliveryMode:'site',roleMappings:[],sourceUrls:[],scopeNotes:['Existing service111; no invented VMS identifier.'],gapTopics:[],residualRequirements:[{groupId:'H2S-role-6',title:'Detector calibration/repair technician',courseId:'G71',role:'Actual calibration staff only',trainingItemId:'own-calibration-course',vendorEvidenceRequired:['Manufacturer/model service instructions.'],practicalAssessmentRequired:['Model-competent assessor observes calibration.'],scopeConfirmation:'Only actual calibration or repair duties.'}]}]}})})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TrainingServiceConnections familyId="G71"/></QueryClientProvider>);
  expect(await screen.findByText('H2S Monitoring & Safety Trailer')).toBeTruthy();
  expect(screen.getByText('trainingPolicy.preservedExtensions')).toBeTruthy();
  expect(screen.getByRole('link',{name:'trainingPolicy.taskCourse'}).getAttribute('href')).toBe('/work-hub/library/own-calibration-course');
  expect(screen.getByText('Manufacturer/model service instructions.')).toBeTruthy();
 });
});
