import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TrainingPolicy from './training-policy';
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{role:'vendor'}})}));
vi.mock('./training-course-guide',()=>({default:()=>null}));

const mock=vi.hoisted(()=>({api:{data:null as any,busy:false,uncertain:false,error:'',send:vi.fn(),reload:vi.fn(),retryOriginal:vi.fn()},assignment:vi.fn()}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,options?:{number?:number})=>options?.number?`${key} ${options.number}`:key})}));
vi.mock('@/components/brand-pill-button',()=>({default:({children,tone,...props}:any)=><button {...props}>{children}</button>}));
vi.mock('./use-library',()=>({useLibrary:(_path:string,parse:(data:unknown)=>unknown)=>({...mock.api,data:mock.api.data?parse(mock.api.data):null})}));
vi.mock('./assignment-review',()=>({default:(props:any)=>{mock.assignment(props);return <div data-testid="assignment-review">Assignment review</div>;}}));

const policyId='11111111-1111-4111-8111-111111111111';
const trainingId='22222222-2222-4222-8222-222222222222';
const fileId='33333333-3333-4333-8333-333333333333';
const missingFileId='44444444-4444-4444-8444-444444444444';
function fixture(){return {itemId:policyId,version:7,familyId:'H03',trainingItemId:trainingId,policy:{title:'Permit policy',description:'Who this policy covers',purpose:'Keep overlapping work controlled',requiredUserIds:[],requiredStaffRoleIds:[],requiredGroupIds:[],newHireRequired:false,roleChangeRequired:false,activatedAt:null,nextScanAt:null,attachmentFileIds:[],links:[]},requiredPeopleIds:[],people:[{userId:17,name:'Alex Worker',email:'alex@example.test'},{userId:23,name:null,email:'sam@example.test'}],groups:[{id:'crew:1',name:'Night Crew'}],positions:[{id:'field_operator',label:'Field Operator'}],files:[{id:fileId,fileName:'Approved permit procedure.pdf'}]};}
function deferred<T=unknown>(){let resolve!:(value:T|PromiseLike<T>)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
beforeEach(()=>{vi.clearAllMocks();mock.api.data=fixture();mock.api.busy=false;mock.api.uncertain=false;mock.api.error='';mock.api.send.mockResolvedValue({});mock.api.reload.mockResolvedValue({});});
afterEach(cleanup);

describe('TrainingPolicy',()=>{
 it('shows editable title, description and purpose and saves selected positions, people, groups and new-worker rules',async()=>{
  const onSaved=vi.fn().mockResolvedValue(undefined);render(<TrainingPolicy itemId={policyId} onSaved={onSaved}/>);
  expect((screen.getByLabelText('trainingPolicy.title') as HTMLInputElement).value).toBe('Permit policy');
  expect((screen.getByLabelText('trainingPolicy.description') as HTMLTextAreaElement).value).toBe('Who this policy covers');
  expect((screen.getByLabelText('trainingPolicy.purpose') as HTMLTextAreaElement).value).toBe('Keep overlapping work controlled');
  fireEvent.change(screen.getByLabelText('trainingPolicy.title'),{target:{value:'Updated policy'}});
  fireEvent.change(screen.getByLabelText('trainingPolicy.description'),{target:{value:'Field and night crews'}});
  fireEvent.change(screen.getByLabelText('trainingPolicy.purpose'),{target:{value:'Verify shared safeguards before work'}});
  for(const label of ['Field Operator','Alex Worker','sam@example.test','Night Crew','trainingPolicy.newHire','trainingPolicy.roleChange'])fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('button',{name:'trainingPolicy.save'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
  expect(mock.api.send).toHaveBeenCalledWith(`/api/work-hub/library/${policyId}/training-policy`,expect.objectContaining({title:'Updated policy',description:'Field and night crews',purpose:'Verify shared safeguards before work',requiredUserIds:[17,23],requiredStaffRoleIds:['field_operator'],requiredGroupIds:['crew:1'],newHireRequired:true,roleChangeRequired:true}),7);
  expect(mock.api.reload).toHaveBeenCalledOnce();expect(screen.getByRole('status').textContent).toBe('trainingPolicy.saved');
 });

 it('keeps saved selections checked and lets unavailable people, positions, groups and files be removed',async()=>{
  mock.api.data.policy={...mock.api.data.policy,requiredUserIds:[17,99],requiredStaffRoleIds:['field_operator','retired_role'],requiredGroupIds:['crew:1','crew:99'],attachmentFileIds:[fileId,missingFileId]};
  render(<TrainingPolicy itemId={policyId} onSaved={vi.fn().mockResolvedValue(undefined)}/>);
  for(const label of ['Alex Worker','Field Operator','Night Crew','Approved permit procedure.pdf','trainingPolicy.unavailablePerson 1','trainingPolicy.unavailablePosition 1','trainingPolicy.unavailableGroup 1','trainingPolicy.unavailableFile 1']){const control=screen.getByLabelText(label);expect(control.getAttribute('role')==='switch'?control.getAttribute('aria-checked')==='true':(control as HTMLInputElement).checked).toBe(true);}
  for(const type of ['Person','Position','Group','File']){const label=`trainingPolicy.unavailable${type} 1`;fireEvent.click(screen.getByLabelText(label));expect(screen.queryByLabelText(label)).toBeNull();}
  fireEvent.click(screen.getByRole('button',{name:'trainingPolicy.save'}));
  await waitFor(()=>expect(mock.api.send).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({requiredUserIds:[17],requiredStaffRoleIds:['field_operator'],requiredGroupIds:['crew:1'],attachmentFileIds:[fileId]}),7));
 });

 it('waits for save, reload and onSaved before opening assignment review with the persisted resolved recipients',async()=>{
  const saved=deferred(),reloaded=deferred(),notified=deferred();
  mock.api.send.mockReturnValue(saved.promise);mock.api.reload.mockReturnValue(reloaded.promise);const onSaved=vi.fn().mockReturnValue(notified.promise);
  render(<TrainingPolicy itemId={policyId} onSaved={onSaved}/>);
  fireEvent.click(screen.getByLabelText('Alex Worker'));fireEvent.click(screen.getByLabelText('Field Operator'));fireEvent.click(screen.getByLabelText('Night Crew'));
  fireEvent.click(screen.getByRole('button',{name:'trainingPolicy.assignNow'}));
  expect(mock.api.send).toHaveBeenCalledOnce();expect(mock.api.reload).not.toHaveBeenCalled();expect(mock.assignment).not.toHaveBeenCalled();
  const payload=mock.api.send.mock.calls[0][1];
  await act(async()=>{mock.api.data={...mock.api.data,version:8,policy:payload,requiredPeopleIds:[17,23,31]};saved.resolve({});await saved.promise;});
  expect(mock.api.reload).toHaveBeenCalledOnce();expect(onSaved).not.toHaveBeenCalled();expect(screen.queryByTestId('assignment-review')).toBeNull();
  await act(async()=>{reloaded.resolve({});await reloaded.promise;});
  expect(onSaved).toHaveBeenCalledOnce();expect(screen.queryByTestId('assignment-review')).toBeNull();
  await act(async()=>{notified.resolve(undefined);await notified.promise;});
  await waitFor(()=>expect(screen.getByTestId('assignment-review')).toBeTruthy());
  expect(mock.assignment).toHaveBeenLastCalledWith(expect.objectContaining({kind:'training',initialItemId:trainingId,initialUserIds:[17,23,31],initialGroupIds:['crew:1']}));
 });

 it('does not open assignment review or announce success when policy save fails',async()=>{
  mock.api.send.mockRejectedValue(new Error('Policy changed; reload required'));const onSaved=vi.fn();
  render(<TrainingPolicy itemId={policyId} onSaved={onSaved}/>);fireEvent.click(screen.getByRole('button',{name:'trainingPolicy.assignNow'}));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('Policy changed; reload required'));
  expect(mock.assignment).not.toHaveBeenCalled();expect(mock.api.reload).not.toHaveBeenCalled();expect(onSaved).not.toHaveBeenCalled();
 });
});

it('keeps course identity fields read-only for a company manager',()=>{
 mock.api.data=fixture();render(<TrainingPolicy itemId={policyId} onSaved={vi.fn()}/>);
 for(const key of ['title','description','purpose'])expect((screen.getByLabelText(`trainingPolicy.${key}`) as HTMLTextAreaElement).readOnly).toBe(true);
});