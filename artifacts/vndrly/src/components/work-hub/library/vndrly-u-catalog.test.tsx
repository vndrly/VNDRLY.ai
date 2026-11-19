import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
const calls=vi.hoisted(()=>[] as string[]);
vi.mock('./use-library',()=>({useLibrary:(path:string)=>{calls.push(path);return {loading:false,error:'',data:path.endsWith('/instruction')?{available:false,assigned:false}:path.includes('/to-complete')?{items:[]}:path.includes('/courses/')?{title:'Course',lessons:[{id:'L1',title:'Lesson',body:'Original lesson instruction'}]}:{programs:[{id:'VUC003',title:'Hydrogen Sulfide Safety',equivalentCertification:'H2S qualification',courseIds:['VUC003-C01']},{id:'VUC004',title:'Other certification',equivalentCertification:null,courseIds:['VUC003-C01']}],courses:[{id:'VUC003-C01',title:'Course'},{id:'VUC003-C01',title:'Course'}]}}}}));
import VndrlyUCatalog, {CatalogCoursePage} from './vndrly-u-catalog';
it('reads the shared catalog and material without any company-library lookup',()=>{
 const view=render(<VndrlyUCatalog kind="programs"/>);
 expect(screen.getByText('Equivalent certification: H2S qualification')).toBeTruthy();
 expect(screen.getByRole('link',{name:'Hydrogen Sulfide Safety'}).getAttribute('href')).toBe('/work-hub/bundle/VUC003');
 view.rerender(<VndrlyUCatalog kind="courses"/>);fireEvent.click(screen.getByRole('button',{name:'All courses'}));fireEvent.click(screen.getByRole('button',{name:'Course'}));
 expect(screen.getByText('Original lesson instruction')).toBeTruthy();
 expect(screen.getByRole('link',{name:'View Course'}).getAttribute('href')).toBe('/work-hub/course/VUC003-C01');
 expect(screen.getByText('Applies to certifications (2)')).toBeTruthy();
 expect(screen.getByRole('link',{name:'Other certification',hidden:true}).getAttribute('href')).toBe('/work-hub/bundle/VUC004');
 expect(calls.every(p=>p.startsWith('/api/work-hub/catalog'))).toBe(true);
});
it('shows the course immediately with its training action on the same page',()=>{
 render(<CatalogCoursePage id="VUC003-C01"/>);
 expect(screen.getByText('Original lesson instruction')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Begin Training'}));
 expect((screen.getByRole('button',{name:'Begin Training'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText('Online instruction is being prepared for this course.')).toBeTruthy();
 expect(screen.getByText('Original lesson instruction')).toBeTruthy();
 expect(screen.queryByRole('link',{name:'View Course'})).toBeNull();
});

it('shows shared courses under each certification, but only once in All courses',()=>{
 render(<VndrlyUCatalog kind="courses"/>);
 expect(screen.getAllByText('Course')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'All courses'}));
 expect(screen.getAllByRole('button',{name:'Course'})).toHaveLength(1);
 expect(screen.queryByText('Other certification')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'By certification'}));
 expect(screen.getAllByText('Course')).toHaveLength(2);
});
it('filters certification groups by course and certification titles',()=>{
 const view=render(<VndrlyUCatalog kind="courses" search="Other certification"/>);
 expect(screen.getAllByText('Course')).toHaveLength(1);
 expect(screen.queryByText('Hydrogen Sulfide Safety')).toBeNull();
 view.rerender(<VndrlyUCatalog kind="courses" search="no-such-course"/>);
 expect(screen.getByText('No matches found.')).toBeTruthy();
});
