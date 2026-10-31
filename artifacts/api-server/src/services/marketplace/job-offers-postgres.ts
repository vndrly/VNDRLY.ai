import { and, desc, eq, inArray, isNull, lt, gt, lte, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  vendorsTable,
  vendorPartnerBillingSettingsTable,
} from "@workspace/db/schema";
import { commercialBillingMode } from "../../lib/ticket-commercial-rate";
import {
  jobOffersTable as offers,
  jobOfferAcceptanceSnapshotsTable as snapshots,
  vendorCapabilitiesTable as capabilities,
  vendorPartnerServiceOffersTable as rates,
  partnerVendorRelationshipsTable as relationships,
  usersTable as users,
  userOrgMembershipsTable as memberships,
  ticketsTable as tickets,
} from "@workspace/db/schema";
import {
  createPostgresPartnerMarketplaceStore,
  discoverPartnerMarketplaceVendors,
} from "./partner-store";
import { MarketplaceError } from "./vendor-store";
import { createTicketWithHistory } from "../../lib/create-ticket";
import { logger } from "../../lib/logger";
import type { JobOfferPersistence, JobOfferTransaction } from "./job-offers";
import { peakReservedCrews } from "./crew-capacity";
import { isMarketplaceRelationshipRestricted } from "./eligibility";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
function adapter(tx: Transaction): JobOfferTransaction {
  return {
    async authorize(session, side, orgId) {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, session.userId!));
      if (!user || user.suspendedAt || user.sessionVersion !== session.sv)
        return false;
      if (session.role === "admin") return user.role === "admin";
      const [member] = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, session.activeMembershipId!),
            eq(memberships.userId, user.id),
            eq(memberships.orgType, side),
            side === "partner"
              ? eq(memberships.partnerId, orgId)
              : eq(memberships.vendorId, orgId),
            side === "partner"
              ? isNull(memberships.vendorId)
              : isNull(memberships.partnerId),
            inArray(
              memberships.role,
              side === "partner" ? ["admin", "member"] : ["admin"],
            ),
          ),
        );
      return !!member && user.activeMembershipId === member.id;
    },
    async findByKey(partnerId, key) {
      // Serializes concurrent first writes; the unique index is the final backstop.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`job-offer-create:${partnerId}:${key}`}, 0))`,
      );
      return (
        (
          await tx
            .select()
            .from(offers)
            .where(
              and(
                eq(offers.partnerId, partnerId),
                eq(offers.idempotencyKey, key),
              ),
            )
            .for("update")
        )[0] ?? null
      );
    },
    async get(id) {
      return (
        (
          await tx.select().from(offers).where(eq(offers.id, id)).for("update")
        )[0] ?? null
      );
    },
    async list(side, id) {
      return tx
        .select()
        .from(offers)
        .where(eq(side === "partner" ? offers.partnerId : offers.vendorId, id))
        .orderBy(desc(offers.id))
        .limit(100);
    },
    async validate(input, now) {
      // Share locks make address invalidation and explicit relationship
      // revocation linearize before or after the entire acceptance transaction.
      await tx.select({ id: vendorsTable.id }).from(vendorsTable)
        .where(eq(vendorsTable.id, input.vendorId)).for("share");
      const [relationship] = await tx.select({ status: relationships.status }).from(relationships)
        .where(and(eq(relationships.partnerId, input.partnerId), eq(relationships.vendorId, input.vendorId))).for("share");
      if (isMarketplaceRelationshipRestricted(relationship?.status))
        throw new MarketplaceError(409, "marketplace.relationship_restricted");
      // Shared capability lock also serializes overlapping acceptances across distinct offers.
      const [capability] = await tx
        .select()
        .from(capabilities)
        .where(eq(capabilities.id, input.vendorCapabilityId))
        .for("update");
      if (!capability?.active || capability.vendorId !== input.vendorId)
        throw new MarketplaceError(409, "marketplace.capability_inactive");
      const store = createPostgresPartnerMarketplaceStore(tx);
      const context = await store.loadContext(
        input.partnerId,
        input.workTypeId,
        input.siteLocationId,
      );
      if (!context)
        throw new MarketplaceError(
          404,
          "marketplace.work_type_or_site_not_found",
        );
      if (!context.demandMapping || !context.canonicalServiceActive)
        throw new MarketplaceError(409, "marketplace.active_match_required");
      const candidateRows = await store.listCandidates(context, now);
      const candidates = await discoverPartnerMarketplaceVendors(
        { ...store, listCandidates: async () => candidateRows },
        context,
        { requestedCapacity: input.crewCount },
        now,
      );
      const candidate = candidates.find(
        (row) =>
          row.vendorId === input.vendorId &&
          row.capabilityId === input.vendorCapabilityId &&
          row.offer?.id === input.vendorPartnerServiceOfferId,
      );
      if (!candidate)
        throw new MarketplaceError(409, "marketplace.active_match_required");
      if (!candidate.eligibility.eligible)
        throw new MarketplaceError(
          409,
          `marketplace.${candidate.eligibility.reasonCodes[0].toLowerCase()}`,
        );
      const [rate] = await tx
        .select()
        .from(rates)
        .where(eq(rates.id, input.vendorPartnerServiceOfferId));
      const raw = candidateRows.find(
        (row) =>
          row.offer?.id === input.vendorPartnerServiceOfferId &&
          row.vendorId === input.vendorId,
      );
      if (!rate || !raw)
        throw new MarketplaceError(409, "marketplace.ineligible");
      const [vendor] = await tx
        .select()
        .from(vendorsTable)
        .where(eq(vendorsTable.id, input.vendorId));
      const [billing] = await tx
        .select()
        .from(vendorPartnerBillingSettingsTable)
        .where(
          and(
            eq(vendorPartnerBillingSettingsTable.vendorId, input.vendorId),
            eq(vendorPartnerBillingSettingsTable.partnerId, input.partnerId),
          ),
        );
      const billingRules = {
        dailyOtHours: vendor?.dailyOtHours ?? "8",
        weeklyOtHours: vendor?.weeklyOtHours ?? "40",
        overtimeMultiplier: billing?.overtimeMultiplier ?? "1.5",
      };
      // Capacity belongs to the accepted job window, not the first shift's status.
      // Approving one ticket must not release crews still committed to later shifts.
      const reservations = await tx
        .select({
          crews: offers.crewCount,
          start: offers.scheduledStartAt,
          end: offers.scheduledEndAt,
        })
        .from(offers)
        .where(
          and(
            eq(offers.vendorCapabilityId, input.vendorCapabilityId),
            eq(offers.status, "accepted"),
            lt(offers.scheduledStartAt, new Date(input.requestedEndAt)),
            gt(offers.scheduledEndAt, new Date(input.requestedStartAt)),
          ),
        );
      if (
        peakReservedCrews(
          new Date(input.requestedStartAt),
          new Date(input.requestedEndAt),
          reservations,
        ) +
          input.crewCount >
        candidate.eligibility.facts.availableCapacity
      )
        throw new MarketplaceError(409, "marketplace.capacity_changed");
      return {
        canonicalServiceId: candidate.canonicalServiceId,
        commercial: {
          rateId: rate.id,
          rateVersion: rate.version,
          unitPrice: rate.unitPrice,
          unit: rate.unit,
          currency: rate.currency,
          rateComponents: rate.rateComponents,
          billingRules,
          automaticBilling: commercialBillingMode(rate),
          commercialConditions: rate.commercialConditions,
          notes: rate.notes,
          demandMappingId: context.demandMapping!.id,
          capabilityMappingId: raw.capabilityMapping.id,
        },
        coverage: {
          site: context.site,
          serviceAreas: JSON.parse(JSON.stringify(raw.serviceAreas)),
          ...candidate.eligibility.facts,
        },
        eligibility: {
          eligible: true,
          reasonCodes: [],
          facts: candidate.eligibility.facts,
          checkedAt: now.toISOString(),
        },
      };
    },
    async insert(data) {
      return (await tx.insert(offers).values(data).returning())[0];
    },
    async update(id, data) {
      return (
        await tx.update(offers).set(data).where(eq(offers.id, id)).returning()
      )[0];
    },
    async snapshot(data) {
      await tx.insert(snapshots).values(data);
    },
    async acceptedVersion(id) {
      return (
        (
          await tx
            .select({ version: snapshots.offerVersion })
            .from(snapshots)
            .where(eq(snapshots.jobOfferId, id))
        )[0]?.version ?? null
      );
    },
    async engage(offer, now) {
      // Marketplace engagement does not fabricate blanket catalog/EULA approval.
      await tx
        .insert(relationships)
        .values({
          partnerId: offer.partnerId,
          vendorId: offer.vendorId,
          status: "pending_review",
          lastStatusReason: "marketplace_engagement",
          lastStatusChangeAt: now,
        })
        .onConflictDoUpdate({
          target: [relationships.partnerId, relationships.vendorId],
          set: {
            updatedAt: now,
            lastStatusReason: "marketplace_engagement",
            lastStatusChangeAt: now,
          },
        });
    },
    async createTicket(offer, session) {
      const ticket = await createTicketWithHistory(
        tx,
        {
          siteLocationId: offer.siteLocationId,
          vendorId: offer.vendorId,
          workTypeId: offer.workTypeId,
          canonicalServiceId: offer.canonicalServiceId,
          vendorCapabilityId: offer.vendorCapabilityId,
          vendorPartnerServiceOfferId: offer.vendorPartnerServiceOfferId,
          jobOfferId: offer.id,
          engagementJobOfferId: offer.id,
          status: "initiated",
          intakeChannel: "partner_self_service",
          description: offer.scope,
          createdById: offer.createdById,
          scheduledStartAt: offer.scheduledStartAt,
          scheduledDurationMinutes: Math.ceil(
            (offer.scheduledEndAt!.getTime() -
              offer.scheduledStartAt!.getTime()) /
              60000,
          ),
        },
        {
          userId: session.userId!,
          role: session.role ?? null,
          reason: `marketplace_offer_accepted:${offer.id}`,
        },
      );
      return ticket.id;
    },
    async createJobTicket(offer, session, period, key) {
      // The job row is already locked. Only a real accepted snapshot authorizes a new shift.
      const [snapshot] = await tx.select().from(snapshots).where(eq(snapshots.jobOfferId, offer.id));
      if (!snapshot || typeof snapshot.scopeSnapshot.afeCode !== "string" || !snapshot.scopeSnapshot.afeCode.trim())
        throw new MarketplaceError(409, "marketplace.afe_required");
      const [relationship] = await tx.select({ status: relationships.status }).from(relationships)
        .where(and(eq(relationships.partnerId, offer.partnerId), eq(relationships.vendorId, offer.vendorId))).for("share");
      if (isMarketplaceRelationshipRestricted(relationship?.status))
        throw new MarketplaceError(409, "marketplace.relationship_restricted");
      const start = new Date(period.requestedStartAt);
      const duration = Math.ceil((Date.parse(period.requestedEndAt) - start.getTime()) / 60000);
      const [prior] = await tx.select().from(tickets).where(and(
        eq(tickets.engagementJobOfferId, offer.id), eq(tickets.engagementTicketKey, key),
      ));
      if (prior) {
        if (prior.scheduledStartAt?.getTime() !== start.getTime() || prior.scheduledDurationMinutes !== duration)
          throw new MarketplaceError(409, "marketplace.idempotency_conflict");
        return { ticketId: prior.id, replayed: true };
      }
      const ticket = await createTicketWithHistory(tx, {
        siteLocationId: offer.siteLocationId,
        vendorId: offer.vendorId,
        workTypeId: offer.workTypeId,
        canonicalServiceId: offer.canonicalServiceId,
        vendorCapabilityId: offer.vendorCapabilityId,
        vendorPartnerServiceOfferId: offer.vendorPartnerServiceOfferId,
        engagementJobOfferId: offer.id,
        engagementTicketKey: key,
        status: "initiated",
        intakeChannel: "partner_self_service",
        description: offer.scope,
        createdById: session.userId!,
        scheduledStartAt: start,
        scheduledDurationMinutes: duration,
      }, {
        userId: session.userId!, role: session.role ?? null,
        reason: `accepted_job_ticket:${offer.id}`,
      });
      return { ticketId: ticket.id, replayed: false };
    },
    async listJobTickets(offer) {
      return tx.select({ id: tickets.id, status: tickets.status,
        scheduledStartAt: tickets.scheduledStartAt, scheduledDurationMinutes: tickets.scheduledDurationMinutes,
      }).from(tickets).where(and(
        or(eq(tickets.engagementJobOfferId, offer.id), eq(tickets.jobOfferId, offer.id)),
        eq(tickets.vendorId, offer.vendorId), eq(tickets.siteLocationId, offer.siteLocationId), eq(tickets.workTypeId, offer.workTypeId),
      )).orderBy(desc(tickets.id));
    },
    async expire(now) {
      const rows = await tx
        .update(offers)
        .set({
          status: "expired",
          expiredAt: now,
          updatedAt: now,
          version: sql`${offers.version} + 1`,
        })
        .where(
          and(
            inArray(offers.status, ["offered", "vendor_reviewing"]),
            lte(offers.expiresAt, now),
          ),
        )
        .returning({ id: offers.id });
      return rows.length;
    },
  };
}

export function createPostgresJobOfferPersistence(
  connection = db,
): JobOfferPersistence {
  return {
    async transaction(run) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await connection.transaction((tx) => run(adapter(tx)), {
            isolationLevel: "serializable",
          });
        } catch (error) {
          const pgError = error as { code?: string; cause?: { code?: string } };
          const code = pgError.code ?? pgError.cause?.code;
          if (attempt < 3 && ["40001", "40P01", "23505"].includes(code ?? ""))
            continue;
          if (code === "23505")
            throw new MarketplaceError(409, "marketplace.idempotency_conflict");
          if (code === "40001" || code === "40P01")
            throw new MarketplaceError(409, "marketplace.retry_required");
          throw error;
        }
      }
    },
    async afterCommit(offer) {
      logger.info(
        {
          offerId: offer.id,
          status: offer.status,
          ticketId: offer.createdTicketId,
          actorUserId: offer.acceptedById ?? offer.sentById,
        },
        "Marketplace job offer committed",
      );
      try {
        const { findVendorUserIds, findPartnerUserIds, notifyUsers } =
          await import("../../routes/notifications");
        const ids =
          offer.status === "accepted"
            ? await findPartnerUserIds(offer.partnerId)
            : await findVendorUserIds(offer.vendorId);
        await notifyUsers(ids, {
          type: "marketplace_job_offer",
          title:
            offer.status === "accepted"
              ? "Job offer accepted"
              : "New job offer",
          body:
            offer.status === "accepted"
              ? `Job offer #${offer.id} created tracking #${offer.createdTicketId}.`
              : `Review job offer #${offer.id} before it expires.`,
          link: offer.createdTicketId
            ? `/tickets/${offer.createdTicketId}`
            : "/vendor-catalog",
        });
      } catch (error) {
        logger.warn(
          { err: error, offerId: offer.id },
          "Committed job offer notification failed",
        );
      }
    },
  };
}
