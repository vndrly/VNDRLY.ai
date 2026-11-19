import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
const calls=vi.hoisted(()=>[] as string[]);
vi.mock('expo-router',()=>({router:{push:vi.fn()}}));
vi.mock('@/hooks/useColors',()=>({useColors:()=>({primary:'#00abcd',text:'#fff'})}));
vi.mock('@/lib/use-form-campaigns',()=>({useFormCampaigns:(path:string)=>{calls.push(path);return {loading:false,error:'',data:path.includes('/courses/')?{title:'Course',lessons:[{id:'L1',title:'Lesson',body:'Original instruction'}]}:{programs:[{id:'VUC003',title:'Hydrogen Sulfide Safety',equivalentCertification:'H2S qualification',courseIds:['VUC003-C01']}],courses:[{id:'VUC003-C01',title:'Course'}]}}}}));
import VndrlyUCatalog from './VndrlyUCatalog';
it('opens shared constituent course text without company copies',()=>{
 const view=render(<VndrlyUCatalog kind="programs"/>);
 expect(screen.getByText('Equivalent certification: H2S qualification')).toBeTruthy();
 view.rerender(<VndrlyUCatalog kind="courses"/>);fireEvent.click(screen.getByRole('button'));
 fireEvent.click(screen.getByText('▸ Lesson'));expect(screen.getByText('Original instruction')).toBeTruthy();
 expect(calls.every(p=>p.startsWith('/api/work-hub/catalog'))).toBe(true);
});
