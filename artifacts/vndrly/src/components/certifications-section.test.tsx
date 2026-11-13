import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const state=vi.hoisted(()=>({save:vi.fn().mockResolvedValue({})}));
vi.mock('@workspace/api-client-react',()=>({
 useListEmployeeCertifications:()=>({data:[],isLoading:false}),
 useListCertificationNames:()=>({data:['Pipeline Operator Qualification (OQ)']}),
 useCreateEmployeeCertification:()=>({mutateAsync:state.save}),
 useUpdateEmployeeCertification:()=>({mutateAsync:state.save}),
 useDeleteEmployeeCertification:()=>({mutateAsync:state.save}),
 getListEmployeeCertificationsQueryKey:()=>['certifications'],getListCertificationNamesQueryKey:()=>['names'],
}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(s:string)=>s})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/components/png-pill-rollover',()=>({PngPillButton:({children,color,...props}:any)=><button {...props}>{children}</button>}));
vi.mock('@/components/employee-dialog-content',()=>({default:({children}:any)=><div>{children}</div>}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({open,children}:any)=>open?<div>{children}</div>:null,DialogTrigger:()=>null}));
vi.mock('@/components/ui/select',()=>({
 Select:({children,onValueChange,value,...props}:any)=><select {...props} value={value??''} onChange={e=>onValueChange(e.target.value)}><option value="">Choose</option>{children}</select>,
 SelectTrigger:()=>null,SelectValue:()=>null,SelectContent:({children}:any)=><>{children}</>,SelectItem:({value,children}:any)=><option value={value}>{children}</option>,
}));
import CertificationsSection from './certifications-section';
afterEach(()=>{cleanup();state.save.mockClear();});
it.each(['inline','card'] as const)('captures full qualification details in the %s employee form and can reopen after cancelling',async variant=>{
 const {container}=render(<QueryClientProvider client={new QueryClient()}><CertificationsSection employeeId={12} variant={variant}/></QueryClientProvider>);
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'Pipeline Operator Qualification (OQ)'}});
 expect(screen.getByText('Pipeline operator')).toBeTruthy();
 expect(container.querySelector('input[type=file]')?.getAttribute('accept')).toBe('image/*,application/pdf');
 fireEvent.click(screen.getByText('Cancel'));
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'Pipeline Operator Qualification (OQ)'}});
 fireEvent.change(screen.getByTestId('employee-certifications-cert-number'),{target:{value:'SYNTHETIC-12'}});
 const operator=screen.getByText('Pipeline operator').parentElement!.querySelector('input')!;
 fireEvent.change(operator,{target:{value:'Synthetic Operator'}});
 fireEvent.click(screen.getByText('Add'));
 await waitFor(()=>expect(state.save).toHaveBeenCalledWith({employeeId:12,data:expect.objectContaining({certNumber:'SYNTHETIC-12',issuedDate:null,qualificationDetails:{'Pipeline operator':'Synthetic Operator'}})}));
 expect(screen.queryByText('Pipeline operator')).toBeNull();
});
