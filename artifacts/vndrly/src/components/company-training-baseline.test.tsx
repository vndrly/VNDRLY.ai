import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import Baseline from './company-training-baseline';
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{vendorId:1115}})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('./work-hub/library/training-service-connections',()=>({default:()=>null}));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:{categories:[{id:'training',points:0}],trainingBaseline:{required:1,completed:0,unavailable:0,services:[{code:'gatekeeping',name:'Gatekeeping'}],unmappedServiceIds:[],conditionalCourseGaps:[{serviceId:'gatekeeping',familyId:'G01',courseTitle:'Exposure training',trainingItemId:'course-1',role:'Gate worker',reason:'Confirm actual exposure'}]}}})}));
it('identifies the course, service and role and links directly to its policy',()=>{
 render(<Baseline/>);
 expect(screen.getByText('Exposure training')).toBeTruthy();
 expect(screen.getByText('Gatekeeping · Gate worker')).toBeTruthy();
 expect(screen.getByRole('link',{name:'trainingPolicy.reviewScope'}).getAttribute('href')).toBe('/work-hub/library/course-1?view=policy');
});