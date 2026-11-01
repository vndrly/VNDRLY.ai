import React,{useState} from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import TrainingExposureAudience from './training-exposure-audience';

vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
afterEach(cleanup);

type Decision={userIds:number[];staffRoleIds:string[]};
const people=[
 {userId:17,name:'Alex Operator',email:'alex@example.test'},
 {userId:23,name:null,email:'sam@example.test'},
];
const positions=[
 {id:'staff:rig_operator',label:'Rig Operator'},
 {id:'staff:office_accountant',label:'Office Accountant'},
];
function mount(initial:Decision={userIds:[],staffRoleIds:[]},disabled=false){
 const changed=vi.fn();
 function ControlledAudience(){
  const[decision,setDecision]=useState(initial);
  return <TrainingExposureAudience decision={decision} people={people} positions={positions} disabled={disabled}
   onChange={next=>{changed(next);setDecision(next);}}/>;
 }
 render(<ControlledAudience/>);
 return changed;
}
const checked=(label:string)=>(screen.getByRole('checkbox',{name:label}) as HTMLInputElement).checked;

describe('TrainingExposureAudience',()=>{
 it('starts without any exposure recipients and never implies company-wide selection',()=>{
  const changed=mount();
  expect(screen.getByRole('group',{name:'trainingPolicy.exposureAudience'})).toBeTruthy();
  expect(screen.getByText('trainingPolicy.exposureAudienceHelp')).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(people.length+positions.length);
  expect(screen.getAllByRole('checkbox').every(input=>!(input as HTMLInputElement).checked)).toBe(true);
  expect(changed).not.toHaveBeenCalled();
 });

 it('selects only the named person, without adding positions or other company members',()=>{
  const changed=mount();
  fireEvent.click(screen.getByRole('checkbox',{name:'Alex Operator'}));
  expect(changed).toHaveBeenCalledExactlyOnceWith({userIds:[17],staffRoleIds:[]});
  expect(checked('Alex Operator')).toBe(true);
  for(const label of ['sam@example.test','Rig Operator','Office Accountant'])expect(checked(label)).toBe(false);
 });

 it('selects only the specified position and does not expand it into every listed person',()=>{
  const changed=mount();
  fireEvent.click(screen.getByRole('checkbox',{name:'Rig Operator'}));
  expect(changed).toHaveBeenCalledExactlyOnceWith({userIds:[],staffRoleIds:['staff:rig_operator']});
  expect(checked('Rig Operator')).toBe(true);
  for(const label of ['Office Accountant','Alex Operator','sam@example.test'])expect(checked(label)).toBe(false);
 });

 it('targets the email-labelled person by their user ID and removes only the toggled person or position',()=>{
  const changed=mount({userIds:[17],staffRoleIds:['staff:rig_operator','staff:office_accountant']});
  fireEvent.click(screen.getByRole('checkbox',{name:'sam@example.test'}));
  expect(changed).toHaveBeenLastCalledWith({userIds:[17,23],staffRoleIds:['staff:rig_operator','staff:office_accountant']});
  fireEvent.click(screen.getByRole('checkbox',{name:'Alex Operator'}));
  expect(changed).toHaveBeenLastCalledWith({userIds:[23],staffRoleIds:['staff:rig_operator','staff:office_accountant']});
  fireEvent.click(screen.getByRole('checkbox',{name:'Rig Operator'}));
  expect(changed).toHaveBeenLastCalledWith({userIds:[23],staffRoleIds:['staff:office_accountant']});
  expect(checked('Alex Operator')).toBe(false);expect(checked('Rig Operator')).toBe(false);
  expect(checked('sam@example.test')).toBe(true);expect(checked('Office Accountant')).toBe(true);
 });

 it('prevents person and position changes while the audience is disabled',()=>{
  const changed=mount({userIds:[17],staffRoleIds:['staff:rig_operator']},true);
  for(const element of screen.getAllByRole('checkbox')){
   const input=element as HTMLInputElement;
   expect(input.disabled).toBe(true);
   input.click();
  }
  expect(changed).not.toHaveBeenCalled();
  expect(checked('Alex Operator')).toBe(true);expect(checked('Rig Operator')).toBe(true);
  expect(checked('sam@example.test')).toBe(false);expect(checked('Office Accountant')).toBe(false);
 });
});
