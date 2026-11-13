import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ExternalTrainingCredit} from './external-training-credit';
vi.mock('react-i18next',()=>({useTranslation:()=>({i18n:{language:'en'}})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('loads topics only when opened and submits the selected reviewed coverage',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>[{familyId:'H13',title:'H2S awareness',purpose:'Alarm response',practicalBoundary:'No rescue authorization'}]}).mockResolvedValueOnce({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
 const saved=vi.fn();render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ExternalTrainingCredit employeeId={1} certificateId={2} onSaved={saved}/></QueryClientProvider>);
 expect(fetch).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Outside training credit'));
 await screen.findByText('H13 | H2S awareness');fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'Reviewed synthetic syllabus and issuer record.'}});fireEvent.click(screen.getByText('Save review'));
 await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
 expect(fetch.mock.calls[1][0]).toBe('/api/field-employees/1/certifications/2/training-credit');
 expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({familyIds:['H13'],reviewNote:'Reviewed synthetic syllabus and issuer record.'});
});
