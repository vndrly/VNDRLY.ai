import React from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
const navigate=vi.hoisted(()=>vi.fn());
vi.mock('wouter',()=>({useLocation:()=>['',navigate]}));
vi.mock('./editor-controls',()=>({Pill:({children,onPress}:any)=><button onClick={onPress}>{children}</button>}));
import {TrainingActions} from './training-actions';
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('shows the three exact controls and gives each its own course view',()=>{
 render(<TrainingActions itemId="course"/>);
 expect(screen.getAllByRole('button').map(b=>b.textContent)).toEqual(['POLICY','REVIEW','TRAINING']);
 expect(screen.queryByRole('button',{name:'ASSIGN'})).toBeNull();
 for(const view of ['policy','review','training']){fireEvent.click(screen.getByRole('button',{name:view.toUpperCase()}));expect(navigate).toHaveBeenLastCalledWith(`/work-hub/library/course?view=${view}`);}
});
it('keeps management controls unavailable to a learner',()=>{
 render(<TrainingActions itemId="course" canManage={false}/>);
 expect(screen.getAllByRole('button').map(b=>b.textContent)).toEqual(['TRAINING']);
});
