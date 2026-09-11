import { Router, type IRouter, type Request, type Response } from "express";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { ExportLifecycleError } from "../work-hub/governance-export-lifecycle";
import { areWorkHubExportsEnabled, workHubExportLifecycle } from "../work-hub/governance-export-runtime";

type Lifecycle = {
  request(input: { requester: { userId: number; displayName: string; source: "web" | "ios" }; body: unknown }): Promise<{ job: unknown; replayed: boolean }>;
  status(input: { jobId: string; requesterUserId: number }): Promise<unknown>;
  download(input: { jobId: string; requesterUserId: number }): Promise<{ body: Buffer; contentType: string; fileName: string }>;
};
export type WorkHubExportsRouterDependencies = { lifecycle: Lifecycle; exportsEnabled(): Promise<boolean> };

function source(req: Request): "web" | "ios" { return req.header("x-vndrly-client") === "ios" ? "ios" : "web"; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exportId(req: Request, res: Response): string | null {
  const id = req.params.id;
  if (typeof id !== "string" || !UUID.test(id)) {
    sendApiError(res, 400, "validation.invalid_request", "Invalid export ID");
    return null;
  }
  return id;
}
function safeFileName(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 255) || "vndrly-export"; }
function actor(req: Request) {
  const session = getSessionFromRequest(req);
  return session?.userId ? { userId: session.userId, displayName: session.displayName?.trim() || `User ${session.userId}` } : null;
}
function failure(res: Response, error: unknown) {
  if (error instanceof ExportLifecycleError) return sendApiError(res, error.status, error.code, error.message);
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if ((candidate.status === 403 || candidate.status === 404) && typeof candidate.code === "string") return sendApiError(res, candidate.status, candidate.code, typeof candidate.message === "string" ? candidate.message : "Export unavailable");
  throw error;
}

export function createWorkHubExportsRouter(deps: WorkHubExportsRouterDependencies): IRouter {
  const router = Router();
  router.use("/work-hub/exports", async (req, res, next) => {
    if (!(await deps.exportsEnabled())) return sendApiError(res, 404, "work_hub.not_found", "Not found");
    return next();
  });
  router.post("/work-hub/exports", async (req, res) => {
    const requester = actor(req);
    if (!requester) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
    try {
      const result = await deps.lifecycle.request({ requester: { ...requester, source: source(req) }, body: req.body });
      return res.status(result.replayed ? 200 : 202).json(result.job);
    } catch (error) { return failure(res, error); }
  });
  router.get("/work-hub/exports/:id", async (req, res) => {
    const requester = actor(req);
    if (!requester) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
    const jobId = exportId(req, res);
    if (!jobId) return;
    try { return res.json(await deps.lifecycle.status({ jobId, requesterUserId: requester.userId })); }
    catch (error) { return failure(res, error); }
  });
  router.get("/work-hub/exports/:id/download", async (req, res) => {
    const requester = actor(req);
    if (!requester) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
    const jobId = exportId(req, res);
    if (!jobId) return;
    try {
      const file = await deps.lifecycle.download({ jobId, requesterUserId: requester.userId });
      res.set({ "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${safeFileName(file.fileName)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" });
      return res.send(file.body);
    } catch (error) { return failure(res, error); }
  });
  return router;
}

export default createWorkHubExportsRouter({ lifecycle: workHubExportLifecycle, exportsEnabled: areWorkHubExportsEnabled });
