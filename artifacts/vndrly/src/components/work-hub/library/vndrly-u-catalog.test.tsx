import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
const calls=vi.hoisted(()=>[] as string[]);
vi.mock('./use-library',()=>({useLibrary:(path:string)=>{calls.push(path);return {loading:false,error:'',data:path.includes('/courses/')?{title:'Course',lessons:[{id:'L1',title:'Lesson',body:'Original lesson instruction'}]}:{programs:[{id:'VUC003',title:'Hydrogen Sulfide Safety',equivalentCertification:'H2S qualification',courseIds:['VUC003-C01']}],courses:[{id:'VUC003-C01',title:'Course'}]}}}}));
import VndrlyUCatalog from './vndrly-u-catalog';
it('reads the shared catalog and material without any company-library lookup',()=>{
 const view=render(<VndrlyUCatalog kind="programs"/>);
 expect(screen.getByText('Equivalent certification: H2S qualification')).toBeTruthy();
 expect(screen.getByRole('link').getAttribute('href')).toBe('/work-hub/bundle/VUC003');
 view.rerender(<VndrlyUCatalog kind="courses"/>);fireEvent.click(screen.getByRole('button'));
 expect(screen.getByText('Original lesson instruction')).toBeTruthy();
 expect(calls.every(p=>p.startsWith('/api/work-hub/catalog'))).toBe(true);
});
