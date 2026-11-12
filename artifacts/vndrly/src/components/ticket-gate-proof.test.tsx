import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({user:{userId:1,activeMembershipId:2}})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
import TicketGateProof from './ticket-gate-proof';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('links authenticated originals and discloses missing exit photos even when an exit timestamp exists',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({ticketId:7,visits:[{id:1,siteName:'Site',gateName:'Gate',checkInTime:'2026-11-12T12:00:00Z',checkOutTime:'2026-11-12T13:00:00Z',admissionStatus:'admitted',capture:{images:[{objectPath:'/objects/uploads/derived',originalPath:'/objects/uploads/original',phase:'entry'}]}}]})})));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><TicketGateProof ticketId={7}/></QueryClientProvider>);
 expect(await screen.findByText('gateProof.missingExitPhoto')).toBeTruthy();expect(screen.queryByText('gateProof.missingEntryPhoto')).toBeNull();expect(screen.getByRole('link').getAttribute('href')).toBe('/api/storage/objects/uploads/original');expect(screen.getByRole('img').getAttribute('src')).toBe('/api/storage/objects/uploads/derived');client.clear();
});
