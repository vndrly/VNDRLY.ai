import { expect, it } from 'vitest';
import { certificationLogoStatuses } from './certification-logo-status';
it('distinguishes unassigned, explicit incomplete and completed certification progress', () => {
  expect(certificationLogoStatuses([])).toEqual({});
  expect(certificationLogoStatuses([
    {id:'company-bundle',title:'VNDRLY/U Energy Safety Core',complete:false},
    {id:'VUC003',title:'H2S',complete:true},
    {id:'VUC004',title:'Group only',complete:true,groupingOnly:true},
    {id:'VUC035',title:'One course only',complete:true,standalone:true},
  ])).toEqual({VUC001:'assigned',VUC003:'completed'});
});
