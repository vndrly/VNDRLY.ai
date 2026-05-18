// One-shot, additive-only production seed for the demo lifecycle.
//
// Background: the production database is provisioned independently from
// dev, so the demo data hand-built in dev (13 lifecycle tickets across
// vendors Winchester (3) and Baker Hughes (2) under partners Exxon (1)
// and Mach (19), plus the demo logins for those orgs) is not present
// after the first publish. The dev-only `/auth/seed` endpoint is gated
// on `NODE_ENV === "development"` and cannot be invoked against prod,
// so this endpoint exists to materialize the same demo state in prod.
//
// Safety contract:
//   - POST only.
//   - Token-gated by `?token=<hardcoded one-shot token>`.
//   - Strictly additive: every write is INSERT ... WHERE NOT EXISTS or
//     INSERT ... ON CONFLICT DO NOTHING. The only UPDATEs touch demo
//     accounts (joe.boggs/matt/daniel password resets, daniel's
//     vendor_people user_id link) and never modify any non-demo row.
//   - Idempotent: a second call returns the same end state with zero
//     net change.
//   - Wrapped in a single transaction so a failure rolls back cleanly.

import { Router } from "express";
import {
  db,
  usersTable,
  vendorPeopleTable,
  userOrgMembershipsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { DEMO_USERS } from "../lib/demo-users";
import { logger } from "../lib/logger";
import {
  DEMO_TICKETS,
  DEMO_STATUS_HISTORY,
  DEMO_CHECK_INS,
  DEMO_GPS_LOGS,
  DEMO_SWA_ROWS,
  DEV_USERID_TO_USERNAME,
} from "../lib/demo-prod-seed-data";

const router = Router();

// One-shot opaque token. Long and unique so the endpoint cannot be
// triggered by accident or by a casual scan of the API surface. After
// the demo is set up, this whole route file can be deleted.
const SEED_TOKEN = "vndrly-demo-2026-04-30-prod-seed-once-9F2X";

// Field-employee demo passwords. These accounts are NOT in DEMO_USERS
// (which is the partner/vendor-admin login set). They are seeded here
// so they can be added on top of an existing prod DB without polluting
// the dev seed contract. Updates only target accounts created for the
// demo; any other user with the same username would be untouched
// because we resolve by exact username match.
const FIELD_DEMO_LOGINS = [
  {
    username: "joe.boggs@winchester.com",
    password: "joe123",
    displayName: "Joe Boggs",
    vendorId: 3,
    preferredLanguage: "en" as const,
  },
  {
    username: "matt@elerick.com",
    password: "matt123",
    displayName: "Matt Elerick",
    vendorId: 3,
    preferredLanguage: null,
  },
  {
    username: "daniel",
    password: "daniel123",
    displayName: "Daniel Ortiz",
    vendorId: 2,
    preferredLanguage: "en" as const,
    // If a vendor_people row exists for this vendor with NULL user_id,
    // claim it so the field employee gets a stable people-record link.
    // Hard-pinned to vendor_people.id 11 because that is Daniel Ortiz
    // in the seeded Baker Hughes roster.
    claimVendorPeopleId: 11,
  },
] as const;

// Extra org-admin demo logins added on top of DEMO_USERS without polluting
// the dev demo-account picker (DEMO_USERS feeds /api/auth/demo-users in
// development). Same idempotent contract as the loops above: insert if
// missing, reset password if drifted, fill in any missing membership.
interface ExtraAdminLogin {
  username: string;
  email: string;
  password: string;
  displayName: string;
  role: "admin" | "partner" | "vendor";
  orgType: "partner" | "vendor";
  orgId: number;
}

const EXTRA_ADMIN_LOGINS: ExtraAdminLogin[] = [
  {
    username: "baker@vndrly.com",
    email: "baker@vndrly.com",
    password: "baker1",
    displayName: "Baker Hughes Field Svcs Admin",
    role: "vendor",
    orgType: "vendor",
    orgId: 2, // vendors.id for Baker Hughes Field Svcs
  },
];

router.post("/demo/seed-prod-demo", async (req, res) => {
  if (req.query.token !== SEED_TOKEN) {
    return res.status(403).json({ message: "forbidden" });
  }

  try {
    const result = await db.transaction(async (tx) => {
      // ----------------------------------------------------------------
      // 1. Demo-user sync (mirror of the dev /auth/seed handler logic).
      //    Materializes admin/partner/vendor logins from DEMO_USERS in
      //    a way that is safe to re-run. Existing accounts have their
      //    password rehashed to the canonical demo password if it has
      //    drifted, and any missing memberships are filled in.
      // ----------------------------------------------------------------
      const hash = (pw: string) => bcrypt.hashSync(pw, 10);
      const usersAdded: string[] = [];
      const passwordsRecovered: string[] = [];

      const existingAll = await tx
        .select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable);
      const existingByName = new Map(
        existingAll.map((u) => [u.username.toLowerCase(), u.id] as const),
      );

      for (const demo of DEMO_USERS) {
        const derivedRole: "admin" | "field_employee" =
          demo.role === "field_employee" ? "field_employee" : "admin";
        const desired =
          demo.memberships && demo.memberships.length > 0
            ? demo.memberships
            : demo.partnerId
              ? [
                  {
                    orgType: "partner" as const,
                    orgId: demo.partnerId,
                    role: derivedRole,
                  },
                ]
              : demo.vendorId
                ? [
                    {
                      orgType: "vendor" as const,
                      orgId: demo.vendorId,
                      role: derivedRole,
                    },
                  ]
                : [];

        let userId = existingByName.get(demo.username.toLowerCase()) ?? null;
        let userActiveMembershipId: number | null = null;

        if (userId === null) {
          const [newRow] = await tx
            .insert(usersTable)
            .values({
              username: demo.username,
              passwordHash: hash(demo.password),
              role: demo.role,
              displayName: demo.displayName,
              preferredLanguage:
                demo.preferredLanguage === "en" || demo.preferredLanguage === "es"
                  ? demo.preferredLanguage
                  : null,
            })
            .returning({ id: usersTable.id });
          userId = newRow.id;
          usersAdded.push(demo.username);
        } else {
          const [u] = await tx
            .select({
              activeMembershipId: usersTable.activeMembershipId,
              passwordHash: usersTable.passwordHash,
              mustChangePassword: usersTable.mustChangePassword,
            })
            .from(usersTable)
            .where(eq(usersTable.id, userId));
          userActiveMembershipId = u?.activeMembershipId ?? null;

          const passwordOk =
            !!u && bcrypt.compareSync(demo.password, u.passwordHash);
          if (!passwordOk) {
            await tx
              .update(usersTable)
              .set({
                passwordHash: hash(demo.password),
                mustChangePassword: false,
                sessionVersion: sql`${usersTable.sessionVersion} + 1`,
              })
              .where(eq(usersTable.id, userId));
            passwordsRecovered.push(demo.username);
          } else if (u?.mustChangePassword) {
            await tx
              .update(usersTable)
              .set({ mustChangePassword: false })
              .where(eq(usersTable.id, userId));
          }
        }

        const existingMemberships = await tx
          .select()
          .from(userOrgMembershipsTable)
          .where(eq(userOrgMembershipsTable.userId, userId));

        for (const m of desired) {
          const already = existingMemberships.find((row) =>
            m.orgType === "partner"
              ? row.partnerId === m.orgId
              : row.vendorId === m.orgId,
          );
          if (already) continue;
          await tx.insert(userOrgMembershipsTable).values({
            userId,
            orgType: m.orgType,
            partnerId: m.orgType === "partner" ? m.orgId : null,
            vendorId: m.orgType === "vendor" ? m.orgId : null,
            role: m.role,
          });
        }

        const allMyMemberships = await tx
          .select()
          .from(userOrgMembershipsTable)
          .where(eq(userOrgMembershipsTable.userId, userId));
        if (
          allMyMemberships.length === 1 &&
          userActiveMembershipId !== allMyMemberships[0].id
        ) {
          await tx
            .update(usersTable)
            .set({ activeMembershipId: allMyMemberships[0].id })
            .where(eq(usersTable.id, userId));
        }
      }

      // ----------------------------------------------------------------
      // 2. Field-employee demo logins (joe / matt / daniel).
      //    Add the user if missing; otherwise reset to the canonical
      //    demo password so the demo can log in. Daniel additionally
      //    claims a stable vendor_people slot so he shows up on rosters.
      // ----------------------------------------------------------------
      const fieldUsersCreated: string[] = [];
      const fieldUsersPasswordReset: string[] = [];
      const danielVendorPeopleClaimed: number[] = [];

      for (const f of FIELD_DEMO_LOGINS) {
        const [existing] = await tx
          .select({
            id: usersTable.id,
            passwordHash: usersTable.passwordHash,
            mustChangePassword: usersTable.mustChangePassword,
          })
          .from(usersTable)
          .where(eq(usersTable.username, f.username));

        let userId: number;
        if (!existing) {
          const [newRow] = await tx
            .insert(usersTable)
            .values({
              username: f.username,
              passwordHash: hash(f.password),
              role: "field_employee",
              displayName: f.displayName,
              preferredLanguage: f.preferredLanguage,
            })
            .returning({ id: usersTable.id });
          userId = newRow.id;
          fieldUsersCreated.push(f.username);
        } else {
          userId = existing.id;
          const passwordOk = bcrypt.compareSync(f.password, existing.passwordHash);
          if (!passwordOk) {
            await tx
              .update(usersTable)
              .set({
                passwordHash: hash(f.password),
                mustChangePassword: false,
                sessionVersion: sql`${usersTable.sessionVersion} + 1`,
              })
              .where(eq(usersTable.id, userId));
            fieldUsersPasswordReset.push(f.username);
          } else if (existing.mustChangePassword) {
            await tx
              .update(usersTable)
              .set({ mustChangePassword: false })
              .where(eq(usersTable.id, userId));
          }
        }

        // Add a field_employee membership on this user's vendor if missing.
        const [hasMem] = await tx
          .select({ id: userOrgMembershipsTable.id })
          .from(userOrgMembershipsTable)
          .where(
            sql`${userOrgMembershipsTable.userId} = ${userId} AND ${userOrgMembershipsTable.vendorId} = ${f.vendorId}`,
          );
        if (!hasMem) {
          await tx.insert(userOrgMembershipsTable).values({
            userId,
            orgType: "vendor",
            partnerId: null,
            vendorId: f.vendorId,
            role: "field_employee",
          });
        }

        // Daniel: claim vendor_people 11 only if it's still unclaimed.
        if ("claimVendorPeopleId" in f && f.claimVendorPeopleId) {
          const [vp] = await tx
            .select({
              id: vendorPeopleTable.id,
              userId: vendorPeopleTable.userId,
            })
            .from(vendorPeopleTable)
            .where(eq(vendorPeopleTable.id, f.claimVendorPeopleId));
          if (vp && vp.userId === null) {
            await tx
              .update(vendorPeopleTable)
              .set({ userId })
              .where(eq(vendorPeopleTable.id, f.claimVendorPeopleId));
            danielVendorPeopleClaimed.push(f.claimVendorPeopleId);
          }
        }
      }

      // ----------------------------------------------------------------
      // 2b. Extra org-admin logins (EXTRA_ADMIN_LOGINS). Same idempotent
      //     contract as the DEMO_USERS loop: insert if missing, reset
      //     password if it has drifted, fill in any missing membership,
      //     and pin active_membership_id when there is exactly one.
      // ----------------------------------------------------------------
      const extraAdminsCreated: string[] = [];
      const extraAdminsPasswordReset: string[] = [];

      for (const a of EXTRA_ADMIN_LOGINS) {
        const [existing] = await tx
          .select({
            id: usersTable.id,
            passwordHash: usersTable.passwordHash,
            mustChangePassword: usersTable.mustChangePassword,
            email: usersTable.email,
            activeMembershipId: usersTable.activeMembershipId,
          })
          .from(usersTable)
          .where(sql`lower(${usersTable.username}) = lower(${a.username})`);

        let userId: number;
        let activeMembershipId: number | null = null;
        if (!existing) {
          const [newRow] = await tx
            .insert(usersTable)
            .values({
              username: a.username,
              email: a.email,
              emailVerifiedAt: new Date(),
              passwordHash: hash(a.password),
              role: a.role,
              displayName: a.displayName,
              mustChangePassword: false,
            })
            .returning({ id: usersTable.id });
          userId = newRow.id;
          extraAdminsCreated.push(a.username);
        } else {
          userId = existing.id;
          activeMembershipId = existing.activeMembershipId ?? null;
          const passwordOk = bcrypt.compareSync(a.password, existing.passwordHash);
          if (!passwordOk) {
            await tx
              .update(usersTable)
              .set({
                passwordHash: hash(a.password),
                mustChangePassword: false,
                sessionVersion: sql`${usersTable.sessionVersion} + 1`,
              })
              .where(eq(usersTable.id, userId));
            extraAdminsPasswordReset.push(a.username);
          } else if (existing.mustChangePassword) {
            await tx
              .update(usersTable)
              .set({ mustChangePassword: false })
              .where(eq(usersTable.id, userId));
          }
          if (!existing.email) {
            await tx
              .update(usersTable)
              .set({ email: a.email, emailVerifiedAt: new Date() })
              .where(eq(usersTable.id, userId));
          }
        }

        const existingMems = await tx
          .select()
          .from(userOrgMembershipsTable)
          .where(eq(userOrgMembershipsTable.userId, userId));
        const want = existingMems.find((row) =>
          a.orgType === "partner"
            ? row.partnerId === a.orgId
            : row.vendorId === a.orgId,
        );
        if (!want) {
          await tx.insert(userOrgMembershipsTable).values({
            userId,
            orgType: a.orgType,
            partnerId: a.orgType === "partner" ? a.orgId : null,
            vendorId: a.orgType === "vendor" ? a.orgId : null,
            role: "admin",
          });
        }

        const allMine = await tx
          .select()
          .from(userOrgMembershipsTable)
          .where(eq(userOrgMembershipsTable.userId, userId));
        if (
          allMine.length === 1 &&
          activeMembershipId !== allMine[0].id
        ) {
          await tx
            .update(usersTable)
            .set({ activeMembershipId: allMine[0].id })
            .where(eq(usersTable.id, userId));
        }
      }

      // ----------------------------------------------------------------
      // 3. Build the username -> prod user_id map. All ticket and
      //    history rows below resolve dev user IDs to prod user IDs by
      //    going through this map (DEV_USERID_TO_USERNAME -> username
      //    -> prod id), since the auto-assigned IDs of the freshly
      //    seeded demo accounts won't match dev.
      // ----------------------------------------------------------------
      const allUsersNow = await tx
        .select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable);
      const usernameToId = new Map<string, number>();
      for (const u of allUsersNow) {
        usernameToId.set(u.username.toLowerCase(), u.id);
      }
      const resolveUserId = (devId: number | null): number | null => {
        if (devId === null) return null;
        const username = DEV_USERID_TO_USERNAME[devId];
        if (!username) return null;
        return usernameToId.get(username.toLowerCase()) ?? null;
      };

      // ----------------------------------------------------------------
      // 4. Site work assignments. Insert any (vendor_id, site_location_id,
      //    work_type_id) combo that doesn't already have a row. We don't
      //    preserve dev IDs here — the FK from tickets references swa
      //    semantically (vendor + site + work_type), not by id.
      // ----------------------------------------------------------------
      let swaInserted = 0;
      let swaSkipped = 0;
      for (const swa of DEMO_SWA_ROWS) {
        const r = await tx.execute(sql`
          INSERT INTO site_work_assignments (site_location_id, work_type_id, vendor_id, afe)
          SELECT ${swa.site_location_id}, ${swa.work_type_id}, ${swa.vendor_id}, ${swa.afe}
          WHERE NOT EXISTS (
            SELECT 1 FROM site_work_assignments
            WHERE site_location_id = ${swa.site_location_id}
              AND work_type_id = ${swa.work_type_id}
              AND vendor_id = ${swa.vendor_id}
          )
        `);
        if (r.rowCount && r.rowCount > 0) swaInserted++;
        else swaSkipped++;
      }

      // ----------------------------------------------------------------
      // 5. Tickets. Each ticket is matched against prod by the natural
      //    key (vendor_id, site_location_id, work_type_id, description,
      //    scheduled_start_at). If found, we map and skip; if not, we
      //    insert with a fresh auto-id and remember dev_id -> prod_id
      //    so child rows can be retargeted.
      // ----------------------------------------------------------------
      const ticketIdMap = new Map<number, number>(); // dev_id -> prod_id
      let ticketsInserted = 0;
      let ticketsSkipped = 0;
      for (const t of DEMO_TICKETS) {
        const existing = await tx.execute(sql`
          SELECT id FROM tickets
          WHERE vendor_id = ${t.vendor_id}
            AND site_location_id = ${t.site_location_id}
            AND work_type_id = ${t.work_type_id}
            AND description = ${t.description}
            AND scheduled_start_at = ${t.scheduled_start_at}
          LIMIT 1
        `);
        if (existing.rows.length > 0) {
          ticketIdMap.set(t._dev_id, (existing.rows[0] as { id: number }).id);
          ticketsSkipped++;
          continue;
        }
        const ins = await tx.execute(sql`
          INSERT INTO tickets (
            site_location_id, vendor_id, field_employee_id, work_type_id, status,
            description, notes, kickback_reason,
            check_in_time, check_out_time,
            check_in_latitude, check_in_longitude,
            check_out_latitude, check_out_longitude,
            created_at, updated_at,
            unlocked_at, unlocked_by_id, unlock_count,
            lifecycle_state, en_route_at, arrived_at,
            departure_latitude, departure_longitude,
            created_by_id, closed_by_id,
            pre_cancel_status, cancelled_at, cancelled_by_id,
            scheduled_start_at, scheduled_duration_minutes,
            foreman_user_id, scheduled_at, scheduled_by_id,
            late_check_in_reminder_sent_at, approved_at,
            intake_channel,
            payment_method, payment_reference, payment_dispersed_at,
            payment_dispersed_by_id, payment_note
          ) VALUES (
            ${t.site_location_id}, ${t.vendor_id}, ${t.field_employee_id}, ${t.work_type_id}, ${t.status},
            ${t.description}, ${t.notes}, ${t.kickback_reason},
            ${t.check_in_time}, ${t.check_out_time},
            ${t.check_in_latitude}, ${t.check_in_longitude},
            ${t.check_out_latitude}, ${t.check_out_longitude},
            ${t.created_at}, ${t.updated_at},
            ${t.unlocked_at}, ${resolveUserId(t.unlocked_by_id)}, ${t.unlock_count},
            ${t.lifecycle_state}, ${t.en_route_at}, ${t.arrived_at},
            ${t.departure_latitude}, ${t.departure_longitude},
            ${resolveUserId(t.created_by_id)}, ${resolveUserId(t.closed_by_id)},
            ${t.pre_cancel_status}, ${t.cancelled_at}, ${resolveUserId(t.cancelled_by_id)},
            ${t.scheduled_start_at}, ${t.scheduled_duration_minutes},
            ${resolveUserId(t.foreman_user_id)}, ${t.scheduled_at}, ${resolveUserId(t.scheduled_by_id)},
            ${t.late_check_in_reminder_sent_at}, ${t.approved_at},
            ${t.intake_channel},
            ${t.payment_method}, ${t.payment_reference}, ${t.payment_dispersed_at},
            ${resolveUserId(t.payment_dispersed_by_id)}, ${t.payment_note}
          ) RETURNING id
        `);
        const newId = (ins.rows[0] as { id: number }).id;
        ticketIdMap.set(t._dev_id, newId);
        ticketsInserted++;
      }

      // ----------------------------------------------------------------
      // 6. ticket_status_history. Skip rows whose ticket was skipped
      //    (already had history). For inserted tickets, write fresh
      //    history rows so the timeline matches dev.
      // ----------------------------------------------------------------
      let historyInserted = 0;
      let historySkipped = 0;
      const insertedTicketProdIds = new Set<number>();
      for (const t of DEMO_TICKETS) {
        const prodId = ticketIdMap.get(t._dev_id);
        if (prodId !== undefined) insertedTicketProdIds.add(prodId);
      }
      for (const h of DEMO_STATUS_HISTORY) {
        const prodTicketId = ticketIdMap.get(h.ticket_id);
        if (prodTicketId === undefined) {
          historySkipped++;
          continue;
        }
        // Skip if there is already any history for this ticket — likely
        // a re-run after the first call already wrote them.
        const already = await tx.execute(sql`
          SELECT 1 FROM ticket_status_history
          WHERE ticket_id = ${prodTicketId}
            AND to_status = ${h.to_status}
            AND created_at = ${h.created_at}
          LIMIT 1
        `);
        if (already.rows.length > 0) {
          historySkipped++;
          continue;
        }
        await tx.execute(sql`
          INSERT INTO ticket_status_history
            (ticket_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
          VALUES
            (${prodTicketId}, ${h.from_status}, ${h.to_status},
             ${resolveUserId(h.actor_user_id)}, ${h.actor_role}, ${h.reason}, ${h.created_at})
        `);
        historyInserted++;
      }

      // ----------------------------------------------------------------
      // 7. ticket_check_ins. employee_id references vendor_people, which
      //    has stable IDs across envs.
      // ----------------------------------------------------------------
      let checkInsInserted = 0;
      let checkInsSkipped = 0;
      for (const c of DEMO_CHECK_INS) {
        const prodTicketId = ticketIdMap.get(c.ticket_id);
        if (prodTicketId === undefined) {
          checkInsSkipped++;
          continue;
        }
        const already = await tx.execute(sql`
          SELECT 1 FROM ticket_check_ins
          WHERE ticket_id = ${prodTicketId}
            AND employee_id = ${c.employee_id}
            AND check_in_at = ${c.check_in_at}
          LIMIT 1
        `);
        if (already.rows.length > 0) {
          checkInsSkipped++;
          continue;
        }
        await tx.execute(sql`
          INSERT INTO ticket_check_ins (
            ticket_id, employee_id, check_in_at,
            check_in_latitude, check_in_longitude,
            check_out_at, check_out_latitude, check_out_longitude,
            hourly_rate_at_time, source, corrected_by_id, corrected_reason, created_at
          ) VALUES (
            ${prodTicketId}, ${c.employee_id}, ${c.check_in_at},
            ${c.check_in_latitude}, ${c.check_in_longitude},
            ${c.check_out_at}, ${c.check_out_latitude}, ${c.check_out_longitude},
            ${c.hourly_rate_at_time}, ${c.source},
            ${resolveUserId(c.corrected_by_id)}, ${c.corrected_reason}, ${c.created_at}
          )
        `);
        checkInsInserted++;
      }

      // ----------------------------------------------------------------
      // 8. gps_logs.
      // ----------------------------------------------------------------
      let gpsInserted = 0;
      let gpsSkipped = 0;
      for (const g of DEMO_GPS_LOGS) {
        const prodTicketId = ticketIdMap.get(g.ticket_id);
        if (prodTicketId === undefined) {
          gpsSkipped++;
          continue;
        }
        const already = await tx.execute(sql`
          SELECT 1 FROM gps_logs
          WHERE ticket_id = ${prodTicketId}
            AND event_type = ${g.event_type}
            AND recorded_at = ${g.recorded_at}
          LIMIT 1
        `);
        if (already.rows.length > 0) {
          gpsSkipped++;
          continue;
        }
        await tx.execute(sql`
          INSERT INTO gps_logs (
            ticket_id, latitude, longitude, event_type, recorded_at,
            battery_level, speed_mps
          ) VALUES (
            ${prodTicketId}, ${g.latitude}, ${g.longitude}, ${g.event_type}, ${g.recorded_at},
            ${g.battery_level}, ${g.speed_mps}
          )
        `);
        gpsInserted++;
      }

      return {
        usersAdded,
        passwordsRecovered,
        fieldUsersCreated,
        fieldUsersPasswordReset,
        danielVendorPeopleClaimed,
        swaInserted,
        swaSkipped,
        ticketsInserted,
        ticketsSkipped,
        historyInserted,
        historySkipped,
        checkInsInserted,
        checkInsSkipped,
        gpsInserted,
        gpsSkipped,
      };
    });

    logger.info({ result }, "demo-prod-seed: completed");
    return res.json({ message: "ok", ...result });
  } catch (err) {
    logger.error({ err }, "demo-prod-seed: failed");
    return res
      .status(500)
      .json({ message: "demo prod seed failed", error: String(err) });
  }
});

export default router;
