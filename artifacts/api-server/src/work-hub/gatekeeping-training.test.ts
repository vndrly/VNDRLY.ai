import {it,expect,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
import {ensureGatekeepingTraining} from './gatekeeping-training';
it('does not infer gate training for partner accounts',async()=>{const execute=vi.fn();expect(await ensureGatekeepingTraining({execute} as any,{type:'partner',id:1})).toBe(0);expect(execute).not.toHaveBeenCalled();});
it('assigns only the shared Gatekeeping course and preserves explicit extras/history',async()=>{
 const execute=vi.fn().mockResolvedValueOnce({rows:[{user_id:7}]}).mockResolvedValueOnce({rows:[{id:'course'}]}).mockResolvedValueOnce({rows:[{id:'legacy'}]});
 expect(await ensureGatekeepingTraining({execute} as any,{type:'vendor',id:5},7)).toBe(2);
 const queries=execute.mock.calls.map(([q])=>new PgDialect().sqlToQuery(q));
 expect(queries[0].params).toEqual([5,7]);
 expect(queries[1].params).toContain('VUC116-C01');expect(queries[1].params).toContain('["VUC116-GATEKEEPING"]');
 expect(queries[1].sql).not.toMatch(/progress\s*=/);expect(queries[2].sql).toContain("'cancelled'");
 for(const protection of ['work_hub_client_operations','requiredUserIds','requiredStaffRoleIds','vendor_augmentation','work_hub_form_submissions',"->>'bundleId' IS NULL"])expect(queries[2].sql).toContain(protection);
 expect(queries[2].sql).not.toMatch(/DELETE|TRUNCATE/);
});
