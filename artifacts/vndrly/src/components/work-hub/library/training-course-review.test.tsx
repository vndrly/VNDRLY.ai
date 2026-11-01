import React from 'react';
import {render,screen,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
vi.mock('./use-library',()=>({useLibrary:(_path:string,parse:(x:unknown)=>unknown)=>({data:parse({title:'Course',people:[{userId:1,name:'Completed Person',status:'completed',instanceId:'record',contentVersion:2,originalPercent:75,remediatedPercent:100,examPercent:95},{userId:2,name:'Unassigned Person',status:'not_assigned',instanceId:null,contentVersion:null,originalPercent:null,remediatedPercent:null,examPercent:null}]})})}));
vi.mock('wouter',()=>({Link:({children,href}:any)=><a href={href}>{children}</a>}));
import TrainingCourseReview from './training-course-review';
afterEach(cleanup);
it('shows who has and has not completed training and keeps original, remediated and exam scores',()=>{
 render(<TrainingCourseReview itemId="course"/>);
 expect(screen.getByRole('region',{name:'Company training compliance'})).toBeTruthy();
 expect(screen.getByText('1 completed · 1 not completed')).toBeTruthy();
 expect(screen.getByText('Unassigned Person')).toBeTruthy();expect(screen.getByText('not assigned')).toBeTruthy();
 for(const score of ['75.0%','100.0%','95.0%'])expect(screen.getByText(score)).toBeTruthy();
 expect(screen.getByRole('link',{name:'Review record'}).getAttribute('href')).toBe('/work-hub/assignment/record');
});
