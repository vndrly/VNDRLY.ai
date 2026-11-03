import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import AssignmentReview from './assignment-review';

const mock=vi.hoisted(()=>({context:'company:user:1',request:vi.fn(),send:vi.fn(),reload:vi.fn(),retry:vi.fn()}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/lib/work-hub-client',()=>({workHubRequest:(...args:unknown[])=>mock.request(...args)}));
vi.mock('./editor-controls',()=>({Frame:({children}:any)=><div>{children}</div>,Paragraph:({children}:any)=><p>{children}</p>,Field:({accessibilityLabel,value,onChangeText}:any)=><input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)}/>,Pill:({children,onPress,disabled,solid}:any)=><button disabled={disabled} aria-pressed={!!solid} onClick={onPress}>{children}</button>,usePalette:()=>({})}));
vi.mock('./option-switch',()=>({default:({label,value,onChange,disabled}:any)=><label>{label}<input type="checkbox" checked={value} disabled={disabled} onChange={e=>onChange(e.target.checked)}/></label>}));
const itemId='22222222-2222-4222-8222-222222222222';
const published={items:[{itemId,title:'Assigned safety course',kind:'training',state:'published',version:12}]};
const options={people:[{userId:17,name:'Alex Worker'},{userId:23,name:'Sam Worker'}],positions:[{id:'staff:office',label:'Office Staff',userIds:[17]}],groups:[{id:'crew:1',name:'Night Crew'},{id:'crew:2',name:'Day Crew'}]};
vi.mock('./use-library',()=>({useLibrary:(path:string,parse:(value:unknown)=>unknown)=>({data:parse(path.endsWith('/options')?options:published),contextKey:mock.context,busy:false,uncertain:false,loading:false,error:'',send:mock.send,reload:mock.reload,retryOriginal:mock.retry})}));
const preview=()=>({itemId,version:12,title:'Assigned safety course',people:[{userId:17,name:'Alex Worker'}],items:[{title:'Assigned safety course',estimatedDeadline:'2026-11-05T12:00:00Z'}],existingCount:0,excluded:[],omitted:[],previewFingerprint:'preview-for-current-audience'});
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();mock.context='company:user:1';mock.request.mockResolvedValue(preview());mock.send.mockResolvedValue({resource:{assignmentId:'55555555-5555-4555-8555-555555555555'}});});
afterEach(cleanup);

describe('Policy-preselected assignment recipients',()=>{
 it('expands the selected staff position to its people without changing the course or requiring a policy change',async()=>{
  render(<AssignmentReview kind="training" initialItemId={itemId} positions={[{id:'staff:driver',label:'Driver',userIds:[17,23]}]} onSaved={vi.fn()}/>);
  fireEvent.click(screen.getByLabelText('Driver (2)'));
  fireEvent.click(screen.getByRole('button',{name:'workHubLibrary.review'}));
  await waitFor(()=>expect(mock.request).toHaveBeenCalled());
  expect(JSON.parse(mock.request.mock.calls[0][1].body).audience).toEqual({mode:'selected',userIds:[17,23],groupIds:[]});
  expect(JSON.parse(mock.request.mock.calls[0][1].body).itemId).toBe(itemId);
 });
 it('retains the preselected person and group through mount and sends them to preview and confirmation',async()=>{
  const onSaved=vi.fn().mockResolvedValue(undefined);
  render(<AssignmentReview kind="training" initialItemId={itemId} initialUserIds={[17]} initialGroupIds={['crew:1']} onSaved={onSaved}/>);
  expect(screen.getByRole('button',{name:'Assigned safety course'}).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByLabelText('Alex Worker') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Night Crew') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'workHubLibrary.review'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'workHubLibrary.confirmAssign'})).toBeTruthy());
  const [path,init]=mock.request.mock.calls[0];expect(path).toBe('/library/assignment-preview');
  const request={itemId,audience:{mode:'selected',userIds:[17],groupIds:['crew:1']},renew:false,requiredBeforeWork:false,presentation:'immediate'};
  expect(JSON.parse(init.body)).toEqual(request);
  fireEvent.click(screen.getByRole('button',{name:'workHubLibrary.confirmAssign'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
  expect(mock.send).toHaveBeenCalledWith('/api/work-hub/library/assign',{...request,previewFingerprint:'preview-for-current-audience'},12);
 });

 it('preserves deliberate audience edits when a parent rerenders with new preselection array references',async()=>{
  const onSaved=vi.fn().mockResolvedValue(undefined);
  const {rerender}=render(<AssignmentReview kind="training" initialItemId={itemId} initialUserIds={[17]} initialGroupIds={['crew:1']} onSaved={onSaved}/>);
  fireEvent.click(screen.getByLabelText('Alex Worker'));fireEvent.click(screen.getByLabelText('Sam Worker'));
  fireEvent.click(screen.getByLabelText('Night Crew'));fireEvent.click(screen.getByLabelText('Day Crew'));
  rerender(<AssignmentReview kind="training" initialItemId={itemId} initialUserIds={[17]} initialGroupIds={['crew:1']} onSaved={onSaved}/>);
  expect((screen.getByLabelText('Alex Worker') as HTMLInputElement).checked).toBe(false);expect((screen.getByLabelText('Sam Worker') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Night Crew') as HTMLInputElement).checked).toBe(false);expect((screen.getByLabelText('Day Crew') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'workHubLibrary.review'}));
  await waitFor(()=>expect(mock.request).toHaveBeenCalledOnce());
  expect(JSON.parse(mock.request.mock.calls[0][1].body).audience).toEqual({mode:'selected',userIds:[23],groupIds:['crew:2']});
 });

 it('resets the edited selection to the provided recipients when the company/auth context changes',()=>{
  const onSaved=vi.fn().mockResolvedValue(undefined);const {rerender}=render(<AssignmentReview kind="training" initialItemId={itemId} initialUserIds={[17]} initialGroupIds={['crew:1']} onSaved={onSaved}/>);
  fireEvent.click(screen.getByLabelText('Alex Worker'));fireEvent.click(screen.getByLabelText('Sam Worker'));
  mock.context='other-company:user:1';rerender(<AssignmentReview kind="training" initialItemId={itemId} initialUserIds={[17]} initialGroupIds={['crew:1']} onSaved={onSaved}/>);
  expect((screen.getByLabelText('Alex Worker') as HTMLInputElement).checked).toBe(true);expect((screen.getByLabelText('Sam Worker') as HTMLInputElement).checked).toBe(false);
 });
});

it('uses company positions for certification assignment without policy-only props',()=>{
 render(<AssignmentReview kind="bundle" onSaved={vi.fn()}/>);
 expect(screen.getByLabelText('Office Staff (1)')).toBeTruthy();
});
it('restores an unsaved audience after navigating away and makes preview-only status explicit',async()=>{
 const first=render(<AssignmentReview kind="training" initialItemId={itemId} onSaved={vi.fn()}/>);
 fireEvent.click(screen.getByLabelText('Alex Worker'));
 fireEvent.click(screen.getByRole('button',{name:'workHubLibrary.review'}));
 await waitFor(()=>expect(screen.getByText(/Preview only/)).toBeTruthy());
 expect(mock.send).not.toHaveBeenCalled();first.unmount();
 render(<AssignmentReview kind="training" initialItemId={itemId} onSaved={vi.fn()}/>);
 expect((screen.getByLabelText('Alex Worker') as HTMLInputElement).checked).toBe(true);
 expect(screen.getByText(/Restored assignment draft/)).toBeTruthy();
});
