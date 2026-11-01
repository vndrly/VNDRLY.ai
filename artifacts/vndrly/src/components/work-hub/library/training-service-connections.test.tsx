import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import TrainingServiceConnections from './training-service-connections';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{userId:1,vendorId:7,activeMembershipId:2}})}));
vi.mock('@/lib/work-hub-client',()=>({isWorkHubAdmin:()=>true}));
vi.mock('@/components/brand-pill-button',()=>({default:({children,tone,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{tone:string})=><button {...props}>{children}</button>}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('remaining task qualification evidence',()=>{
 it('shows a cited legal role duty without inventing an evidence-upload checklist',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({data:{catalogServices:963,total:1,offset:0,pageSize:20,baselineProvisional:true,services:[{id:'VMS-test',name:'Forklift operations',deliveryMode:'site',roleMappings:[],sourceUrls:[],scopeNotes:[],gapTopics:[],residualRequirements:[{groupId:'TG43',title:'Covered forklift operator training',courseId:'G92',role:'Assigned covered truck operators',trainingItemId:'company-course',vendorEvidenceRequired:[],practicalAssessmentRequired:['29 CFR 1910.178(l): practical training and workplace evaluation for covered truck operators.'],scopeConfirmation:'Confirm actual launcher/receiver duties.'}]}]}})})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TrainingServiceConnections familyId=""/></QueryClientProvider>);
  expect(await screen.findByText('Forklift operations')).toBeTruthy();
  expect(screen.getAllByRole('button').map(b=>b.textContent)).toEqual(expect.arrayContaining(['POLICY','REVIEW','TRAINING','ASSIGN']));
  expect(screen.queryByText('trainingPolicy.vendorEvidence')).toBeNull();
  expect(screen.getByText('29 CFR 1910.178(l): practical training and workplace evaluation for covered truck operators.')).toBeTruthy();
  
  expect(screen.getByText('trainingPolicy.practicalEvidence')).toBeTruthy();
 });
 it('shows the preserved H2S course without adding an unsupported calibration assessment',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({data:{catalogServices:963,total:0,offset:0,pageSize:20,baselineProvisional:true,services:[],extensions:[{id:'h2s_monitoring_safety_trailer',name:'H2S Monitoring & Safety Trailer',deliveryMode:'site',roleMappings:[],sourceUrls:[],scopeNotes:['Existing service111; no invented VMS identifier.'],gapTopics:[],residualRequirements:[{groupId:'H2S-role-6',title:'Detector calibration/repair technician',courseId:'G71',role:'Actual calibration staff only',trainingItemId:'own-calibration-course',vendorEvidenceRequired:[],practicalAssessmentRequired:[],scopeConfirmation:'Only actual calibration or repair duties.'}]}]}})})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TrainingServiceConnections familyId="G71"/></QueryClientProvider>);
  expect(await screen.findByText('H2S Monitoring & Safety Trailer')).toBeTruthy();
  expect(screen.getByText('trainingPolicy.preservedExtensions')).toBeTruthy();
  expect(screen.getAllByRole('button').map(b=>b.textContent)).toEqual(expect.arrayContaining(['POLICY','REVIEW','TRAINING','ASSIGN']));
  expect(screen.queryByText('trainingPolicy.vendorEvidence')).toBeNull();expect(screen.queryByText('trainingPolicy.practicalEvidence')).toBeNull();
 });
});
