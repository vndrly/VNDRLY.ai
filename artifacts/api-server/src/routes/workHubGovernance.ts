import { Router, type IRouter, type Request, type Response } from "express";
import { z, ZodError } from "zod/v4";
import {
  legalHoldCreateSchema,
  legalHoldReleaseSchema,
  retentionPlanCreateSchema,
  operationalMetricReadQuerySchema,
  workHubGovernanceOwnerSchema,
  type WorkHubGovernanceOwner,
} from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { GovernanceRetentionError } from "../work-hub/governance-retention";
import { workHubGovernanceService } from "../work-hub/governance-retention-runtime";
import { workHubOperationalMetricsService } from "../work-hub/governance-operational-metrics-runtime";

const governanceHttpService = {
  ...workHubGovernanceService,
  readMetrics: (input: { actor: { userId: number }; owner: WorkHubGovernanceOwner; query: unknown }) => workHubOperationalMetricsService.readOwner({ actorUserId: input.actor.userId, owner: input.owner, query: input.query }),
  readPlatformMetrics: (input: { actor: { userId: number }; query: unknown }) => workHubOperationalMetricsService.readPlatform({ actorUserId: input.actor.userId, query: input.query }),
};
type Service = typeof governanceHttpService;
export type WorkHubGovernanceRouterDependencies = { service: Service };
const source = (req: Request): "web" | "ios" =>
  req.header("x-vndrly-client") === "ios" ? "ios" : "web";
function actor(req: Request) {
  const session = getSessionFromRequest(req);
  return session?.userId
    ? { userId: session.userId, source: source(req) }
    : null;
}
function owner(req: Request): WorkHubGovernanceOwner {
  return workHubGovernanceOwnerSchema.parse({
    type: req.query.ownerType,
    id: Number(req.query.ownerId),
  });
}
function failure(res: Response, error: unknown) {
  if (error instanceof ZodError)
    return sendApiError(
      res,
      400,
      "validation.invalid_request",
      "Invalid governance request",
    );
  if (error instanceof GovernanceRetentionError)
    return sendApiError(res, error.status, error.code, error.message);
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (
    (candidate.status === 403 || candidate.status === 404) &&
    typeof candidate.code === "string"
  )
    return sendApiError(
      res,
      candidate.status,
      candidate.code,
      typeof candidate.message === "string"
        ? candidate.message
        : "Governance resource unavailable",
    );
  throw error;
}

export function createWorkHubGovernanceRouter(
  deps: WorkHubGovernanceRouterDependencies,
): IRouter {
  const router = Router();
  router.use("/work-hub/governance", (req, res, next) => {
    if (!actor(req)) {
      sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
      return;
    }
    next();
  });
  router.get(
    "/work-hub/governance/retention/policies/current",
    async (req, res) => {
      try {
        return res.json(
          await deps.service.currentPolicy({
            actor: actor(req)!,
            owner: owner(req),
          }),
        );
      } catch (error) {
        return failure(res, error);
      }
    },
  );
  router.get("/work-hub/governance/retention/policies", async (req, res) => {
    try {
      return res.json(
        await deps.service.policyHistory({
          actor: actor(req)!,
          owner: owner(req),
        }),
      );
    } catch (error) {
      return failure(res, error);
    }
  });
  router.post("/work-hub/governance/retention/policies", async (req, res) => {
    try {
      return res.status(201).json(
        await deps.service.createPolicy({
          actor: actor(req)!,
          body: req.body,
        }),
      );
    } catch (error) {
      return failure(res, error);
    }
  });
  router.get("/work-hub/governance/retention/minimums", async (req, res) => {
    try {
      return res.json(
        await deps.service.minimumHistory({ actor: actor(req)! }),
      );
    } catch (error) {
      return failure(res, error);
    }
  });
  router.post("/work-hub/governance/retention/minimums", async (req, res) => {
    try {
      return res.status(201).json(
        await deps.service.createMinimum({
          actor: actor(req)!,
          body: req.body,
        }),
      );
    } catch (error) {
      return failure(res, error);
    }
  });
  router.get("/work-hub/governance/legal-holds", async (req, res) => {
    try {
      return res.json(
        await deps.service.listHolds({ actor: actor(req)!, owner: owner(req) }),
      );
    } catch (error) {
      return failure(res, error);
    }
  });
  router.post("/work-hub/governance/legal-holds", async (req, res) => {
    try {
      const body = legalHoldCreateSchema.parse(req.body);
      return res
        .status(201)
        .json(await deps.service.createHold({ actor: actor(req)!, body }));
    } catch (error) {
      return failure(res, error);
    }
  });
  router.post(
    "/work-hub/governance/legal-holds/:id/release",
    async (req, res) => {
      try {
        const body = legalHoldReleaseSchema.parse({
          ...req.body,
          holdId: req.params.id,
        });
        return res.json(
          await deps.service.releaseHold({
            actor: actor(req)!,
            owner: owner(req),
            body,
          }),
        );
      } catch (error) {
        return failure(res, error);
      }
    },
  );
  router.post("/work-hub/governance/retention/plans", async (req, res) => {
    try {
      const body = retentionPlanCreateSchema.parse(req.body);
      return res.status(202).json(
        await deps.service.createPlan({ actor: actor(req)!, body }),
      );
    } catch (error) {
      return failure(res, error);
    }
  });
  router.get("/work-hub/governance/retention/plans/:id", async (req, res) => {
    try {
      return res.json(
        await deps.service.readPlan({
          actor: actor(req)!,
          owner: owner(req),
          planId: z.uuid().parse(req.params.id),
        }),
      );
    } catch (error) {
      return failure(res, error);
    }
  });
  router.get("/work-hub/governance/metrics/platform", async (req, res) => {
    try {
      const query = operationalMetricReadQuerySchema.parse(req.query);
      return res.json(await deps.service.readPlatformMetrics({ actor: actor(req)!, query }));
    } catch (error) { return failure(res, error); }
  });
  router.get("/work-hub/governance/metrics", async (req, res) => {
    try {
      const { ownerType, ownerId, ...rawQuery } = req.query;
      const query = operationalMetricReadQuerySchema.parse(rawQuery);
      return res.json(await deps.service.readMetrics({ actor: actor(req)!, owner: workHubGovernanceOwnerSchema.parse({ type: ownerType, id: Number(ownerId) }), query }));
    } catch (error) { return failure(res, error); }
  });
  return router;
}
export default createWorkHubGovernanceRouter({
  service: governanceHttpService,
});
