import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({data:{} as any,send:vi.fn(),reload:vi.fn()}));
vi.mock('./use-library',()=>({useLibrary:()=>({data:state.data,loading:false,error:'',contextKey:'synthetic-company',reload:state.reload})}));
vi.mock('@/lib/work-hub-client',()=>({workHubRequest:state.send}));
vi.mock('@/components/gate-profile-chrome',()=>({ProfileActionButton:({color:_,...props}:any)=><button {...props}/>}));
import CatalogTrainingButton from './catalog-training-button';
beforeEach(()=>{
 vi.clearAllMocks();
 state.data={available:true,assigned:true,sessions:[{id:'s1',title:'Synthetic lesson',minutes:6,objective:'Identify evidence',instruction:'Explanation and worked example',checks:[{id:'q1',prompt:'Which is verified?',options:['Guess','Confirmation']}]}],progress:null};
 state.send.mockResolvedValue({});state.reload.mockResolvedValue({});
});
it('begins an assigned course and opens the actual instruction with interactive retention checks',async()=>{
 render(<CatalogTrainingButton id="VUC001-C04"/>);
 fireEvent.click(screen.getByRole('button',{name:'Begin Training'}));
 await screen.findByText('Synthetic lesson');
 expect(state.send).toHaveBeenCalledWith('/catalog/courses/VUC001-C04/instruction',{method:'POST',body:JSON.stringify({action:'start'})});
 fireEvent.click(screen.getByRole('radio',{name:'Confirmation'}));
 fireEvent.click(screen.getByRole('button',{name:'Check answer'}));
 await waitFor(()=>expect(state.send).toHaveBeenLastCalledWith('/catalog/courses/VUC001-C04/instruction',{method:'POST',body:JSON.stringify({action:'answer',sessionId:'s1',questionId:'q1',option:1})}));
});
it('does not start unassigned training',()=>{
 state.data.assigned=false;render(<CatalogTrainingButton id="VUC001-C04"/>);
 expect((screen.getByRole('button',{name:'Begin Training'}) as HTMLButtonElement).disabled).toBe(true);
 expect(state.send).not.toHaveBeenCalled();
});
it('offers Continue for saved progress and reports a failed save honestly',async()=>{
 state.data.progress={sessionId:'s1',updatedAt:'2026-11-19T21:00:00Z',reviewed:[],responses:{}};
 state.send.mockRejectedValue(Error('Connection interrupted'));
 render(<CatalogTrainingButton id="VUC001-C04"/>);
 fireEvent.click(screen.getByRole('button',{name:'Continue Training'}));
 expect((await screen.findByRole('alert')).textContent).toContain('Connection interrupted');
 expect(screen.queryByLabelText('Current lesson')).toBeNull();
});
