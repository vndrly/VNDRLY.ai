import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  canonicalServicesTable as services,
  canonicalServiceAliasesTable as aliases,
  serviceMappingsTable as mappings,
  workTypesTable,
  vendorCapabilitiesTable,
  type CanonicalService,
  type CanonicalServiceAlias,
} from "@workspace/db/schema";
import { getSessionFromRequest, requireAdmin } from "../lib/session";
import { sendValidationFailed } from "../lib/validation-error";
import { logger } from "../lib/logger";
import {
  classifyServiceSubject,
  recordClassification,
  createPostgresMappingRepository,
  type MappingRepository,
  type StoredServiceMapping,
  type ServiceSubjectInput,
} from "../services/service-matching";
import {
  MarketplaceAdminError,
  mappingReadback,
  reviewServiceMapping,
} from "../services/service-matching/admin-review";

const id = z.coerce.number().int().positive();
const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const text = z.string().trim().min(1).max(2000);
const serviceBody = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,99}$/),
    name: text.max(200),
    category: text.max(200),
    definition: text,
    inclusionGuidance: text.nullable().optional(),
    exclusionGuidance: text.nullable().optional(),
  })
  .strict();
const servicePatch = serviceBody
  .omit({ code: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const aliasBody = z
  .object({
    alias: text.max(200),
    industry: text.max(200).nullable().default(null),
    region: text.max(200).nullable().default(null),
    provenance: z
      .enum(["platform", "partner_usage", "vendor_usage", "reviewed_ai"])
      .default("platform"),
    active: z.boolean().default(true),
  })
  .strict();
const aliasPatch = aliasBody
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const reviewBody = z
  .object({
    action: z.enum(["approve", "reject", "remap"]),
    canonicalServiceId: id.optional(),
    reason: text,
  })
  .strict()
  .refine(
    (value) =>
      value.action === "remap"
        ? value.canonicalServiceId !== undefined
        : value.canonicalServiceId === undefined,
    { message: "Only remap requires canonicalServiceId" },
  );
type ServiceInput = z.infer<typeof serviceBody>;
type AliasInput = z.infer<typeof aliasBody>;
type QueueRow = StoredServiceMapping & {
  subject: ServiceSubjectInput | null;
  canonicalService: CanonicalService | null;
};

export interface AdminMarketplaceStore {
  getMapping(id: number): Promise<StoredServiceMapping | null>;
  listMappings(
    limit: number,
    offset: number,
  ): Promise<{ items: QueueRow[]; total: number }>;
  listServices(
    limit: number,
    offset: number,
  ): Promise<{
    items: (CanonicalService & { aliases: CanonicalServiceAlias[] })[];
    total: number;
  }>;
  createService(value: ServiceInput): Promise<CanonicalService>;
  updateService(
    id: number,
    value: Partial<Omit<ServiceInput, "code">>,
  ): Promise<CanonicalService | null>;
  archiveService(id: number): Promise<CanonicalService | null>;
  addAlias(
    id: number,
    value: AliasInput,
  ): Promise<CanonicalServiceAlias | null>;
  updateAlias(
    id: number,
    aliasId: number,
    value: Partial<AliasInput>,
  ): Promise<CanonicalServiceAlias | null>;
}

/** Lazy database access keeps route construction free of connections and model calls. */
function postgresStore(): AdminMarketplaceStore {
  const database = async () => (await import("@workspace/db")).db;
  return {
    async getMapping(id) {
      const [row] = await (await database())
        .select()
        .from(mappings)
        .where(eq(mappings.id, id));
      return row ?? null;
    },
    async listMappings(limit, offset) {
      const db = await database();
      const pending = and(
        eq(mappings.status, "review_required"),
        sql`not exists (select 1 from service_mappings newer where newer.subject_type = ${mappings.subjectType} and newer.subject_id = ${mappings.subjectId} and newer.mapping_version > ${mappings.mappingVersion})`,
      );
      const rows = await db
        .select({
          mapping: mappings,
          workType: workTypesTable,
          capability: vendorCapabilitiesTable,
          canonicalService: services,
        })
        .from(mappings)
        .leftJoin(workTypesTable, eq(mappings.workTypeId, workTypesTable.id))
        .leftJoin(
          vendorCapabilitiesTable,
          eq(mappings.vendorCapabilityId, vendorCapabilitiesTable.id),
        )
        .leftJoin(services, eq(mappings.canonicalServiceId, services.id))
        .where(pending)
        .orderBy(asc(mappings.createdAt), asc(mappings.id))
        .limit(limit)
        .offset(offset);
      const [count] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(mappings)
        .where(pending);
      return {
        items: rows.map(
          ({ mapping, workType, capability, canonicalService }) => {
            const subject =
              mapping.subjectType === "partner_work_type"
                ? workType
                : capability;
            return {
              ...mapping,
              subject: subject
                ? {
                    subjectType: mapping.subjectType,
                    subjectId: mapping.subjectId,
                    name: subject.name,
                    description: subject.description,
                    ...(workType ? { category: workType.category } : {}),
                  }
                : null,
              canonicalService,
            };
          },
        ),
        total: count.total,
      };
    },
    async listServices(limit, offset) {
      const db = await database();
      const items = await db
        .select()
        .from(services)
        .orderBy(asc(services.name), asc(services.id))
        .limit(limit)
        .offset(offset);
      const [count] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(services);
      const serviceAliases = items.length
        ? await db
            .select()
            .from(aliases)
            .where(
              sql`${aliases.canonicalServiceId} in (${sql.join(
                items.map((row) => sql`${row.id}`),
                sql`, `,
              )})`,
            )
            .orderBy(asc(aliases.id))
        : [];
      return {
        items: items.map((row) => ({
          ...row,
          aliases: serviceAliases.filter(
            (alias) => alias.canonicalServiceId === row.id,
          ),
        })),
        total: count.total,
      };
    },
    async createService(value) {
      const [row] = await (await database())
        .insert(services)
        .values(value)
        .returning();
      return row;
    },
    async updateService(id, value) {
      const [row] = await (
        await database()
      )
        .update(services)
        .set({ ...value, updatedAt: new Date() })
        .where(eq(services.id, id))
        .returning();
      return row ?? null;
    },
    // Never physically delete concepts: historical mappings, tickets, and offers retain their identity.
    async archiveService(id) {
      const [row] = await (await database())
        .update(services)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(services.id, id))
        .returning();
      return row ?? null;
    },
    async addAlias(id, value) {
      return (await database()).transaction(async (tx) => {
        const [service] = await tx
          .select()
          .from(services)
          .where(eq(services.id, id))
          .for("share");
        if (!service) return null;
        if (!service.active)
          throw new MarketplaceAdminError(
            409,
            "service_mapping.concept_inactive",
          );
        const [row] = await tx
          .insert(aliases)
          .values({ ...value, canonicalServiceId: id })
          .returning();
        return row;
      });
    },
    async updateAlias(id, aliasId, value) {
      return (await database()).transaction(async (tx) => {
        const [service] = await tx
          .select()
          .from(services)
          .where(eq(services.id, id))
          .for("share");
        if (!service) return null;
        if (!service.active && value.active !== false)
          throw new MarketplaceAdminError(
            409,
            "service_mapping.concept_inactive",
          );
        const [row] = await tx
          .update(aliases)
          .set({ ...value, updatedAt: new Date() })
          .where(
            and(eq(aliases.id, aliasId), eq(aliases.canonicalServiceId, id)),
          )
          .returning();
        return row ?? null;
      });
    },
  };
}

interface Dependencies {
  store: AdminMarketplaceStore;
  repository: MappingRepository;
  matching: {
    classifyServiceSubject: typeof classifyServiceSubject;
    recordClassification: typeof recordClassification;
  };
}

export function createServiceMarketplaceAdminRouter(
  dependencies: Dependencies = {
    store: postgresStore(),
    repository: createPostgresMappingRepository(),
    matching: { classifyServiceSubject, recordClassification },
  },
): IRouter {
  const router = Router();
  // Mount narrowly: this router must not guard unrelated application routes.
  router.use(
    [
      "/admin/canonical-services",
      "/admin/service-mappings",
      "/admin/service-subjects",
    ],
    requireAdmin,
    (req, res, next) => {
      const userId = getSessionFromRequest(req)?.userId;
      if (!Number.isSafeInteger(userId) || (userId ?? 0) <= 0) {
        res.status(403).json({
          error: "Identified admin required",
          code: "auth.admin_required",
        });
        return;
      }
      next();
    },
  );
  const handle =
    (run: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await run(req, res);
      } catch (error) {
        if (error instanceof z.ZodError) {
          sendValidationFailed(res, error);
          return;
        }
        if (error instanceof MarketplaceAdminError) {
          res
            .status(error.status)
            .json({ error: error.message, code: error.code });
          return;
        }
        if ((error as { code?: string })?.code === "23505") {
          res.status(409).json({
            error: "Service code already exists",
            code: "service_mapping.duplicate_code",
          });
          return;
        }
        logger.error(
          { err: error },
          "Admin service marketplace request failed",
        );
        res.status(503).json({
          error: "Service marketplace unavailable",
          code: "service_mapping.unavailable",
        });
      }
    };
  const found = <T>(value: T | null): T => {
    if (value === null)
      throw new MarketplaceAdminError(404, "service_mapping.not_found");
    return value;
  };
  const actor = (req: Request) => getSessionFromRequest(req)!.userId!;
  router.get(
    "/admin/canonical-services",
    handle(async (req, res) => {
      const { limit, offset } = paging.parse(req.query);
      res.json({
        ...(await dependencies.store.listServices(limit, offset)),
        limit,
        offset,
      });
    }),
  );
  router.post(
    "/admin/canonical-services",
    handle(async (req, res) => {
      const row = await dependencies.store.createService(
        serviceBody.parse(req.body),
      );
      logger.info(
        {
          actorUserId: actor(req),
          canonicalServiceId: row.id,
          action: "create",
        },
        "Canonical service changed",
      );
      res.status(201).json(row);
    }),
  );
  router.patch(
    "/admin/canonical-services/:id",
    handle(async (req, res) => {
      const row = found(
        await dependencies.store.updateService(
          id.parse(req.params.id),
          servicePatch.parse(req.body),
        ),
      );
      logger.info(
        {
          actorUserId: actor(req),
          canonicalServiceId: row.id,
          action: "update",
        },
        "Canonical service changed",
      );
      res.json(row);
    }),
  );
  router.delete(
    "/admin/canonical-services/:id",
    handle(async (req, res) => {
      const row = found(
        await dependencies.store.archiveService(id.parse(req.params.id)),
      );
      logger.info(
        {
          actorUserId: actor(req),
          canonicalServiceId: row.id,
          action: "archive",
        },
        "Canonical service changed",
      );
      res.json(row);
    }),
  );
  router.post(
    "/admin/canonical-services/:id/aliases",
    handle(async (req, res) => {
      const row = found(
        await dependencies.store.addAlias(
          id.parse(req.params.id),
          aliasBody.parse(req.body),
        ),
      );
      logger.info(
        {
          actorUserId: actor(req),
          aliasId: row.id,
          canonicalServiceId: row.canonicalServiceId,
          action: "alias_create",
        },
        "Canonical alias changed",
      );
      res.status(201).json(row);
    }),
  );
  router.patch(
    "/admin/canonical-services/:id/aliases/:aliasId",
    handle(async (req, res) => {
      const row = found(
        await dependencies.store.updateAlias(
          id.parse(req.params.id),
          id.parse(req.params.aliasId),
          aliasPatch.parse(req.body),
        ),
      );
      logger.info(
        {
          actorUserId: actor(req),
          aliasId: row.id,
          canonicalServiceId: row.canonicalServiceId,
          action: "alias_update",
        },
        "Canonical alias changed",
      );
      res.json(row);
    }),
  );
  router.get(
    "/admin/service-mappings",
    handle(async (req, res) => {
      const { limit, offset } = paging.parse(req.query);
      const result = await dependencies.store.listMappings(limit, offset);
      res.json({
        ...result,
        items: result.items.map((row) => ({
          ...mappingReadback(row),
          subject: row.subject,
          canonicalService: row.canonicalService,
        })),
        limit,
        offset,
      });
    }),
  );
  router.get(
    "/admin/service-subjects/:subjectType/:subjectId/mappings",
    handle(async (req, res) => {
      const subject = {
        subjectType: z
          .enum(["partner_work_type", "vendor_capability"])
          .parse(req.params.subjectType),
        subjectId: id.parse(req.params.subjectId),
        name: "history",
      };
      const { limit, offset } = paging.parse(req.query);
      const rows = await dependencies.repository.withSubjectLock(
        subject,
        (tx) => tx.listMappings(),
      );
      rows.sort((a, b) => b.mappingVersion - a.mappingVersion);
      res.json({
        items: rows.slice(offset, offset + limit).map(mappingReadback),
        total: rows.length,
        currentMapping: mappingReadback(
          rows.find(
            (row) => row.status === "active" && row.supersededAt === null,
          ) ?? null,
        ),
        limit,
        offset,
      });
    }),
  );
  router.post(
    "/admin/service-mappings/:id/review",
    handle(async (req, res) => {
      const review = reviewBody.parse(req.body);
      const source = found(
        await dependencies.store.getMapping(id.parse(req.params.id)),
      );
      const result = await reviewServiceMapping(
        dependencies.repository,
        source,
        review,
        actor(req),
      );
      res.json({
        mapping: mappingReadback(result.mapping),
        currentMapping: mappingReadback(result.currentMapping),
      });
    }),
  );
  router.post(
    "/admin/service-subjects/:subjectType/:subjectId/reclassify",
    handle(async (req, res) => {
      const identity = {
        subjectType: z
          .enum(["partner_work_type", "vendor_capability"])
          .parse(req.params.subjectType),
        subjectId: id.parse(req.params.subjectId),
        name: "load",
      };
      const subject = found(
        await dependencies.repository.withSubjectLock(identity, (tx) =>
          tx.loadSubject(),
        ),
      );
      if (!subject.active)
        throw new MarketplaceAdminError(
          409,
          "service_mapping.subject_inactive",
        );
      const classification =
        await dependencies.matching.classifyServiceSubject(subject);
      const result = await dependencies.matching.recordClassification({
        subject,
        classification,
        actorUserId: actor(req),
        actorProcess: "admin-reclassification",
      });
      res.json({
        ...result,
        mapping: mappingReadback(result.mapping),
        currentMapping: mappingReadback(result.currentMapping),
      });
    }),
  );
  return router;
}

export default createServiceMarketplaceAdminRouter();
