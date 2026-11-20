import React from 'react';
vi.mock('./profile-licenses', () => ({ ProfileLicenses: () => null }));
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const state=vi.hoisted(()=>({certs:[] as any[],save:vi.fn().mockResolvedValue({}),close:(_open:boolean)=>{}}));
vi.mock('@workspace/api-client-react',()=>({
 useListEmployeeCertifications:()=>({data:state.certs,isLoading:false}),
 useListCertificationNames:()=>({data:['Pipeline Operator Qualification (OQ)']}),
 useCreateEmployeeCertification:()=>({mutateAsync:state.save}),
 useUpdateEmployeeCertification:()=>({mutateAsync:state.save}),
 useDeleteEmployeeCertification:()=>({mutateAsync:state.save}),
 getListEmployeeCertificationsQueryKey:()=>['certifications'],getListCertificationNamesQueryKey:()=>['names'],
}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(s:string)=>s})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/components/png-pill-rollover',()=>({PngPillButton:({children,color,...props}:any)=><button {...props}>{children}</button>}));
vi.mock('@/components/employee-dialog-content',()=>({default:({children,footerAction}:any)=><div>{children}<button onClick={()=>state.close(false)}>Cancel</button>{footerAction}</div>}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({open,children,onOpenChange}:any)=>{state.close=onOpenChange;return open?<div>{children}</div>:null;},DialogTrigger:()=>null}));
vi.mock('@/components/certification-picker',()=>({
 CertificationPicker:({names,onChange,value}:any)=><select value={value??''} onChange={e=>onChange(e.target.value)}><option value="">Choose</option>{names.map((name:string)=><option key={name} value={name}>{name}</option>)}</select>,
}));
import CertificationsSection from './certifications-section';
afterEach(()=>{cleanup();state.save.mockClear();state.certs=[];});
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
it('saves award and completion documents independently alongside qualification details',async()=>{
 let uploads=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.endsWith('/request-url')){uploads++;return {ok:true,json:async()=>({uploadURL:'/upload/'+uploads,objectPath:'/objects/uploads/doc-'+uploads})};}
  return {ok:true,json:async()=>({})};
 }));
 try{
 render(<QueryClientProvider client={new QueryClient()}><CertificationsSection employeeId={12} variant="inline"/></QueryClientProvider>);
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'Pipeline Operator Qualification (OQ)'}});
 fireEvent.change(screen.getByTestId('employee-certifications-cert-number'),{target:{value:'SYNTHETIC-12'}});
 const award=screen.getByText('Award document').querySelector('input')!;
 fireEvent.change(award,{target:{files:[new File(['award'],'award.pdf',{type:'application/pdf'})]}});
 await screen.findByText('View attached award document');
 const completion=screen.getByText('Completion document').querySelector('input')!;
 fireEvent.change(completion,{target:{files:[new File(['completion'],'completion.pdf',{type:'application/pdf'})]}});
 await screen.findByText('View attached completion document');
 fireEvent.click(screen.getByText('Add'));
 await waitFor(()=>expect(state.save).toHaveBeenCalledWith({employeeId:12,data:expect.objectContaining({qualificationDetails:{'Award document':'/api/storage/objects/uploads/doc-1','Completion document':'/api/storage/objects/uploads/doc-2'}})}));
 }finally{vi.unstubAllGlobals();}
});

it('shows read-only industry details and opens the editor from the card',()=>{
 state.certs=[{id:1,name:'First Aid / CPR / AED',issuer:'Example issuer',certNumber:'ABC123',expirationDate:'2027-12-01',issuedDate:'2026-12-01'}];
 render(<QueryClientProvider client={new QueryClient()}><CertificationsSection employeeId={12} variant="inline"/></QueryClientProvider>);
 const card=screen.getByTestId('employee-certifications-row-1');
 expect(card.querySelector('input')).toBeNull();
 expect(screen.getByText('Certificate number: ABC123')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Edit'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Remove'})).toBeTruthy();
 fireEvent.click(screen.getByText('First Aid / CPR / AED'));
 expect(screen.getByTestId('employee-certifications-cert-number')).toHaveProperty('value','ABC123');
});
