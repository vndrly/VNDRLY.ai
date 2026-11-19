import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({data:{} as any,send:vi.fn(),reload:vi.fn()}));
vi.mock('./use-library',()=>({useLibrary:()=>({data:state.data,loading:false,error:'',contextKey:'synthetic',reload:state.reload})}));
vi.mock('@/lib/work-hub-client',()=>({workHubRequest:state.send}));
vi.mock('@/components/gate-profile-chrome',()=>({ProfileActionButton:(props:any)=><button {...props}/>}));
import OnlineCertificationExam from './online-certification-exam';
beforeEach(()=>{vi.clearAllMocks();state.data={available:true,assigned:true,passingPercent:80,questionCount:20,questions:[],attempt:null};state.send.mockResolvedValue({});state.reload.mockResolvedValue({});});
it('starts through the persistence endpoint and cannot start when unassigned',async()=>{
 const view=render(<OnlineCertificationExam id="VUC116"/>);
 fireEvent.click(screen.getByRole('button',{name:'Begin assessment'}));
 await waitFor(()=>expect(state.send).toHaveBeenCalledWith('/catalog/programs/VUC116/exam',{method:'POST',body:JSON.stringify({action:'start'})}));
 state.data.assigned=false;view.rerender(<OnlineCertificationExam id="VUC116"/>);
 expect((screen.getByRole('button',{name:'Begin assessment'}) as HTMLButtonElement).disabled).toBe(true);
});
it('allows reviewing a failed attempt after returning without forcing an immediate retry',()=>{
 state.data.attempt={id:'attempt',submittedAt:'2026-11-19',score:75,passed:false,answers:{q1:1}};
 state.data.questions=[{id:'q1',prompt:'Synthetic decision',options:['A','B'],explanation:'Why A is appropriate.'}];
 render(<OnlineCertificationExam id="VUC116"/>);
 fireEvent.click(screen.getByRole('button',{name:'Review assessment'}));
 expect(screen.getByText('Why A is appropriate.')).toBeTruthy();
 expect(state.send).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Retake assessment'})).toBeTruthy();
});
it('reports failed saves without claiming the assessment started',async()=>{
 state.send.mockRejectedValue(Error('Connection interrupted'));
 render(<OnlineCertificationExam id="VUC116"/>);
 fireEvent.click(screen.getByRole('button',{name:'Begin assessment'}));
 expect((await screen.findByRole('alert')).textContent).toContain('Connection interrupted');
 expect(screen.queryByRole('button',{name:'Exit assessment'})).toBeNull();
});
