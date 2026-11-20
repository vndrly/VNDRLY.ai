import React from 'react';
import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import CourseContent,{cleanCourseContent} from './course-content';
import {catalogTitle} from '@/lib/catalog-title';

it('cleans catalog and benchmark titles without removing meaningful course subjects',()=>{
 expect(catalogTitle('## VUC003 | Hydrogen Sulfide Safety — program and instructor guide')).toBe('VUC003 | Hydrogen Sulfide Safety');
 expect(catalogTitle('VNDRLY/U Atmospheric Safety — Hydrogen Sulfide')).toBe('VNDRLY/U Atmospheric Safety: Hydrogen Sulfide');
 const {container}=render(<CourseContent title="Hydrogen Sulfide Safety" body={'# Hydrogen Sulfide Safety — program and instructor guide\n\n## Response\n\nStop — report the hazard.'}/>);
 expect(container.textContent).toBe('ResponseStop: report the hazard.');
});

it('removes the repeated section heading and preserves the instruction',()=>{
 const body='## Who this program is for\n\nThis program prepares field workers.\n\nDo not enter a hazardous space without authorization.';
 render(<CourseContent title="Who this program is for" body={body}/>);
 expect(screen.queryByText('Who this program is for')).toBeNull();
 expect(screen.getByText('This program prepares field workers.')).toBeTruthy();
 expect(screen.getByText('Do not enter a hazardous space without authorization.')).toBeTruthy();
});
it('renders headings, emphasis, lists, tables and safe links without source notation',()=>{
 const {container}=render(<CourseContent title="Course" body={'# Course\n\n## Steps\n\n**Check** the *area*.\n\n- Stop\n- Report\n\n1. Inspect\n2. Record\n\n| Item | Action |\n| --- | --- |\n| Gate | Close |\n\n[Source](https://example.com) [Unsafe](javascript:bad)'}/>);
 expect(screen.getByRole('heading',{name:'Steps'})).toBeTruthy();
 expect(container.querySelector('strong')?.textContent).toBe('Check');
 expect(screen.getAllByRole('listitem')).toHaveLength(4);
 expect(screen.getByRole('cell',{name:'Gate'})).toBeTruthy();
 expect(screen.getByRole('link',{name:'Source'})).toBeTruthy();
 expect(screen.queryByRole('link',{name:'Unsafe'})).toBeNull();
 expect(container.textContent).not.toMatch(/##|\*\*|\| ---/);
});
it('cleans editorial labels inside content but keeps scope and technical notation',()=>{
 expect(cleanCourseContent('# Safety — learner and delivery guide\n\nRevision: 2026-11-17. Program: G99. Scope: onshore safety.\n\nComplete learner coursebook · Version 3\n\n## Other — learner and delivery guide\n\nKeep tag #12 and pressure > 10 psi.','Safety — learner and delivery guide'))
 .toBe('Scope: onshore safety.\n\n\n\n## Other\n\nKeep tag #12 and pressure > 10 psi.');
});
