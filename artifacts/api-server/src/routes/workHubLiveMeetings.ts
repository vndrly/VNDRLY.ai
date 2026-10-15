import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  workHubCommandEnvelopeSchema,
  LiveMeetingLobbySchema,
  LiveMeetingSummarySchema,
} from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import {
  listLiveMeetings,
  getLiveMeeting,
  startLiveMeeting,
  requestMeetingAdmission,
  decideMeetingAdmission,
  inviteLiveMeetingMembers,
  changeMeetingAdmission,
  type LiveActor,
} from "../work-hub/live-meetings";
const router = Router();
function actor(req: Request): LiveActor {
  const s = getSessionFromRequest(req);
  if (!s?.userId)
    throw Object.assign(new Error("Authentication required"), { status: 401 });
  return {
    ...s,
    userId: s.userId,
    source: req.header("x-vndrly-client") === "ios" ? "ios" : "web",
  };
}
function route(run: (req: Request, a: LiveActor) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const result = await run(req, actor(req));
      res.setHeader("Cache-Control", "private, no-store");
      return res.json(result);
    } catch (e) {
      const error = e as Error & { status?: number };
      return res
        .status(e instanceof z.ZodError ? 400 : (error.status ?? 500))
        .json({
          error:
            error.status || e instanceof z.ZodError
              ? error.message
              : "Meeting request unavailable",
        });
    }
  };
}
const id = (req: Request) => z.uuid().parse(req.params.occurrenceId);
router.get(
  "/work-hub/live-meetings",
  route(async (_req, a) => ({
    meetings: z
      .array(LiveMeetingSummarySchema)
      .parse(await listLiveMeetings(a)),
  })),
);
router.post(
  "/work-hub/live-meetings",
  route((req, a) =>
    startLiveMeeting(a, workHubCommandEnvelopeSchema.parse(req.body)),
  ),
);
router.get(
  "/work-hub/live-meetings/:occurrenceId",
  route(async (req, a) =>
    LiveMeetingLobbySchema.parse(await getLiveMeeting(a, id(req))),
  ),
);
router.post(
  "/work-hub/live-meetings/:occurrenceId/request-admission",
  route((req, a) =>
    requestMeetingAdmission(
      a,
      id(req),
      workHubCommandEnvelopeSchema.parse(req.body),
    ),
  ),
);
router.post(
  "/work-hub/live-meetings/:occurrenceId/admission/:userId",
  route((req, a) =>
    decideMeetingAdmission(
      a,
      id(req),
      z.coerce.number().int().positive().parse(req.params.userId),
      workHubCommandEnvelopeSchema.parse(req.body),
    ),
  ),
);
router.post(
  "/work-hub/live-meetings/:occurrenceId/invitations",
  route((req, a) =>
    inviteLiveMeetingMembers(
      a,
      id(req),
      workHubCommandEnvelopeSchema.parse(req.body),
    ),
  ),
);
router.patch(
  "/work-hub/live-meetings/:occurrenceId/admission-mode",
  route((req, a) =>
    changeMeetingAdmission(
      a,
      id(req),
      workHubCommandEnvelopeSchema.parse(req.body),
    ),
  ),
);
export default router;
