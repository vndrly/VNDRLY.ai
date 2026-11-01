import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import GuidedTraining from './guided-training';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/components/brand-pill-button',()=>({default:({children,tone,...props}:any)=><button {...props}>{children}</button>}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({open,children}:any)=>open?<div role="dialog">{children}</div>:null,DialogContent:({children}:any)=><div>{children}</div>,DialogHeader:({children}:any)=><div>{children}</div>,DialogTitle:({children}:any)=><h2>{children}</h2>,DialogDescription:({children}:any)=><p>{children}</p>}));
afterEach(cleanup);
const data:any={title:'H03',metadata:{content:{training:{guided:{steps:[{lessonId:'l',questionIds:['q']}]},lessons:[{id:'l',title:'Lesson',body:'A safeguard must be verified.'}],questions:[{id:'q',prompt:'Choose safe',multiple:false,options:[{id:'a',label:'Verify the safeguard'},{id:'b',label:'Rely on signature'}]}]}}},assignment:{status:'assigned',progress:{}},guidedFeedback:null};
it('requires a choice and sends the learner answer, not a client-side corrected answer',async()=>{
 const send=vi.fn().mockResolvedValue({});render(<GuidedTraining data={data} busy={false} uncertain={false} send={send} retry={vi.fn()}/>);
 const button=screen.getByRole('button',{name:'h03Course.submitAnswer'});expect((button as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText('Rely on signature'));fireEvent.click(button);
 await waitFor(()=>expect(send).toHaveBeenCalledWith({action:'answer',questionId:'q',optionIds:['b']}));
});
it('shows the correction popup and requires explicit acknowledgment while retaining the original choice',async()=>{
 const send=vi.fn().mockResolvedValue({});const pending={...data,guidedFeedback:{questionId:'q',correctOptionIds:['a'],explanation:'A permit does not physically establish a safeguard.'},assignment:{status:'in_progress',progress:{guided:{step:0,responses:{q:{originalOptionIds:['b'],correctedOptionIds:['b'],correct:false,answeredAt:'2026-11-01T00:00:00Z',remediatedAt:null}},scores:{total:1,originalCorrect:0,remediatedCorrect:0,originalPercent:0,remediatedPercent:0,remediationCount:0}}}}};
 render(<GuidedTraining data={pending} busy={false} uncertain={false} send={send} retry={vi.fn()}/>);
 expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByText('A permit does not physically establish a safeguard.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'h03Course.acknowledge'}));await waitFor(()=>expect(send).toHaveBeenCalledWith({action:'remediate',questionId:'q',acknowledged:true}));
 expect(pending.assignment.progress.guided.responses.q.originalOptionIds).toEqual(['b']);
});
it('shows distinct original and remediated completion results',()=>{
 const completed={...data,assignment:{status:'completed',progress:{guided:{step:1,responses:{},scores:{total:26,originalCorrect:25,remediatedCorrect:26,originalPercent:25/26*100,remediatedPercent:100,remediationCount:1}}}}};
 render(<GuidedTraining data={completed} busy={false} uncertain={false} send={vi.fn()} retry={vi.fn()}/>);
 expect(screen.getByText(/25\/26/)).toBeTruthy();expect(screen.getByText(/26\/26/)).toBeTruthy();expect(screen.getByText('h03Course.credit')).toBeTruthy();expect(screen.queryByRole('button',{name:'h03Course.submitAnswer'})).toBeNull();
});

