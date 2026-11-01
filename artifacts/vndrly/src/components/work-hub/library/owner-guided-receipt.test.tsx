import React from 'react';import{it,expect,vi,afterEach}from'vitest';import{render,screen,cleanup}from'@testing-library/react';
import OwnerAssignment from './owner-assignment';
const state=vi.hoisted(()=>({data:{} as any}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('./use-library',()=>({useLibrary:()=>({data:state.data,busy:false,uncertain:false})}));
vi.mock('./editor-controls',()=>({Frame:({children}:any)=><div>{children}</div>,Paragraph:({children}:any)=><p>{children}</p>,Field:()=>null,Pill:({children}:any)=><button>{children}</button>,usePalette:()=>({text:'white'})}));
afterEach(cleanup);
it('shows the saved original and corrected options in the administrator receipt',()=>{
 state.data={title:'H03',kind:'training',assignment:{status:'completed',contentVersion:3,dueAt:'2026-12-01T00:00:00Z',progress:{}},content:{training:{questions:[{id:'q',prompt:'Which safeguard?',options:[{id:'a',label:'Signature alone'},{id:'c',label:'Verified condition'}]}]}},history:[{id:'h',version:1,submittedAt:new Date(),values:{type:'guided_training',progress:{step:1,responses:{q:{originalOptionIds:['a'],correctedOptionIds:['c'],correct:false,answeredAt:'2026-11-01T00:00:00Z',remediatedAt:'2026-11-01T00:01:00Z'}},scores:null}}}]};
 render(<OwnerAssignment instanceId="test"/>);expect(screen.getByText('h03Course.originalAnswer: Signature alone')).toBeTruthy();expect(screen.getByText('h03Course.currentAnswer: Verified condition')).toBeTruthy();expect(screen.getByText(/h03Course.corrected/)).toBeTruthy();expect(screen.queryByText('Which safeguard?: —')).toBeNull();
});
