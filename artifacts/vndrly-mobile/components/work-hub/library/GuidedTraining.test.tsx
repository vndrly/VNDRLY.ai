import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import GuidedTraining from './GuidedTraining';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/hooks/useColors',()=>({useColors:()=>({text:'#fff',card:'#222',primary:'#0ab'})}));
vi.mock('react-native',()=>({Pressable:({children,onPress,disabled}:any)=><button onClick={onPress} disabled={disabled}>{children}</button>,View:({children}:any)=><div>{children}</div>,Text:({children}:any)=><span>{children}</span>,Linking:{openURL:vi.fn()}}));
vi.mock('./TrainingAction',()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
afterEach(cleanup);
const base:any={canSubmit:true,instanceId:'one',title:'Energy Safety Core',metadata:{content:{training:{guided:{steps:[{lessonId:'lesson',questionIds:['q']}]},lessons:[{id:'lesson',title:'Recognize the boundary',body:'Verify the identity.'},{id:'application',title:'Application exercises',body:'Never use live equipment for this exercise.'}],questions:[{id:'q',prompt:'What next?',multiple:false,options:[{id:'a',label:'Verify identity'},{id:'b',label:'Guess identity'}]}]}}},assignment:{status:'assigned',progress:{}},guidedFeedback:null};
const props={busy:false,uncertain:false,retry:vi.fn()};
it('returns to the next section start without moving the page when choosing an answer',()=>{
 const onSectionChange=vi.fn(),send=vi.fn();
 const {rerender}=render(<GuidedTraining {...props} data={base} send={send} onSectionChange={onSectionChange}/>);
 expect(onSectionChange).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByText('Verify identity'));
 expect(onSectionChange).toHaveBeenCalledTimes(1);
 rerender(<GuidedTraining {...props} data={{...base,assignment:{status:'in_progress',progress:{guided:{step:1,responses:{}}}}}} send={send} onSectionChange={onSectionChange}/>);
 expect(onSectionChange).toHaveBeenCalledTimes(2);
});
it('sends the original choice and requires explicit remediation instead of generic completion',async()=>{
 const send=vi.fn().mockResolvedValue({});const {rerender}=render(<GuidedTraining {...props} data={base} send={send}/>);
 expect((screen.getByText('h03Course.submitAnswer') as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByText('Guess identity'));fireEvent.click(screen.getByText('h03Course.submitAnswer'));
 await waitFor(()=>expect(send).toHaveBeenCalledWith({action:'answer',questionId:'q',optionIds:['b']}));
 const pending={...base,guidedFeedback:{questionId:'q',correctOptionIds:['a'],explanation:'Resolve the equipment identity before work.'},assignment:{status:'in_progress',progress:{guided:{step:0,responses:{q:{correct:false,remediatedAt:null,originalOptionIds:['b']}}}}}};
 rerender(<GuidedTraining {...props} send={send} data={pending}/>);
 fireEvent.click(screen.getByText('h03Course.acknowledge'));
 await waitFor(()=>expect(send).toHaveBeenLastCalledWith({action:'remediate',questionId:'q',acknowledged:true}));
});
it('resumes saved exam answers and only submits on explicit action',async()=>{
 const send=vi.fn().mockResolvedValue({});const attempt={id:'attempt',submittedAt:null,answers:{},questionIds:['e1']};
 const data={...base,canSubmit:false,assignment:{status:'completed',progress:{}},certificationExam:{questionCount:1,passingPercent:80,maximumAttempts:3,attempt,questions:[{id:'e1',prompt:'Exam decision',multiple:false,options:[{id:'a',label:'Keep the boundary'},{id:'b',label:'Cross the boundary'}]}],review:[]}};
 const {rerender}=render(<GuidedTraining {...props} data={data} send={send}/>);
 expect((screen.getByText('certificationLearning.submit') as HTMLButtonElement).disabled).toBe(true);
 expect(screen.queryByText('h03Course.correctAnswer')).toBeNull();
 fireEvent.click(screen.getByText('Keep the boundary'));
 await waitFor(()=>expect(send).toHaveBeenCalledWith({action:'exam_answer',attemptId:'attempt',questionId:'e1',optionIds:['a']}));
 expect(send).not.toHaveBeenCalledWith(expect.objectContaining({action:'exam_submit'}));
 rerender(<GuidedTraining {...props} send={send} data={{...data,certificationExam:{...data.certificationExam,attempt:{...attempt,answers:{e1:['a']}}}}}/>);
 fireEvent.click(screen.getByText('certificationLearning.submit'));
 await waitFor(()=>expect(send).toHaveBeenLastCalledWith({action:'exam_submit',attemptId:'attempt'}));
});
it('does not open the exam before learning is complete and leaves supplemental reading accessible',()=>{
 const send=vi.fn();render(<GuidedTraining {...props} send={send} data={{...base,certificationExam:{questionCount:40,passingPercent:80,maximumAttempts:100,attempt:null,questions:[],review:[]}}}/>);
 expect(screen.queryByText('certificationLearning.start')).toBeNull();
 fireEvent.click(screen.getByText('certificationLearning.openLesson'));
 expect(screen.getByText('Never use live equipment for this exercise.')).toBeTruthy();
 expect(send).not.toHaveBeenCalled();
});
it('blocks answers during uncertain saves and retries the original operation',async()=>{
 const retry=vi.fn().mockResolvedValue({});render(<GuidedTraining data={base} busy={false} uncertain send={vi.fn()} retry={retry}/>);
 expect((screen.getByText('Verify identity').closest('button') as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByText('workHubLibrary.retry'));await waitFor(()=>expect(retry).toHaveBeenCalledOnce());
});

it('keeps cancelled or otherwise read-only assignments from submitting',()=>{
 render(<GuidedTraining {...props} data={{...base,canSubmit:false,assignment:{status:'cancelled',progress:{}}}} send={vi.fn()}/>);
 expect((screen.getByText('Verify identity').closest('button') as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByText('h03Course.submitAnswer') as HTMLButtonElement).disabled).toBe(true);
});
