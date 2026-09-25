import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { ExportLifecycleError } from "../work-hub/governance-export-lifecycle";
import { areWorkHubExportsEnabled, workHubExportLifecycle } from "../work-hub/governance-export-runtime";
import { buildImplementationAExport, previewImplementationAExport, type ImplementationAExportDataset } from "../services/implementation-a-exports";
import { recordExport } from "../lib/reports/audit";
import { allowedExportDatasets, type ExportDataset } from "../work-hub/capabilities";
import { deriveWorkHubCapabilities } from "../work-hub/context-access";


type ImplementationAOwner = { type: "vendor" | "partner"; id: number };
const rowsOf = <T>(value: unknown): T[] => ((value as { rows?: T[] }).rows ?? value) as T[];
const implementationADatasetGrants: Record<ImplementationAExportDataset, ExportDataset> = {
  payroll: "payroll-hours",
  "quickbooks-time": "quickbooks-time",
  assets: "inventory-custody",
  staffing: "staffing",
  safety: "safety-response",
};
function authorizeImplementationAExport(req: Request): { owner: ImplementationAOwner; dataset: ImplementationAExportDataset } | null {
  const dataset = req.body?.dataset as ImplementationAExportDataset;
  if (!Object.prototype.hasOwnProperty.call(implementationADatasetGrants, dataset)) return null;
  const type = req.body?.scope?.ownerOrgType;
  const id = Number(req.body?.scope?.ownerOrgId);
  if ((type !== "vendor" && type !== "partner") || !Number.isSafeInteger(id) || id <= 0) return null;
  const session = getSessionFromRequest(req);
  if (!session?.userId || (type === "vendor" ? session.vendorId !== id : session.partnerId !== id)) return null;
  const owner: ImplementationAOwner = { type, id };
  const capabilities = new Set(deriveWorkHubCapabilities({
    session: { ...session, userId: session.userId },
    owner,
    context: { kind: "organization", id },
    participant: true,
  }));
  if (!allowedExportDatasets(capabilities).includes(implementationADatasetGrants[dataset])) return null;
  return { owner, dataset };
}
async function loadImplementationAExportRows(dataset: ImplementationAExportDataset, owner: ImplementationAOwner): Promise<Array<Record<string, unknown> & { ownerOrgId: number }>> {
  if (dataset === "assets") return rowsOf(await db.execute(sql`SELECT responsible_org_id AS "ownerOrgId", id::text AS "assetId", name, category, status, current_holder_user_id::text AS holder, COALESCE((SELECT condition FROM asset_custody_events WHERE asset_id = assets.id ORDER BY occurred_at DESC LIMIT 1), '') AS condition FROM assets WHERE responsible_org_type = ${owner.type} AND responsible_org_id = ${owner.id} AND retired_at IS NULL ORDER BY created_at, id`));
  if (dataset === "staffing") return rowsOf(await db.execute(sql`SELECT s.owner_org_id AS "ownerOrgId", s.id::text AS "assignmentId", COALESCE(u.display_name, u.username, 'Worker ' || a.user_id::text) AS worker, '' AS employer, '' AS sponsor, COALESCE(s.project_name, s.title) AS site, s.starts_at AS "startsAt", s.ends_at AS "endsAt", a.status FROM work_hub_shift_assignments a JOIN work_hub_shifts s ON s.id = a.shift_id LEFT JOIN users u ON u.id = a.user_id WHERE s.owner_org_type = ${owner.type} AND s.owner_org_id = ${owner.id} ORDER BY s.starts_at, a.id`));
  if (dataset === "safety") { const ownerClause = owner.type === "vendor" ? sql`e.vendor_id = ${owner.id}` : sql`e.partner_id = ${owner.id}`; return rowsOf(await db.execute(sql`SELECT ${owner.id}::int AS "ownerOrgId", e.site_location_id AS "siteId", e.event_number AS "eventId", e.created_at AS "reportedAt", COALESCE(r.severity, CASE WHEN e.is_high_potential THEN 'urgent' ELSE 'standard' END) AS severity, COALESCE(r.response_status, e.status) AS status, CASE WHEN r.acknowledged_at IS NULL THEN 'Awaiting acknowledgement' ELSE 'Acknowledged' END AS acknowledgement FROM safety_events e LEFT JOIN safety_incident_responses r ON r.event_id = e.id WHERE ${ownerClause} ORDER BY e.created_at, e.id`)); }
  return rowsOf(await db.execute(sql`SELECT org_id AS "ownerOrgId", data->>'managedOrganizationId' AS "managedOrganizationId", NULLIF(data->>'siteId', '')::int AS "siteId", data->>'worker' AS worker, data->>'employer' AS employer, data->>'sponsor' AS sponsor, data->>'site' AS site, COALESCE(NULLIF(data->>'hours', '')::numeric, 0) AS hours, data->>'payRate' AS "payRate" FROM work_hub_finance_records WHERE org_type = ${owner.type} AND org_id = ${owner.id} AND kind IN ('time_entry', 'payroll_hours', 'worker_hours') ORDER BY created_at, id`));
}
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
  router.post("/work-hub/exports/implementation-a", async (req, res) => {
    const requester = actor(req);
    if (!requester) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
    let authorized: ReturnType<typeof authorizeImplementationAExport>;
    try { authorized = authorizeImplementationAExport(req); }
    catch (error) { return failure(res, error); }
    if (!authorized) return sendApiError(res, 403, "work_hub.forbidden", "Export access denied");
    const { dataset, owner } = authorized;
    const scope = { ownerOrgId: owner.id, managedOrganizationId: typeof req.body?.scope?.managedOrganizationId === "string" ? req.body.scope.managedOrganizationId : undefined, siteIds: Array.isArray(req.body?.scope?.siteIds) ? req.body.scope.siteIds.filter((id: unknown): id is number => Number.isSafeInteger(id)) : undefined };
    const artifact = buildImplementationAExport({ dataset, scope, rows: await loadImplementationAExportRows(dataset, owner), includeSensitivePayroll: req.body?.includeSensitivePayroll === true });
    const body = Buffer.from(artifact.csv, "utf8");
    await recordExport({ req, reportKind: `implementation_a_${dataset}`, format: "csv", scope: artifact.audit.scope, rowCount: artifact.audit.rowCount, fileBytes: body.length, detailJson: { hash: artifact.sha256, result: artifact.audit.result } });
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="vndrly-${dataset}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return res.send(body);
  });
  router.post("/work-hub/exports/implementation-a/preview", async (req, res) => {
    const requester = actor(req);
    if (!requester) return sendApiError(res, 401, "auth.unauthenticated", "Authentication required");
    let authorized: ReturnType<typeof authorizeImplementationAExport>;
    try { authorized = authorizeImplementationAExport(req); }
    catch (error) { return failure(res, error); }
    if (!authorized) return sendApiError(res, 403, "work_hub.forbidden", "Export access denied");
    const { dataset, owner } = authorized;
    return res.json(previewImplementationAExport({ dataset, scope: { ownerOrgId: owner.id, managedOrganizationId: typeof req.body?.scope?.managedOrganizationId === "string" ? req.body.scope.managedOrganizationId : undefined, siteIds: Array.isArray(req.body?.scope?.siteIds) ? req.body.scope.siteIds.filter((id: unknown) => Number.isSafeInteger(id)) : undefined }, includeSensitivePayroll: req.body?.includeSensitivePayroll === true }));
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
