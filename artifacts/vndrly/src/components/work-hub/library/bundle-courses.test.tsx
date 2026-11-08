import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import BundleDetail from './bundle-detail';
vi.mock('wouter',()=>({useLocation:()=>['',vi.fn()],Link:({href,children,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('./bundle-editor',()=>({default:()=>null}));
vi.mock('./assignment-review',()=>({default:()=>null}));
vi.mock('./option-switch',()=>({default:()=>null}));
vi.mock('./editor-controls',()=>({Frame:({children}:any)=><div>{children}</div>,Paragraph:({children,style}:any)=><p style={style}>{children}</p>,Heading:({children}:any)=><h2>{children}</h2>,Pill:({children,onPress}:any)=><button onClick={onPress}>{children}</button>,usePalette:()=>({})}));
vi.mock('./use-library',()=>({useLibrary:(path:string)=>({data:path.includes('/options')?{groups:[]}:{new:false,itemId:'bundle',title:'VNDRLY/U | Rig Safety',metadata:{state:'published',contentVersion:1,version:0},canManage:false,bundle:{description:'Purpose: rig safety.\n\nPractical evaluation remains separate.',onboarding:{enabled:false,groupIds:[],roles:[]},entries:[{templateId:'course-a',contentVersion:2,dueHours:720}]},entries:[{itemId:'course-a',title:'Rig Safety | Applied Practice',contentVersion:2}]},reload:vi.fn()})}));
afterEach(cleanup);
it('opens actual version-pinned course content from the certification and does not mislabel assignment deadlines as course hours',()=>{
 render(<BundleDetail itemId="bundle"/>);
 expect(screen.getByRole('link',{name:/Rig Safety/}).getAttribute('href')).toBe('/work-hub/library/course-a?view=training');
 expect(screen.queryByText(/720/)).toBeNull();
 expect(screen.getByText(/Practical evaluation remains separate/).style.whiteSpace).toBe('pre-line');
});
