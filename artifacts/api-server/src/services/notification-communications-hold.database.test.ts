import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db, pool, usersTable, vendorsTable, notificationsTable, notificationPreferencesTable, userOrgMembershipsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { assertFreshLocalTestDatabaseEnvironment } from '../../../../scripts/fresh-test-database.mjs';
import { countUnreadForUser, notifyUsers } from '../routes/notifications';

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === 'fresh-local')('communications testing under the MidCon hold', () => {
  it('counts communications only and withholds operational fanout even when forced', async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const suffix=randomUUID();
    await db.insert(vendorsTable).values({id:1054,name:'Synthetic held company',contactName:'Test',contactEmail:`${suffix}@example.invalid`}).onConflictDoNothing();
    const [user]=await db.insert(usersTable).values({username:`hold-${suffix}`,passwordHash:'synthetic',role:'vendor',displayName:'Synthetic held recipient'}).returning();
    await db.insert(userOrgMembershipsTable).values({userId:user.id,orgType:'vendor',vendorId:1054,role:'admin'});
    const types=['work_hub_message','work_hub_mention','work_hub_poll','work_hub_call','work_hub_meeting_invite','gate_closed','ticket_flagged','work_hub_form_campaign'];
    await db.insert(notificationsTable).values(types.map(type=>({userId:user.id,type,category:'system',title:'Synthetic saved notice'})));
    expect(await countUnreadForUser(user.id)).toBe(5);
    await db.insert(notificationPreferencesTable).values({userId:user.id,pushEnabled:false,systemEmailEnabled:false});
    const communication={type:'work_hub_message',title:'Synthetic communication',dedupeKey:`hold-test:${suffix}`};
    expect(await notifyUsers([user.id],communication)).toBe(1);
    expect(await notifyUsers([user.id],communication)).toBe(0);
    expect(await notifyUsers([user.id],{type:'gate_closed',title:'Must stay held',forceImmediateDelivery:true})).toBe(0);
    expect(await notifyUsers([user.id],{type:'ticket_flagged',title:'Must stay held',forceImmediateDelivery:true})).toBe(0);
    const saved=await db.select().from(notificationsTable).where(eq(notificationsTable.userId,user.id));
    expect(saved).toHaveLength(types.length+1);
    await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1 AND type=$2',[user.id,'work_hub_message']);
    expect(await countUnreadForUser(user.id)).toBe(4);
  });
});
