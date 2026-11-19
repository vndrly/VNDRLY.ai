import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({data:{} as any,request:vi.fn(),refetch:vi.fn()}));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:state.data,refetch:state.refetch,error:null,isPending:false})}));
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{userId:901,preferredLanguage:'en'},setPreferredLanguage:vi.fn()})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({i18n:{language:'en'},t:(_key:string,options:any)=>options?.defaultValue??_key})}));
vi.mock('./gate-profile-notifications',()=>({default:()=>null,GateProfileNotificationSummary:()=>null,notificationPreferenceState:()=> 'all',useProfileNotificationPreferences:()=>({data:{},isPending:false})}));
vi.mock('./gate-profile-devices',()=>({default:()=>null}));
vi.mock('./next-steps-avatar',()=>({NextStepsAvatarPreference:()=>null}));
vi.mock('./profile-setup-summary',()=>({default:()=>null}));
vi.mock('@/components/work-hub/chrome',()=>({BrandedInput:(props:any)=><input {...props}/>,BrandedSelect:(props:any)=><select {...props}/>}));
vi.mock('./gate-profile-chrome',async()=>({...await vi.importActual<any>('./gate-profile-chrome'),profileRequest:state.request}));
import GateProfileAgreements from './gate-profile-agreements';
function show(){render(<GateProfileAgreements name="Synthetic User" hasProfilePhoto profileLoading={false} onOpenPhoto={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'SMS Enrollment'}));}
beforeEach(()=>{
 vi.clearAllMocks();state.data={smsEnrolled:true,smsPhone:'+14055551212',workPhoneEnrolled:true,versions:{privacy:'2026-08-24'},accepted:[{document:'privacy',version:'2026-08-24',acceptedAt:'2026-11-19T12:00:00Z'}]};
 state.request.mockResolvedValue({saved:true});state.refetch.mockResolvedValue({data:state.data});
});
it('shows the enrolled number, permits editing, and confirms a successful changed number',async()=>{
 show();expect(screen.getByLabelText('Enrolled mobile number').textContent).toBe('(405) 555-1212');
 const input=screen.getByRole('textbox',{name:'10-digit mobile number'});expect((input as HTMLInputElement).disabled).toBe(false);
 fireEvent.change(input,{target:{value:'4055559876'}});fireEvent.click(screen.getByRole('button',{name:'Change Number'}));
 await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('(405) 555-9876'));
 expect(JSON.parse(state.request.mock.calls[0][1].body)).toMatchObject({phone:'4055559876',consent:'yes',workPhone:true,workPhoneVersion:'2026-11-19'});
 expect(screen.queryByRole('button',{name:'Use this as Work Phone'})).toBeNull();
});
it('requires one explicit combined checkbox for enrollment and unsubscribes both through one request',async()=>{
 state.data.workPhoneEnrolled=false;show();
 expect((screen.getByRole('button',{name:'Change Number'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:'Use this as Work Phone and agree to SMS Enrollment'}));
 expect((screen.getByRole('button',{name:'Change Number'}) as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Unsubscribe'}));
 await waitFor(()=>expect(state.request).toHaveBeenCalled());
 expect(JSON.parse(state.request.mock.calls[0][1].body)).toMatchObject({consent:'no',workPhone:true});
});
it('retains accepted agreements as read-only evidence and uses the supplied icon',()=>{
 show();fireEvent.click(screen.getByRole('button',{name:'Privacy Policy'}));
 expect(screen.queryByRole('checkbox',{name:'I agree'})).toBeNull();expect(screen.queryByRole('switch')).toBeNull();
 expect(screen.getAllByAltText('Accepted')[0].getAttribute('src')).toBe('/images/agreement-accepted.png');
 expect(screen.getByText(/^Accepted ·/)).toBeTruthy();
});
it('does not display a saved check when the number change fails',async()=>{
 state.request.mockRejectedValue(Error('Save failed'));show();
 fireEvent.click(screen.getByRole('button',{name:'Change Number'}));
 expect((await screen.findByRole('alert')).textContent).toContain('Save failed');expect(screen.queryByRole('status')).toBeNull();
});
