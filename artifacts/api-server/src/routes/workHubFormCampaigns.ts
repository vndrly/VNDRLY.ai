import { campaignCsv } from "../work-hub/form-campaign-export";
import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import {
  campaignAttachment,
  campaignOptions,
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  publishCampaign,
  pauseCampaign,
  getCampaignInstance,
  respondCampaign,
  type CampaignActor,
} from "../work-hub/form-campaign-service";
const router = Router();
function actor(req: Request): CampaignActor {
  const s = getSessionFromRequest(req);
  if (!s?.userId)
    throw Object.assign(new Error("Authentication required"), { status: 401 });
  return {
    ...s,
    userId: s.userId,
    source: req.header("x-vndrly-client") === "ios" ? "ios" : "web",
  };
}
function handle(run: (req: Request, a: CampaignActor) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      return res.json(await run(req, actor(req)));
    } catch (e) {
      const error = e as Error & { status?: number };
      return res
        .status(e instanceof z.ZodError ? 400 : (error.status ?? 500))
        .json({
          error:
            e instanceof z.ZodError
              ? "Invalid campaign settings"
              : error.status
                ? error.message
                : "Campaign request unavailable",
        });
    }
  };
}
router.get(
  "/work-hub/form-campaigns/instances/:instanceId/attachment",
  async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const file = await campaignAttachment(
        actor(req),
        z.uuid().parse(req.params.instanceId),
      );
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Length", String(file.byteSize));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(file.body);
    } catch (e) {
      const err = e as Error & { status?: number };
      return res
        .status(err.status ?? 400)
        .json({
          error: err.status ? err.message : "Policy attachment unavailable",
        });
    }
  },
);
const id = (req: Request) => z.uuid().parse(req.params.campaignId),
  instance = (req: Request) => z.uuid().parse(req.params.instanceId),
  body = (req: Request) => workHubCommandEnvelopeSchema.parse(req.body);
router.get(
  "/work-hub/form-campaigns",
  handle(async (_r, a) => ({ campaigns: await listCampaigns(a) })),
);
router.get(
  "/work-hub/form-campaigns/options",
  handle((_r, a) => campaignOptions(a)),
);
router.post(
  "/work-hub/form-campaigns",
  handle((r, a) => createCampaign(a, body(r))),
);
router.get(
  "/work-hub/form-campaigns/instances/:instanceId",
  handle((r, a) => getCampaignInstance(a, instance(r))),
);
router.post(
  "/work-hub/form-campaigns/instances/:instanceId/respond",
  handle((r, a) => respondCampaign(a, instance(r), body(r))),
);
router.get("/work-hub/form-campaigns/:campaignId/export", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const data = await getCampaign(actor(req), id(req)),
      csv = campaignCsv(data);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="campaign-${data.campaignId}.csv"`,
    );
    return res.send(csv);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res
      .status(err.status ?? 500)
      .json({
        error: err.status ? err.message : "Campaign export unavailable",
      });
  }
});
router.get(
  "/work-hub/form-campaigns/:campaignId",
  handle((r, a) => getCampaign(a, id(r))),
);
router.patch(
  "/work-hub/form-campaigns/:campaignId",
  handle((r, a) => updateCampaign(a, id(r), body(r))),
);
router.post(
  "/work-hub/form-campaigns/:campaignId/publish",
  handle((r, a) => publishCampaign(a, id(r), body(r))),
);
router.post(
  "/work-hub/form-campaigns/:campaignId/pause",
  handle((r, a) => pauseCampaign(a, id(r), body(r))),
);
router.get(
  "/work-hub/form-campaigns/:campaignId/progress",
  handle((r, a) => getCampaign(a, id(r))),
);
router.get(
  "/work-hub/form-campaigns/:campaignId/results",
  handle((r, a) => getCampaign(a, id(r))),
);
export default router;
