import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { isSemanticMarketplaceEnabled, type SemanticMarketplaceScope } from "../services/marketplace/feature";
import { createJobOfferInput, getJobOfferService, type JobOfferService } from "../services/marketplace/job-offers";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { sendValidationFailed } from "../lib/validation-error";
import { logger } from "../lib/logger";
import {
  classifyServiceSubject,
  recordClassification,
} from "../services/service-matching";
import { activeServiceMatch } from "../services/marketplace/eligibility";
import {
  createPostgresPartnerMarketplaceStore,
  discoverPartnerMarketplaceVendors,
  type PartnerMarketplaceStore,
} from "../services/marketplace/partner-store";
import {
  RANKING_FACTORS,
  type MarketplaceSort,
  type RankingFactorName,
} from "../services/marketplace/ranking";
import {
  createPostgresVendorMarketplaceStore,
  MarketplaceError,
  type VendorMarketplaceStore,
} from "../services/marketplace/vendor-store";
import type { VendorCapability } from "@workspace/db/schema";
import {
  createConfiguredCapabilityPreview,
  type CapabilityPreview,
  type CapabilityPreviewInput,
} from "../services/marketplace/capability-preview";
export type { VendorMarketplaceStore } from "../services/marketplace/vendor-store";

const id = z.coerce.number().int().positive();
const text = z.string().trim().min(1).max(2000);
const object = z.record(z.string(), z.unknown()).nullable();
const capabilityBody = z
  .object({
    name: text.max(200),
    description: text.nullable().default(null),
    defaultUnit: text.max(50).nullable().default(null),
    defaultRateCard: z
      .object({
        unitPrice: z
          .number()
          .finite()
          .min(0)
          .max(9999999999.99)
          .multipleOf(0.01),
        unit: text.max(50),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .default("USD"),
      })
      .strict()
      .nullable()
      .default(null),
    capacity: z.number().int().positive().max(100000).default(1),
    qualifications: object.default(null),
    evidence: object.default(null),
    active: z.boolean().default(true),
  })
  .strict();
const capabilityPatch = capabilityBody
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const areaBody = z
  .object({
    vendorCapabilityId: id.nullable().default(null),
    radiusMiles: z.number().finite().positive().max(20000).multipleOf(0.001),
  })
  .strict();
const rateBody = z
  .object({
    vendorCapabilityId: id,
    workTypeId: id,
    unitPrice: z.number().finite().min(0).max(9999999999.99).multipleOf(0.01),
    unit: text.max(50),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
    rateComponents: object.default(null),
    notes: text.nullable().default(null),
    commercialConditions: text.nullable().default(null),
    availability: z
      .object({ available: z.boolean() })
      .strict()
      .nullable()
      .default(null),
    capacity: z.number().int().positive().max(100000).default(1),
    active: z.boolean().default(true),
  })
  .strict();

async function classifyCapability(
  capability: VendorCapability,
  actor: number,
): Promise<void> {
  const subject = {
    subjectType: "vendor_capability" as const,
    subjectId: capability.id,
    name: capability.name,
    description: capability.description,
  };
  try {
    const classification = await classifyServiceSubject(subject);
    await recordClassification({
      subject,
      classification,
      actorUserId: actor,
      actorProcess: "vendor-capability-save",
    });
  } catch {
    // An unconfigured/offline classifier leaves the saved capability pending, never invents an active match.
    logger.warn(
      { capabilityId: capability.id },
      "Capability saved pending service classification",
    );
  }
}

export function createServiceMarketplaceRouter(
  dependencies: {
    store?: VendorMarketplaceStore;
    classifyCapability?: typeof classifyCapability;
    partnerStore?: PartnerMarketplaceStore;
    jobOffers?: JobOfferService;
    isEnabled?: typeof isSemanticMarketplaceEnabled;
    now?: () => Date;
    previewCapability?: (
      input: CapabilityPreviewInput,
    ) => Promise<CapabilityPreview>;
  } = { store: createPostgresVendorMarketplaceStore(), classifyCapability },
): IRouter {
  const router = Router();
  const requireFeature = async (scope: SemanticMarketplaceScope | null) => {
    if (!(await (dependencies.isEnabled ?? isSemanticMarketplaceEnabled)(scope)))
      throw new MarketplaceError(403, "marketplace.disabled");
  };
  const offerHandler = (run: (req: Request, res: Response, service: JobOfferService, session: SessionPayload) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      const session = getSessionFromRequest(req);
      if (!session?.userId) { res.status(401).json({ code: "auth.required", error: "Authentication required" }); return; }
      const service = dependencies.jobOffers ?? await getJobOfferService();
      // Resolve saved offer/site scope, never trust action-body eligibility or org identities.
      const saved = req.params.offerId
        ? await service.getJobOffer(id.parse(req.params.offerId), session)
        : null;
      const vendorAction = req.path.includes("/vendors/") ||
        ["/accept", "/decline", "/review"].some((action) => req.path.endsWith(action));
      const side = session.role === "admin" ? (vendorAction ? "vendor" : "partner") : session.role;
      let orgId = side === "vendor" ? session.vendorId : session.partnerId;
      if (session.role === "admin") {
        orgId = side === "vendor"
          ? saved?.vendorId ?? Number(req.params.orgId)
          : saved?.partnerId ?? Number(req.params.orgId ?? req.body?.partnerId);
      }
      await requireFeature(side === "partner" || side === "vendor"
        ? { ownerOrgType: side, ownerOrgId: Number(orgId), siteId: saved?.siteLocationId ?? req.body?.siteLocationId }
        : null);
      await run(req, res, service, session);
    } catch (error) {
      if (error instanceof z.ZodError) { sendValidationFailed(res, error); return; }
      if (error instanceof MarketplaceError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
      logger.error({ err: error }, "Job offer request failed");
      res.status(503).json({ error: "Marketplace unavailable", code: "marketplace.unavailable" });
    }
  };
  const publicOffer = (row: Awaited<ReturnType<JobOfferService["getJobOffer"]>>) => {
    const { idempotencyKey: _key, commercialSnapshot, ...offer } = row;
    const { requestFingerprint: _fingerprint, ...commercial } = commercialSnapshot;
    return { ...offer, commercialSnapshot: commercial };
  };
  const offerBase = "/service-marketplace/job-offers";
  router.post(offerBase, offerHandler(async (req, res, service, session) => {
    const body = createJobOfferInput.parse(req.body);
    const key = z.string().trim().min(1).max(200).parse(req.get("Idempotency-Key"));
    res.status(201).json(publicOffer(await service.createJobOffer(body, session, key)));
  }));
  router.get(`${offerBase}/:offerId`, offerHandler(async (req, res, service, session) => {
    res.json(publicOffer(await service.getJobOffer(id.parse(req.params.offerId), session)));
  }));
  for (const side of ["partner", "vendor"] as const) router.get(`/service-marketplace/${side}s/:orgId/job-offers`, offerHandler(async (req, res, service, session) => {
    res.json({ items: (await service.listJobOffers(side, id.parse(req.params.orgId), session)).map(publicOffer) });
  }));
  for (const action of ["send", "review", "withdraw", "decline", "accept"] as const) router.post(`${offerBase}/:offerId/${action}`, offerHandler(async (req, res, service, session) => {
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    const input = { offerId: id.parse(req.params.offerId), version, session };
    if (action === "accept") {
      const idempotencyKey = z.string().trim().min(1).max(200).parse(req.get("Idempotency-Key"));
      res.json(await service.acceptJobOffer({ ...input, idempotencyKey }));
    } else {
      const methods = { send: service.sendJobOffer, review: service.reviewJobOffer, withdraw: service.withdrawJobOffer, decline: service.declineJobOffer };
      res.json(publicOffer(await methods[action](input)));
    }
  }));
  const store = dependencies.store ?? createPostgresVendorMarketplaceStore();
  const partnerStore =
    dependencies.partnerStore ?? createPostgresPartnerMarketplaceStore();
  const searchPartner = async (req: Request, res: Response) => {
    try {
      const partnerId = id.parse(req.params.partnerId);
      const workTypeId = id.parse(req.params.workTypeId);
      const session = getSessionFromRequest(req);
      await requireFeature({ ownerOrgType: "partner", ownerOrgId: partnerId, siteId: req.query.siteId === undefined ? null : Number(req.query.siteId) });
      const allowed =
        session?.role === "admin" ||
        (session?.role === "partner" &&
          session.partnerId === partnerId &&
          session.vendorId == null &&
          Number.isSafeInteger(session.activeMembershipId) &&
          (session.activeMembershipId ?? 0) > 0);
      if (
        !Number.isSafeInteger(session?.userId) ||
        (session?.userId ?? 0) <= 0 ||
        !allowed ||
        session?.publicDemo ||
        !(await partnerStore.authorize(session!, partnerId))
      )
        throw new MarketplaceError(403, "marketplace.partner_scope_required");
      const weightFields = Object.fromEntries(
        RANKING_FACTORS.map((name) => [
          `${name}Weight`,
          z.coerce.number().finite().min(0).max(100).optional(),
        ]),
      ) as Record<`${RankingFactorName}Weight`, z.ZodOptional<z.ZodNumber>>;
      const detailIdentity =
        req.params.discoveryVendorId !== undefined
          ? z
              .object({
                vendorCapabilityId: id,
                vendorPartnerServiceOfferId: id,
              })
              .parse(req.query)
          : null;
      const query = z
        .object({
          siteId: id,
          requestedCapacity: id.max(100000).default(1),
          sort: z
            .enum(["recommended", ...RANKING_FACTORS])
            .default("recommended"),
          limit: id.max(100).default(50),
          offset: z.coerce.number().int().min(0).default(0),
          ...weightFields,
          ...(detailIdentity
            ? { vendorCapabilityId: id, vendorPartnerServiceOfferId: id }
            : {}),
        })
        .strict()
        .parse(req.query);
      const context = await partnerStore.loadContext(
        partnerId,
        workTypeId,
        Number(query.siteId),
      );
      if (
        !context ||
        context.partnerId !== partnerId ||
        context.workType.partnerId !== partnerId ||
        context.site.partnerId !== partnerId
      )
        throw new MarketplaceError(
          404,
          "marketplace.work_type_or_site_not_found",
        );
      const weights: Partial<Record<RankingFactorName, number>> = {};
      for (const name of RANKING_FACTORS)
        if (query[`${name}Weight`] !== undefined)
          weights[name] = Number(query[`${name}Weight`]);
      const items = await discoverPartnerMarketplaceVendors(
        partnerStore,
        context,
        {
          requestedCapacity: Number(query.requestedCapacity),
          sort: query.sort as MarketplaceSort,
          weights,
        },
        dependencies.now?.() ?? new Date(),
      );
      if (req.params.discoveryVendorId !== undefined) {
        const vendorId = id.parse(req.params.discoveryVendorId);
        const item = items.find(
          (row) =>
            row.vendorId === vendorId &&
            row.capabilityId === detailIdentity!.vendorCapabilityId &&
            row.offer.id === detailIdentity!.vendorPartnerServiceOfferId,
        );
        if (!item)
          throw new MarketplaceError(404, "marketplace.vendor_not_found");
        res.json(item);
      } else
        res.json({
          items: items.slice(
            Number(query.offset),
            Number(query.offset) + Number(query.limit),
          ),
          total: items.length,
          limit: Number(query.limit),
          offset: Number(query.offset),
        });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendValidationFailed(res, error);
        return;
      }
      if (error instanceof MarketplaceError) {
        res
          .status(error.status)
          .json({ error: error.message, code: error.code });
        return;
      }
      logger.error({ err: error }, "Partner marketplace request failed");
      res.status(503).json({
        error: "Marketplace unavailable",
        code: "marketplace.unavailable",
      });
    }
  };
  const partnerBase =
    "/service-marketplace/partners/:partnerId/work-types/:workTypeId/vendors";
  router.get(partnerBase, searchPartner);
  router.get(`${partnerBase}/:discoveryVendorId`, searchPartner);
  const scope = async (
    req: Request,
  ): Promise<{ vendorId: number; actor: number; session: SessionPayload }> => {
    const vendorId = id.parse(req.params.vendorId);
    const session = getSessionFromRequest(req);
    await requireFeature({ ownerOrgType: "vendor", ownerOrgId: vendorId });
    const identified =
      Number.isSafeInteger(session?.userId) && (session?.userId ?? 0) > 0;
    const allowed =
      session?.role === "admin" ||
      (session?.role === "vendor" &&
        session.vendorId === vendorId &&
        session.partnerId == null &&
        session.membershipRole === "admin" &&
        Number.isSafeInteger(session.activeMembershipId) &&
        (session.activeMembershipId ?? 0) > 0);
    if (
      !identified ||
      !allowed ||
      session?.publicDemo ||
      !(await store.authorize(session!, vendorId))
    )
      throw new MarketplaceError(403, "marketplace.vendor_admin_required");
    return { vendorId, actor: session!.userId!, session: session! };
  };
  const handle =
    (
      run: (
        req: Request,
        res: Response,
        scope: { vendorId: number; actor: number },
      ) => Promise<void>,
    ) =>
    async (req: Request, res: Response) => {
      try {
        await run(req, res, await scope(req));
      } catch (error) {
        if (error instanceof z.ZodError) {
          sendValidationFailed(res, error);
          return;
        }
        if (error instanceof MarketplaceError) {
          res
            .status(error.status)
            .json({ error: error.message, code: error.code });
          return;
        }
        logger.error({ err: error }, "Vendor marketplace request failed");
        res.status(503).json({
          error: "Marketplace unavailable",
          code: "marketplace.unavailable",
        });
      }
    };
  const found = <T>(row: T | null): T => {
    if (row === null)
      throw new MarketplaceError(404, "marketplace.capability_not_found");
    return row;
  };
  const audit = (
    actor: number,
    vendorId: number,
    action: string,
    recordId: number,
  ) =>
    logger.info(
      { actorUserId: actor, vendorId, action, recordId },
      "Vendor marketplace changed",
    );
  const base = "/service-marketplace/vendors/:vendorId";
  router.get(
    `${base}/capabilities`,
    handle(async (_req, res, { vendorId }) => {
      res.json({ items: await store.listCapabilities(vendorId) });
    }),
  );
  router.post(
    `${base}/capabilities/preview`,
    handle(async (req, res) => {
      const input = z
        .object({
          name: text.max(200),
          description: text.nullable().optional(),
        })
        .strict()
        .parse(req.body);
      const preview =
        dependencies.previewCapability ??
        createConfiguredCapabilityPreview((id) =>
          store.countMatchingDemand(id),
        );
      const result = await preview(input);
      // Deliberate allowlist: evidence, model details, subject identities, and private catalog facts stay internal.
      res.json({
        provisional: true,
        status: result.status,
        canonicalServiceId: result.canonicalServiceId,
        canonicalServiceName: result.canonicalServiceName,
        explanation: result.explanation,
        confidence: result.confidence,
        matchingPartnerCount: result.matchingPartnerCount,
      });
    }),
  );
  router.post(
    `${base}/capabilities`,
    handle(async (req, res, { vendorId, actor }) => {
      const row = await store.saveCapability(
        vendorId,
        null,
        capabilityBody.parse(req.body),
        actor,
      );
      if (row.active)
        await (dependencies.classifyCapability ?? classifyCapability)(
          row,
          actor,
        );
      audit(actor, vendorId, "capability_create", row.id);
      res.status(201).json(found(await store.getCapability(vendorId, row.id)));
    }),
  );
  router.patch(
    `${base}/capabilities/:capabilityId`,
    handle(async (req, res, { vendorId, actor }) => {
      const capabilityId = id.parse(req.params.capabilityId);
      const body = capabilityPatch.parse(req.body);
      const old = found(await store.getCapability(vendorId, capabilityId));
      const row = await store.saveCapability(
        vendorId,
        capabilityId,
        body,
        actor,
      );
      if (
        row.active &&
        (row.name !== old.name ||
          row.description !== old.description ||
          !old.active)
      )
        await (dependencies.classifyCapability ?? classifyCapability)(
          row,
          actor,
        );
      audit(actor, vendorId, "capability_update", row.id);
      res.json(found(await store.getCapability(vendorId, row.id)));
    }),
  );
  router.get(
    `${base}/service-areas`,
    handle(async (_req, res, { vendorId }) => {
      res.json({ items: await store.listAreas(vendorId) });
    }),
  );
  router.put(
    `${base}/service-areas`,
    handle(async (req, res, { vendorId, actor }) => {
      const body = areaBody.parse(req.body);
      if (body.vendorCapabilityId !== null)
        found(await store.getCapability(vendorId, body.vendorCapabilityId));
      const row = await store.saveArea(vendorId, body, actor);
      audit(actor, vendorId, "service_area_save", row.id);
      res.json(row);
    }),
  );
  router.delete(
    `${base}/service-areas/capabilities/:capabilityId`,
    handle(async (req, res, { vendorId, actor }) => {
      const capabilityId = id.parse(req.params.capabilityId);
      found(await store.getCapability(vendorId, capabilityId));
      await store.clearAreaOverride(vendorId, capabilityId, actor);
      audit(
        actor,
        vendorId,
        "service_area_inherit_company_default",
        capabilityId,
      );
      res.status(204).end();
    }),
  );
  router.get(
    `${base}/partner-rates`,
    handle(async (_req, res, { vendorId }) => {
      res.json({ items: await store.listRates(vendorId) });
    }),
  );
  router.put(
    `${base}/partner-rates`,
    handle(async (req, res, { vendorId, actor }) => {
      const body = rateBody.parse(req.body);
      const target = await store.getRateTarget(
        vendorId,
        body.vendorCapabilityId,
        body.workTypeId,
      );
      if (
        !target ||
        !activeServiceMatch(
          target.capabilityMapping,
          target.demandMapping,
          target.canonicalServiceActive,
        )
      )
        throw new MarketplaceError(409, "marketplace.active_match_required");
      const row = await store.saveRate(vendorId, body, actor);
      audit(actor, vendorId, "partner_rate_save", row.id);
      res.json(row);
    }),
  );
  router.get(
    `${base}/matching-demand`,
    handle(async (req, res, { vendorId }) => {
      const { limit, offset } = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .strict()
        .parse(req.query);
      const rows = await store.listDemand(vendorId, limit, offset);
      // Positive allowlist: the store can hold internal evidence; it must never spill into vendor discovery.
      res.json({
        items: rows.map((row) => ({
          partnerId: row.partnerId,
          partnerName: row.partnerName,
          workTypeId: row.workTypeId,
          name: row.name,
          category: row.category,
          description: row.description,
          requiredCertifications: row.requiredCertifications,
          locationPrecision: "state",
          locations: row.locations.map((location) => ({
            state: location.state,
            approximateSiteCount: location.approximateSiteCount,
          })),
          approximateDemand: row.approximateDemand,
          capabilityId: row.capabilityId,
          ownOffer: row.ownOffer,
          eligibility: {
            eligible: row.eligibility.eligible,
            reasonCodes: row.eligibility.reasonCodes,
            facts: {
              radiusMiles: row.eligibility.facts.radiusMiles,
              availableCapacity: row.eligibility.facts.availableCapacity,
              requiredCapacity: row.eligibility.facts.requiredCapacity,
              missingCredentials: row.eligibility.facts.missingCredentials,
              distanceMiles:
                row.eligibility.facts.distanceMiles === null
                  ? null
                  : Math.ceil(row.eligibility.facts.distanceMiles / 10) * 10,
            },
          },
        })),
        limit,
        offset,
      });
    }),
  );
  return router;
}

export default createServiceMarketplaceRouter();
