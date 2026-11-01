import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
vi.mock('wouter',()=>({Link:({href,children}:any)=><a href={href}>{children}</a>}));
vi.mock('./use-library',()=>({useLibrary:()=>({data:{title:'Permit to work',studyUrl:'/api/work-hub/library/course/study-guide.pdf',outline:[{number:1,title:'Define scope',summary:'Identify the equipment and task boundaries.',questionCount:3}],scoring:{questionCount:26,guided:true,passingPercent:100,exam:{questionCount:40,passingPercent:80}},companyScoring:{maximumTrainingPoints:10,formula:'10 × completed ÷ required',explanation:'The service and role baseline counts applicable person/course requirements.'},related:[{itemId:'11111111-1111-4111-8111-111111111111',familyId:'H04',title:'Hazardous energy isolation'}]},error:''})}));
import TrainingCourseGuide from './training-course-guide';
afterEach(cleanup);
it('provides actual study download, outline, score explanation and linked training',()=>{
 render(<TrainingCourseGuide itemId="course"/>);
 expect(screen.getByRole('link',{name:'Download study guide (PDF)'}).getAttribute('href')).toBe('/api/work-hub/library/course/study-guide.pdf');expect(screen.getByText('Identify the equipment and task boundaries.')).toBeTruthy();expect(screen.getByText(/Original score:/)).toBeTruthy();expect(screen.getByText(/passing standard 80%/)).toBeTruthy();expect(screen.getByRole('link',{name:'Hazardous energy isolation'}).getAttribute('href')).toContain('?view=training');
});
