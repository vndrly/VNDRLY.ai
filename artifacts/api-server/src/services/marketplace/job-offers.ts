import { createHash } from "node:crypto";
import { z } from "zod";
import type { JobOffer } from "@workspace/db/schema";
import type { SessionPayload } from "../../lib/session";
import { MarketplaceError } from "./vendor-store";
import { commercialBillingMode } from "../../lib/ticket-commercial-rate";

const id = z.number().int().positive();
/** Matches the Task 7 composer contract. No prices, authority or eligibility facts are accepted. */
export const createJobOfferInput = z
  .object({
    partnerId: id,
    workTypeId: id,
    vendorId: id,
    vendorCapabilityId: id,
    vendorPartnerServiceOfferId: id,
    siteLocationId: id,
    scope: z.string().trim().min(1).max(10000),
    requestedStartAt: z.string().datetime({ offset: true }),
    requestedEndAt: z.string().datetime({ offset: true }),
    crewCount: id.max(100000),
    afeCode: z.string().trim().min(1, "The partner must assign an AFE to this job").max(200),
    poNumber: z.string().trim().max(200).optional(),
    attachmentUrls: z
      .array(
        z
          .string()
          .url()
          .max(2048)
          .refine((value) => new URL(value).protocol === "https:"),
      )
      .max(20),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.requestedEndAt) > Date.parse(value.requestedStartAt) &&
      Date.parse(value.expiresAt) <= Date.parse(value.requestedStartAt),
    { message: "Offer expiry and schedule are out of order" },
  );
export type CreateJobOfferInput = z.infer<typeof createJobOfferInput>;
export const createJobTicketInput = z.object({
  requestedStartAt: z.string().datetime({ offset: true }),
  requestedEndAt: z.string().datetime({ offset: true }),
}).strict().refine((value) => Date.parse(value.requestedEndAt) > Date.parse(value.requestedStartAt) &&
  (Date.parse(value.requestedEndAt) - Date.parse(value.requestedStartAt)) % 60000 === 0, {
  message: "Ticket end must follow its start by a whole number of minutes",
});
export type CreateJobTicketInput = z.infer<typeof createJobTicketInput>;
export interface JobOfferActionInput {
  offerId: number;
  version: number;
  session: SessionPayload;
}
export interface AcceptJobOfferInput extends JobOfferActionInput {
  idempotencyKey: string;
}
type OfferInsert =
  typeof import("@workspace/db/schema").jobOffersTable.$inferInsert;
type SnapshotInsert =
  typeof import("@workspace/db/schema").jobOfferAcceptanceSnapshotsTable.$inferInsert;
export interface ValidatedOfferFacts {
  canonicalServiceId: number;
  commercial: Record<string, unknown>;
  coverage: Record<string, unknown>;
  eligibility: Record<string, unknown>;
}
export interface JobOfferTransaction {
  authorize(
    session: SessionPayload,
    side: "partner" | "vendor",
    orgId: number,
  ): Promise<boolean>;
  findByKey(partnerId: number, key: string): Promise<JobOffer | null>;
  get(id: number): Promise<JobOffer | null>;
  list(side: "partner" | "vendor", id: number): Promise<JobOffer[]>;
  validate(input: CreateJobOfferInput, now: Date): Promise<ValidatedOfferFacts>;
  insert(data: OfferInsert): Promise<JobOffer>;
  update(id: number, data: Partial<OfferInsert>): Promise<JobOffer>;
  snapshot(data: SnapshotInsert): Promise<void>;
  acceptedVersion(id: number): Promise<number | null>;
  engage(offer: JobOffer, now: Date): Promise<void>;
  createTicket(offer: JobOffer, session: SessionPayload): Promise<number>;
  createJobTicket(offer: JobOffer, session: SessionPayload, period: CreateJobTicketInput, key: string): Promise<{ ticketId: number; replayed: boolean }>;
  listJobTickets(offer: JobOffer): Promise<{ id: number; status: string; scheduledStartAt: Date | null; scheduledDurationMinutes: number | null }[]>;
  expire(now: Date): Promise<number>;
}
export interface JobOfferPersistence {
  transaction<T>(run: (tx: JobOfferTransaction) => Promise<T>): Promise<T>;
  afterCommit?(offer: JobOffer): Promise<void>;
}
const fail = (code: string, status = 409): never => {
  throw new MarketplaceError(status, `marketplace.${code}`);
};
const operationKey = (key: string) =>
  z.string().trim().min(1).max(200).parse(key);
// jsonb does not preserve object key order; comparisons must be canonical.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const fingerprint = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const fromOffer = (row: JobOffer): CreateJobOfferInput => ({
  partnerId: row.partnerId,
  vendorId: row.vendorId,
  workTypeId: row.workTypeId,
  vendorCapabilityId: row.vendorCapabilityId,
  vendorPartnerServiceOfferId: row.vendorPartnerServiceOfferId,
  siteLocationId: row.siteLocationId,
  scope: row.scope,
  requestedStartAt: row.scheduledStartAt!.toISOString(),
  requestedEndAt: row.scheduledEndAt!.toISOString(),
  crewCount: row.crewCount,
  attachmentUrls: (row.attachments ?? []) as string[],
  expiresAt: row.expiresAt!.toISOString(),
  afeCode: row.afeReference ?? "",
  ...(row.poReference ? { poNumber: row.poReference } : {}),
});

/** Authorization is checked inside the transaction, including replay/readback. */
export async function requireJobOfferAuthority(
  tx: JobOfferTransaction,
  session: SessionPayload,
  side: "partner" | "vendor",
  orgId: number,
) {
  const scoped =
    session?.role === "admin" ||
    (session?.role === side &&
      session[side === "partner" ? "partnerId" : "vendorId"] === orgId &&
      session[side === "partner" ? "vendorId" : "partnerId"] == null &&
      Number.isSafeInteger(session.activeMembershipId) &&
      (session.activeMembershipId ?? 0) > 0 &&
      (side === "partner"
        ? ["admin", "member"].includes(session.membershipRole ?? "")
        : session.membershipRole === "admin"));
  if (
    !scoped ||
    session.publicDemo ||
    !Number.isSafeInteger(session.userId) ||
    (session.userId ?? 0) <= 0 ||
    !(await tx.authorize(session, side, orgId))
  )
    fail(`${side}_scope_required`, 403);
}

export function createJobOfferService(
  storage: JobOfferPersistence,
  clock = () => new Date(),
) {
  const notify = async (offer: JobOffer) => {
    await storage.afterCommit?.(offer);
    return offer;
  };
  const load = async (
    tx: JobOfferTransaction,
    input: JobOfferActionInput,
    side: "partner" | "vendor",
  ) => {
    id.parse(input.offerId);
    id.parse(input.version);
    const offer = await tx.get(input.offerId);
    if (!offer) return fail("offer_not_found", 404);
    await requireJobOfferAuthority(
      tx,
      input.session,
      side,
      offer[side === "partner" ? "partnerId" : "vendorId"],
    );
    return offer;
  };
  const version = (offer: JobOffer, expected: number) => {
    if (offer.version !== expected) fail("stale_offer");
  };
  const open = (offer: JobOffer, now: Date) => {
    if (!["offered", "vendor_reviewing"].includes(offer.status))
      fail("offer_not_open");
    if (!offer.expiresAt || offer.expiresAt <= now) fail("offer_expired");
  };
  const validate = async (
    tx: JobOfferTransaction,
    offer: JobOffer,
    now: Date,
  ) => {
    if (!offer.afeReference?.trim()) fail("afe_required");
    const facts = await tx.validate(fromOffer(offer), now);
    const { requestFingerprint: _request, ...frozen } =
      offer.commercialSnapshot;
    if (
      offer.canonicalServiceId !== facts.canonicalServiceId ||
      fingerprint(frozen) !== fingerprint(facts.commercial)
    )
      fail("terms_changed");
    return facts;
  };
  const transition = (
    input: JobOfferActionInput,
    side: "partner" | "vendor",
    target: "withdrawn" | "declined" | "vendor_reviewing",
  ) =>
    storage.transaction(async (tx) => {
      const offer = await load(tx, input, side);
      version(offer, input.version);
      const now = clock();
      if (target === "withdrawn" && offer.status === "draft") {
        /* Drafts can be withdrawn. */
      } else open(offer, now);
      return tx.update(offer.id, {
        status: target,
        version: offer.version + 1,
        updatedAt: now,
        ...(target === "declined"
          ? { declinedAt: now, declinedById: input.session.userId }
          : {}),
        ...(target === "withdrawn"
          ? { withdrawnAt: now, withdrawnById: input.session.userId }
          : {}),
      });
    });
  return {
    async createJobOffer(
      raw: CreateJobOfferInput,
      session: SessionPayload,
      key: string,
    ) {
      const input = createJobOfferInput.parse(raw);
      const idempotencyKey = operationKey(key);
      const requestFingerprint = fingerprint(input);
      return storage.transaction(async (tx) => {
        await requireJobOfferAuthority(tx, session, "partner", input.partnerId);
        const prior = await tx.findByKey(input.partnerId, idempotencyKey);
        if (prior) {
          if (
            prior.commercialSnapshot.requestFingerprint !== requestFingerprint
          )
            fail("idempotency_conflict");
          return prior;
        }
        const now = clock();
        if (new Date(input.expiresAt) <= now) fail("offer_expired");
        const facts = await tx.validate(input, now);
        return tx.insert({
          partnerId: input.partnerId,
          vendorId: input.vendorId,
          workTypeId: input.workTypeId,
          siteLocationId: input.siteLocationId,
          canonicalServiceId: facts.canonicalServiceId,
          vendorCapabilityId: input.vendorCapabilityId,
          vendorPartnerServiceOfferId: input.vendorPartnerServiceOfferId,
          commercialSnapshot: { ...facts.commercial, requestFingerprint },
          scheduledStartAt: new Date(input.requestedStartAt),
          scheduledEndAt: new Date(input.requestedEndAt),
          crewCount: input.crewCount,
          scope: input.scope,
          attachments: input.attachmentUrls,
          afeReference: input.afeCode,
          poReference: input.poNumber,
          expiresAt: new Date(input.expiresAt),
          status: "draft",
          version: 1,
          idempotencyKey,
          createdById: session.userId!,
          createdAt: now,
          updatedAt: now,
        });
      });
    },
    async sendJobOffer(input: JobOfferActionInput) {
      return notify(
        await storage.transaction(async (tx) => {
          const offer = await load(tx, input, "partner");
          version(offer, input.version);
          if (offer.status !== "draft") fail("offer_not_draft");
          const now = clock();
          if (!offer.expiresAt || offer.expiresAt <= now) fail("offer_expired");
          await validate(tx, offer, now);
          return tx.update(offer.id, {
            status: "offered",
            version: offer.version + 1,
            sentAt: now,
            sentById: input.session.userId,
            updatedAt: now,
          });
        }),
      );
    },
    reviewJobOffer: (input: JobOfferActionInput) =>
      transition(input, "vendor", "vendor_reviewing"),
    withdrawJobOffer: (input: JobOfferActionInput) =>
      transition(input, "partner", "withdrawn"),
    declineJobOffer: (input: JobOfferActionInput) =>
      transition(input, "vendor", "declined"),
    async acceptJobOffer(input: AcceptJobOfferInput): Promise<{
      offerId: number;
      ticketId: number;
      replayed: boolean;
      automaticBilling?: "hourly_usd" | "manual_billing_required";
    }> {
      const idempotencyKey = operationKey(input.idempotencyKey);
      const outcome = await storage.transaction(async (tx) => {
        const offer = await load(tx, input, "vendor");
        if (offer.status === "accepted" && offer.createdTicketId) {
          if ((await tx.acceptedVersion(offer.id)) !== input.version)
            fail("stale_offer");
          return {
            offer,
            result: {
              offerId: offer.id,
              ticketId: offer.createdTicketId,
              replayed: true,
            },
          };
        }
        version(offer, input.version);
        const now = clock();
        open(offer, now);
        const facts = await validate(tx, offer, now);
        await tx.snapshot({
          jobOfferId: offer.id,
          offerVersion: offer.version,
          idempotencyKey,
          acceptedById: input.session.userId!,
          commercialSnapshot: facts.commercial,
          scopeSnapshot: fromOffer(offer),
          coverageSnapshot: facts.coverage,
          eligibilitySnapshot: facts.eligibility,
        });
        await tx.engage(offer, now);
        const ticketId = await tx.createTicket(offer, input.session);
        const accepted = await tx.update(offer.id, {
          status: "accepted",
          version: offer.version + 1,
          createdTicketId: ticketId,
          acceptedAt: now,
          acceptedById: input.session.userId,
          updatedAt: now,
        });
        return {
          offer: accepted,
          result: { offerId: offer.id, ticketId, replayed: false },
        };
      });
      if (!outcome.result.replayed) await notify(outcome.offer);
      return {
        ...outcome.result,
        automaticBilling: commercialBillingMode(
          outcome.offer.commercialSnapshot,
        ),
      };
    },
    expireJobOffers: () => storage.transaction((tx) => tx.expire(clock())),
    createJobTicket: (offerId: number, raw: CreateJobTicketInput, session: SessionPayload, key: string) =>
      storage.transaction(async (tx) => {
        const period = createJobTicketInput.parse(raw);
        const offer = await tx.get(id.parse(offerId));
        if (!offer) return fail("offer_not_found", 404);
        const side = session.role === "vendor" ? "vendor" : "partner";
        await requireJobOfferAuthority(tx, session, side, side === "vendor" ? offer.vendorId : offer.partnerId);
        if (offer.status !== "accepted" || !(await tx.acceptedVersion(offer.id))) fail("accepted_job_required");
        if (!offer.afeReference?.trim()) fail("afe_required");
        if (!offer.scheduledStartAt || !offer.scheduledEndAt ||
            Date.parse(period.requestedStartAt) < offer.scheduledStartAt.getTime() ||
            Date.parse(period.requestedEndAt) > offer.scheduledEndAt.getTime()) fail("ticket_outside_job_schedule");
        return tx.createJobTicket(offer, session, period, operationKey(key));
      }),
    listJobTickets: (offerId: number, session: SessionPayload) => storage.transaction(async (tx) => {
      const offer = await tx.get(id.parse(offerId));
      if (!offer) return fail("offer_not_found", 404);
      const side = session.role === "vendor" ? "vendor" : "partner";
      await requireJobOfferAuthority(tx, session, side, side === "vendor" ? offer.vendorId : offer.partnerId);
      if (offer.status !== "accepted") fail("accepted_job_required");
      return tx.listJobTickets(offer);
    }),
    getJobOffer: (offerId: number, session: SessionPayload) =>
      storage.transaction(async (tx) => {
        const offer = await tx.get(id.parse(offerId));
        if (!offer) return fail("offer_not_found", 404);
        const side = session.role === "vendor" ? "vendor" : "partner";
        await requireJobOfferAuthority(
          tx,
          session,
          side,
          offer[side === "partner" ? "partnerId" : "vendorId"],
        );
        if (side === "vendor" && !offer.sentAt)
          return fail("offer_not_found", 404);
        return offer;
      }),
    listJobOffers: (
      side: "partner" | "vendor",
      orgId: number,
      session: SessionPayload,
    ) =>
      storage.transaction(async (tx) => {
        await requireJobOfferAuthority(tx, session, side, id.parse(orgId));
        return (await tx.list(side, orgId)).filter(
          (row) => side !== "vendor" || !!row.sentAt,
        );
      }),
  };
}
export type JobOfferService = ReturnType<typeof createJobOfferService>;

// Lazy: importing routers never requires a database connection.
let service: Promise<JobOfferService> | undefined;
export const getJobOfferService = () =>
  (service ??= import("./job-offers-postgres").then((module) =>
    createJobOfferService(module.createPostgresJobOfferPersistence()),
  ));
export const createJobOffer = async (
  ...args: Parameters<JobOfferService["createJobOffer"]>
) => (await getJobOfferService()).createJobOffer(...args);
export const acceptJobOffer = async (input: AcceptJobOfferInput) =>
  (await getJobOfferService()).acceptJobOffer(input);
export const withdrawJobOffer = async (input: JobOfferActionInput) =>
  (await getJobOfferService()).withdrawJobOffer(input);
export const declineJobOffer = async (input: JobOfferActionInput) =>
  (await getJobOfferService()).declineJobOffer(input);
export const expireJobOffers = async () =>
  (await getJobOfferService()).expireJobOffers();
