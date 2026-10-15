import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import { type LibraryActor } from "../work-hub/library-core";
import {
  listLibrary,
  getLibrary,
  saveLibrary,
  reviseLibrary,
  changeLibraryState,
} from "../work-hub/library-service";
import { libraryOptions } from "../work-hub/library-audience";
import {
  previewLibraryAssignment,
  assignLibrary,
  employeeChecklist,
  ownerLibraryAssignments,
  cancelLibraryAssignment,
  ownerAssignmentDetail,
  libraryPollResults,
} from "../work-hub/library-assignments";
import {
  getAssignedLibrary,
  submitAssignedLibrary,
  resetTrainingAttempts,
  assignedLibraryFile,
} from "../work-hub/training-service";
import {
  ensureOnboarding,
  updateOnboardingRule,
  markLibraryPresented,
} from "../work-hub/onboarding-service";
const router = Router();
function actor(req: Request): LibraryActor {
  const session = getSessionFromRequest(req);
  if (!session?.userId)
    throw Object.assign(Error("Authentication required"), { status: 401 });
  return {
    ...session,
    userId: session.userId,
    source: req.header("x-vndrly-client") === "ios" ? "ios" : "web",
  };
}
const item = (r: Request) => z.uuid().parse(r.params.itemId),
  instance = (r: Request) => z.uuid().parse(r.params.instanceId),
  body = (r: Request) => workHubCommandEnvelopeSchema.parse(r.body);
function handle(run: (r: Request, a: LibraryActor) => Promise<unknown>) {
  return async (r: Request, s: Response) => {
    s.setHeader("Cache-Control", "private, no-store");
    try {
      return s.json(await run(r, actor(r)));
    } catch (e) {
      const error = e as Error & { status?: number };
      return s
        .status(e instanceof z.ZodError ? 400 : (error.status ?? 500))
        .json({
          error:
            e instanceof z.ZodError
              ? "Invalid library request"
              : error.status
                ? error.message
                : "Work Hub library request unavailable",
        });
    }
  };
}
router.get(
  "/work-hub/library",
  handle((r, a) =>
    listLibrary(a, r.query.archived === "true", r.query.published === "true"),
  ),
);
router.get(
  "/work-hub/library/options",
  handle((_r, a) => libraryOptions(a)),
);
router.get(
  "/work-hub/library/to-complete",
  handle((_r, a) => employeeChecklist(a)),
);
router.post(
  "/work-hub/library/entry",
  handle((_r, a) => ensureOnboarding(a)),
);
router.get(
  "/work-hub/library/assignments/:instanceId",
  handle((r, a) => ownerAssignmentDetail(a, instance(r))),
);
router.get(
  "/work-hub/library/assignments",
  handle((_r, a) => ownerLibraryAssignments(a)),
);
router.post(
  "/work-hub/library/assignment-preview",
  handle((r, a) => previewLibraryAssignment(a, r.body)),
);
router.post(
  "/work-hub/library/assign",
  handle((r, a) => assignLibrary(a, body(r))),
);
router.post(
  "/work-hub/library",
  handle((r, a) => saveLibrary(a, body(r))),
);
router.post(
  "/work-hub/bundles",
  handle((r, a) => saveLibrary(a, body(r), undefined, true)),
);
router.get(
  "/work-hub/bundles",
  handle(async (_r, a) => ({
    items: (await listLibrary(a)).items.filter((i) => i.kind === "bundle"),
  })),
);
router.get(
  "/work-hub/library/instances/:instanceId",
  handle((r, a) => getAssignedLibrary(a, instance(r))),
);
router.post(
  "/work-hub/library/instances/:instanceId/presented",
  handle((r, a) => markLibraryPresented(a, instance(r), body(r))),
);
router.post(
  "/work-hub/library/instances/:instanceId/progress",
  handle((r, a) => submitAssignedLibrary(a, instance(r), body(r), "progress")),
);
router.post(
  "/work-hub/library/instances/:instanceId/attempt",
  handle((r, a) => submitAssignedLibrary(a, instance(r), body(r), "attempt")),
);
router.post(
  "/work-hub/library/instances/:instanceId/complete",
  handle((r, a) => submitAssignedLibrary(a, instance(r), body(r), "complete")),
);
router.post(
  "/work-hub/library/instances/:instanceId/cancel",
  handle((r, a) => cancelLibraryAssignment(a, instance(r), body(r))),
);
router.post(
  "/work-hub/library/instances/:instanceId/exempt",
  handle((r, a) => cancelLibraryAssignment(a, instance(r), body(r), true)),
);
router.post(
  "/work-hub/library/instances/:instanceId/attempt-reset",
  handle((r, a) => resetTrainingAttempts(a, instance(r), body(r))),
);
router.get(
  "/work-hub/library/instances/:instanceId/files/:fileId",
  async (r, s) => {
    s.setHeader("Cache-Control", "private, no-store");
    try {
      const f = await assignedLibraryFile(
        actor(r),
        instance(r),
        z.uuid().parse(r.params.fileId),
      );
      s.setHeader("Content-Type", f.contentType);
      s.setHeader("Content-Length", String(f.byteSize));
      s.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      );
      s.setHeader("X-Content-Type-Options", "nosniff");
      return s.send(f.body);
    } catch (e) {
      const err = e as Error & { status?: number };
      return s
        .status(err.status ?? 400)
        .json({ error: "Assigned attachment unavailable" });
    }
  },
);
router.get(
  "/work-hub/library/:itemId/results",
  handle((r, a) => libraryPollResults(a, item(r))),
);
router.get(
  "/work-hub/library/:itemId",
  handle((r, a) => getLibrary(a, item(r))),
);
router.patch(
  "/work-hub/library/:itemId",
  handle((r, a) => saveLibrary(a, body(r), item(r))),
);
router.patch(
  "/work-hub/bundles/:itemId",
  handle((r, a) => saveLibrary(a, body(r), item(r), true)),
);
router.get(
  "/work-hub/bundles/:itemId",
  handle((r, a) => getLibrary(a, item(r))),
);
router.post(
  "/work-hub/library/:itemId/revise",
  handle((r, a) => reviseLibrary(a, item(r), body(r))),
);
router.post(
  "/work-hub/library/:itemId/publish",
  handle((r, a) => changeLibraryState(a, item(r), body(r), "publish")),
);
router.post(
  "/work-hub/library/:itemId/archive",
  handle((r, a) => changeLibraryState(a, item(r), body(r), "archive")),
);
router.post(
  "/work-hub/bundles/:itemId/onboarding-rule",
  handle((r, a) => updateOnboardingRule(a, item(r), body(r))),
);
export default router;
