import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
const calls=vi.hoisted(()=>[] as string[]);
vi.mock('./use-library',()=>({useLibrary:(path:string)=>{calls.push(path);return {loading:false,error:'',data:path.endsWith('/training/state')?{programs:[{id:'VUC003',complete:false},{id:'VUC004',complete:true,awardedAt:'2026-01-01',expiresAt:'2027-01-01',certNumber:'CERT-004'}]}:path.endsWith('/instruction')?{available:false,assigned:false}:path.includes('/to-complete')?{items:[]}:path.includes('/courses/')?{title:'Course',lessons:[{id:'L1',title:'Lesson',body:'Original lesson instruction'}]}:{programs:[{id:'VUC003',title:'Hydrogen Sulfide Safety',equivalentCertification:'H2S qualification',courseIds:['VUC003-C01']},{id:'VUC004',title:'Other certification',equivalentCertification:null,courseIds:['VUC003-C01']}],courses:[{id:'VUC003-C01',title:'Course'},{id:'VUC003-C01',title:'Course'}]}}}}));
import VndrlyUCatalog, {CatalogCoursePage, certificationValidity} from './vndrly-u-catalog';
it('reads the shared catalog and material without any company-library lookup',()=>{
 const view=render(<VndrlyUCatalog kind="programs"/>);
 expect(screen.getByText('Equivalent certification: H2S qualification')).toBeTruthy();
 expect(screen.getByRole('link',{name:'Hydrogen Sulfide Safety'}).getAttribute('href')).toBe('/work-hub/bundle/VUC003');
 view.rerender(<VndrlyUCatalog kind="courses"/>);fireEvent.click(screen.getByRole('button',{name:'All courses'}));fireEvent.click(screen.getByRole('button',{name:'Course'}));
 expect(screen.getByText('Original lesson instruction')).toBeTruthy();
 expect(screen.getByRole('link',{name:'View Course'}).getAttribute('href')).toBe('/work-hub/course/VUC003-C01');
 expect(screen.getByText('Applies to certifications (2)')).toBeTruthy();
 expect(screen.getByRole('link',{name:/Other certification/,hidden:true}).getAttribute('href')).toBe('/work-hub/bundle/VUC004');
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

it('keeps both assigned and completed certifications in Mine and applies search',()=>{
 const view=render(<VndrlyUCatalog kind="programs" mine/>);
 expect(screen.getByRole('link',{name:'Hydrogen Sulfide Safety'})).toBeTruthy();
 expect(screen.getByRole('link',{name:/Other certification/})).toBeTruthy();
 view.rerender(<VndrlyUCatalog kind="programs" mine search="Other"/>);
 expect(screen.queryByRole('link',{name:'Hydrogen Sulfide Safety'})).toBeNull();
 expect(screen.getByRole('link',{name:/Other certification/})).toBeTruthy();
});

it('marks completed certifications in both Mine and All',()=>{
 const view=render(<VndrlyUCatalog kind="programs" mine/>);
 const completed=screen.getByRole('link',{name:'Completed: Other certification'});
 expect(completed.closest('article')?.getAttribute('data-certification-complete')).toBe('true');
 expect(screen.getByRole('link',{name:'Hydrogen Sulfide Safety'}).closest('article')?.hasAttribute('data-certification-complete')).toBe(false);
 view.rerender(<VndrlyUCatalog kind="programs"/>);
 expect(screen.getByRole('link',{name:'Completed: Other certification'}).closest('article')?.getAttribute('data-certification-complete')).toBe('true');
});

it('colors expiration statuses using the 90-day warning window',()=>{
 const now=Date.parse('2026-11-20T12:00:00Z');
 expect(certificationValidity('2027-11-20',now).color).toBe('#22c55e');
 expect(certificationValidity('2027-01-01',now).label).toBe('Expiring soon');
 expect(certificationValidity('2027-01-01',now).color).toBe('#f59e0b');
 expect(certificationValidity('2026-11-19',now).color).toBe('#ef4444');
 expect(certificationValidity(null,now).label).toBe('No expiration recorded');
});
it('shows award date, expiration and certificate number on completed cards',()=>{
 render(<VndrlyUCatalog kind="programs" mine/>);
 expect(screen.getByText('Awarded: Jan 1, 2026')).toBeTruthy();
 expect(screen.getByText('Expires: Jan 1, 2027')).toBeTruthy();
 expect(screen.getByText('Certificate: CERT-004')).toBeTruthy();
});

it('offers Renew only for expiring or expired completed certifications',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
 try {
  const view=render(<VndrlyUCatalog kind="programs" mine/>);
  expect(screen.getAllByRole('button',{name:'Renew'})).toHaveLength(1);
  vi.setSystemTime(new Date('2027-02-01T12:00:00Z'));
  view.rerender(<VndrlyUCatalog kind="programs" mine/>);
  expect(screen.getAllByRole('button',{name:'Renew'})).toHaveLength(1);
  vi.setSystemTime(new Date('2026-01-02T12:00:00Z'));
  view.rerender(<VndrlyUCatalog kind="programs" mine/>);
  expect(screen.queryByRole('button',{name:'Renew'})).toBeNull();
 } finally {vi.useRealTimers();}
});
