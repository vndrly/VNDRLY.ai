import React from 'react';
import {describe,it,expect,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import QualificationRequirements from './qualification-requirements';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
describe('qualification requirement reference',()=>{
 it('does not render empty or legacy context',()=>{
  const view=render(<QualificationRequirements/>);
  expect(view.container.textContent).toBe('');cleanup();
 });
 it('starts collapsed and shows actual role scope without claiming a qualification result',()=>{
  render(<QualificationRequirements items={[{programId:'OG15',title:'Pipeline OQ',benchmark:'Operator qualification',audience:'Covered-task performers',requirement:'Use the operator program and evaluate abnormal conditions.',renewal:'Operator-specific interval',sourceUrls:['https://www.phmsa.dot.gov/pipeline/operator-qualifications/operator-qualification']}]} />);
  const details=screen.getByTestId('qualification-requirements');
  expect(details.hasAttribute('open')).toBe(false);
  expect(screen.getByText('Covered-task performers')).toBeTruthy();
  expect(screen.queryByText('Qualified')).toBeNull();
  expect(screen.getByRole('link',{hidden:true}).getAttribute('rel')).toBe('noopener noreferrer');cleanup();
 });
});
