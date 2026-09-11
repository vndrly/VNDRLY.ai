import { createHash } from "node:crypto";
import {
  exportRequestSchema,
  workHubExportCreateSchema,
  workHubExportStatusSchema,
  type WorkHubExportCreate,
  type WorkHubExportStatus,
} from "@workspace/api-zod";
import type { WorkHubAccess } from "./context-access";
import type { WorkHubExportRow } from "./governance-export-reader";

export type ExportJobStatus = "pending" | "running" | "completed" | "failed" | "expired";
export type ExportJobRecord = {
  id: string; ownerOrgType: "vendor" | "partner"; ownerOrgId: number;
  requesterUserId: number | null; requesterIdSnapshot: string; requesterDisplaySnapshot: string;
  requestSource: "web" | "ios"; operationId: string; dataset: string; format: string;
  scope: Record<string, unknown>; snapshotAt: Date; status: ExportJobStatus; attemptCount: number;
  availableAt: Date; leaseExpiresAt: Date | null; startedAt: Date | null; finishedAt: Date | null;
  artifactStorageKey: string | null; artifactFileName: string | null; artifactContentType: string | null;
  artifactSha256: string | null; rowCount: number | null; byteCount: number | null;
  generatedAt: Date | null; expiresAt: Date | null; errorCode: string | null; failureDetail: string | null;
  createdAt: Date; updatedAt: Date;
};

type Requester = { userId: number; displayName: string; source: "web" | "ios" };
type Artifact = { bytes: Buffer; contentType: string; fileName: string; sha256: string; manifest: unknown };
export type ExportLifecycleDependencies = {
  now: () => Date;
  repository: {
    /** Atomically persists a new job and its export.requested audit row. */
    create(input: { requester: Requester; request: WorkHubExportCreate; snapshotAt: Date }): Promise<{ job: ExportJobRecord; replayed: boolean }>;
    findForRequester(jobId: string, requesterUserId: number): Promise<ExportJobRecord | null>;
    claimNext(now: Date, leaseUntil: Date, maximumAttempts: number): Promise<ExportJobRecord | null>;
    /** Atomically publishes the artifact metadata and export.generated audit row. */
    complete(job: ExportJobRecord, leaseExpiresAt: Date, artifact: { artifactStorageKey: string; artifactFileName: string; artifactContentType: string; artifactSha256: string; rowCount: number; byteCount: number; generatedAt: Date }): Promise<boolean>;
    /** Atomically persists the retry/failure transition and export.failed audit row. */
    fail(job: ExportJobRecord, leaseExpiresAt: Date, failure: { status: "pending" | "failed"; observedAt: Date; availableAt: Date; errorCode: string; failureDetail: string }): Promise<boolean | void>;
    recoverStale(now: Date, maximumAttempts: number): Promise<number>;
  };
  storage: {
    putObject(key: string, contentType: string, body: Buffer, acl: { owner: string; visibility: "private" }): Promise<void>;
    getObject(key: string): Promise<{ body: Buffer; contentType: string; size?: number; acl: { owner: string; visibility: string } | null } | null>;
    deleteObject(key: string): Promise<void>;
  };
  authorize(job: ExportJobRecord): Promise<WorkHubAccess>;
  readRows(input: { job: ExportJobRecord; access: WorkHubAccess }): Promise<WorkHubExportRow[]>;
  buildArtifact(input: { job: ExportJobRecord; rows: WorkHubExportRow[]; generatedAt: Date }): Promise<Artifact>;
  audit(input: { actorUserId: number | null; owner: { type: "vendor" | "partner"; id: number }; action: string; subjectType: string; subjectId: string; source: "web" | "ios" | "worker"; operationId?: string; metadata?: Record<string, unknown> }): Promise<void>;
  metric?(input: { owner: { type: "vendor" | "partner"; id: number }; metric: "export.duration_ms" | "export.row_count" | "export.byte_count" | "export.completed" | "export.failed" | "export.expired" | "export.retry_count" | "authorization.denied" | "owner_context.mismatch"; dimensions: { dataset?: WorkHubExportCreate["export"]["dataset"]; format?: WorkHubExportCreate["export"]["format"]; phase: "request" | "generate" | "download"; source: "web" | "ios" | "worker"; status: "pending" | "completed" | "failed" | "expired"; errorCode?: "access_denied" | "owner_context_mismatch" | "configuration_unavailable" | "invalid_scope" | "scope_too_large" | "access_changed" | "storage_write_failed" | "checksum_mismatch" | "publication_failed" | "lease_expired" | "internal_failure" }; value: number; observedAt: Date }): Promise<void>;
};

export class ExportLifecycleError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

function keySegment(value: string | number): string {
  return Buffer.from(String(value), "utf8").toString("base64url");
}
export function exportObjectPath(job: Pick<ExportJobRecord, "id" | "ownerOrgType" | "ownerOrgId" | "attemptCount">, leaseExpiresAt: Date): string {
  return `/objects/work-hub/exports/${keySegment(job.ownerOrgType)}/${keySegment(job.ownerOrgId)}/${keySegment(job.id)}/attempt-${keySegment(job.attemptCount)}-${keySegment(leaseExpiresAt.getTime())}`;
}
function sentinel(jobId: string) { return `work-hub-export:${jobId}`; }
function safeFailure(error: unknown): { code: string; detail: string } {
  const candidate = error as { code?: unknown };
  const raw = typeof candidate?.code === "string" ? candidate.code.replace(/^export\./, "") : "";
  const code = raw === "work_hub.forbidden" || raw === "work_hub.not_found" ? "access_changed" : ["configuration_unavailable", "invalid_scope", "scope_too_large", "access_changed", "storage_write_failed", "checksum_mismatch", "publication_failed", "lease_expired", "internal_failure"].includes(raw) ? raw : "internal_failure";
  return { code, detail: code === "internal_failure" ? "Export generation failed" : `Export generation failed: ${code}` };
}
function projection(job: ExportJobRecord, now: Date): WorkHubExportStatus {
  const status = job.expiresAt && job.expiresAt <= now ? "expired" : job.status;
  return workHubExportStatusSchema.parse({
    id: job.id, dataset: job.dataset, format: job.format, status,
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
    rowCount: job.rowCount, byteCount: job.byteCount,
    expiresAt: job.expiresAt?.toISOString(), fileName: job.artifactFileName,
    errorCode: job.errorCode,
  });
}

export function createExportLifecycle(deps: ExportLifecycleDependencies) {
  const maximumAttempts = 3;
  const emitMetric = async (input: Parameters<NonNullable<ExportLifecycleDependencies["metric"]>>[0]) => {
    try { await deps.metric?.(input); } catch { /* observability must not break the governed operation */ }
  };
  const dimensions = (job: Pick<ExportJobRecord, "dataset" | "format" | "requestSource">, phase: "request" | "generate" | "download", status: "pending" | "completed" | "failed" | "expired", errorCode?: Parameters<NonNullable<ExportLifecycleDependencies["metric"]>>[0]["dimensions"]["errorCode"]) => ({ dataset: job.dataset as WorkHubExportCreate["export"]["dataset"], format: job.format as WorkHubExportCreate["export"]["format"], phase, source: phase === "generate" ? "worker" as const : job.requestSource, status, ...(errorCode ? { errorCode } : {}) });
  const authorizeWithMetric = async (job: ExportJobRecord, phase: "request" | "generate" | "download") => {
    try { return await deps.authorize(job); }
    catch (error) {
      const code = (error as { code?: unknown })?.code === "owner_context_mismatch" ? "owner_context_mismatch" as const : "access_denied" as const;
      const metric = code === "owner_context_mismatch" ? "owner_context.mismatch" as const : "authorization.denied" as const;
      await emitMetric({ owner: { type: job.ownerOrgType, id: job.ownerOrgId }, metric, dimensions: dimensions(job, phase, "failed", code), value: 1, observedAt: deps.now() });
      throw error;
    }
  };
  return {
    async request(input: { requester: Requester; body: unknown }) {
      let request: WorkHubExportCreate;
      const parsed = workHubExportCreateSchema.safeParse(input.body);
      if (!parsed.success) {
        const expiryIssue = parsed.error.issues.some((issue) => issue.path[0] === "expiresAt");
        throw new ExportLifecycleError(expiryIssue ? "export.expiry_required" : "invalid_scope", 400, expiryIssue ? "A valid export expiry is required" : "Invalid export request");
      }
      request = parsed.data;
      const expiresAt = new Date(request.expiresAt);
      const snapshotAt = deps.now();
      if (expiresAt <= snapshotAt) throw new ExportLifecycleError("export.expiry_invalid", 400, "Export expiry must be in the future");
      const authorizationJob = { ownerOrgType: request.owner.type, ownerOrgId: request.owner.id, requesterUserId: input.requester.userId } as ExportJobRecord;
      await authorizeWithMetric({ ...authorizationJob, dataset: request.export.dataset, format: request.export.format, requestSource: input.requester.source } as ExportJobRecord, "request");
      const result = await deps.repository.create({ requester: input.requester, request, snapshotAt });
      const observedAt = deps.now();
      await emitMetric({ owner: request.owner, metric: "export.duration_ms", dimensions: dimensions({ dataset: request.export.dataset, format: request.export.format, requestSource: input.requester.source }, "request", "completed"), value: Math.max(0, observedAt.getTime() - snapshotAt.getTime()), observedAt });
      return { job: projection(result.job, snapshotAt), replayed: result.replayed };
    },
    async status(input: { jobId: string; requesterUserId: number }) {
      const job = await deps.repository.findForRequester(input.jobId, input.requesterUserId);
      if (!job) throw new ExportLifecycleError("export.not_found", 404, "Export not found");
      await authorizeWithMetric(job, "download");
      return projection(job, deps.now());
    },
    async download(input: { jobId: string; requesterUserId: number }) {
      const startedAt = deps.now();
      const job = await deps.repository.findForRequester(input.jobId, input.requesterUserId);
      if (!job) throw new ExportLifecycleError("export.not_found", 404, "Export not found");
      await authorizeWithMetric(job, "download");
      if (!job.expiresAt || job.expiresAt <= startedAt) {
        await emitMetric({ owner: { type: job.ownerOrgType, id: job.ownerOrgId }, metric: "export.expired", dimensions: dimensions(job, "download", "expired"), value: 1, observedAt: startedAt });
        throw new ExportLifecycleError("export.expired", 410, "Export expired");
      }
      if (job.status !== "completed" || !job.artifactStorageKey || !job.artifactSha256 || job.byteCount == null || !job.artifactFileName || !job.artifactContentType) throw new ExportLifecycleError("export.not_ready", 409, "Export is not ready");
      const object = await deps.storage.getObject(job.artifactStorageKey);
      if (!object || object.acl?.owner !== sentinel(job.id) || object.acl.visibility !== "private" || object.body.length !== job.byteCount || createHash("sha256").update(object.body).digest("hex") !== job.artifactSha256) throw new ExportLifecycleError("export.checksum_mismatch", 409, "Export integrity check failed");
      await deps.audit({ actorUserId: input.requesterUserId, owner: { type: job.ownerOrgType, id: job.ownerOrgId }, action: "export.downloaded", subjectType: "work_hub_export", subjectId: job.id, source: job.requestSource, operationId: job.operationId, metadata: { dataset: job.dataset, format: job.format } });
      const observedAt = deps.now();
      await emitMetric({ owner: { type: job.ownerOrgType, id: job.ownerOrgId }, metric: "export.duration_ms", dimensions: dimensions(job, "download", "completed"), value: Math.max(0, observedAt.getTime() - startedAt.getTime()), observedAt });
      return { body: object.body, contentType: job.artifactContentType, fileName: job.artifactFileName };
    },
    async runOne() {
      const started = deps.now();
      const job = await deps.repository.claimNext(started, new Date(started.getTime() + 5 * 60_000), maximumAttempts);
      if (!job || !job.leaseExpiresAt) return false;
      const lease = job.leaseExpiresAt;
      try {
        const access = await authorizeWithMetric(job, "generate");
        exportRequestSchema.parse({ dataset: job.dataset, format: job.format, scope: job.scope });
        const rows = await deps.readRows({ job, access });
        const generatedAt = deps.now();
        const artifact = await deps.buildArtifact({ job, rows, generatedAt });
        const key = exportObjectPath(job, lease);
        try {
          await deps.storage.putObject(key, artifact.contentType, artifact.bytes, { owner: sentinel(job.id), visibility: "private" });
        } catch {
          throw new ExportLifecycleError("storage_write_failed", 503, "Export storage write failed");
        }
        const stored = await deps.storage.getObject(key);
        if (!stored || stored.acl?.owner !== sentinel(job.id) || stored.acl.visibility !== "private" || stored.body.length !== artifact.bytes.length || createHash("sha256").update(stored.body).digest("hex") !== artifact.sha256) throw new ExportLifecycleError("checksum_mismatch", 409, "Stored export integrity check failed");
        const published = await deps.repository.complete(job, lease, { artifactStorageKey: key, artifactFileName: artifact.fileName, artifactContentType: artifact.contentType, artifactSha256: artifact.sha256, rowCount: rows.length, byteCount: artifact.bytes.length, generatedAt });
        if (!published) {
          try { await deps.storage.deleteObject(key); } catch { /* sentinel ACL keeps an unremoved orphan private */ }
          return true;
        }
        const completedAt = deps.now();
        for (const [metric, value] of [["export.duration_ms", Math.max(0, completedAt.getTime() - started.getTime())], ["export.row_count", rows.length], ["export.byte_count", artifact.bytes.length], ["export.completed", 1]] as const) {
          await emitMetric({ owner: { type: job.ownerOrgType, id: job.ownerOrgId }, metric, dimensions: dimensions(job, "generate", "completed"), value, observedAt: completedAt });
        }
      } catch (error) {
        const failure = safeFailure(error);
        const retry = job.attemptCount < maximumAttempts;
        const observedAt = deps.now();
        await deps.repository.fail(job, lease, { status: retry ? "pending" : "failed", observedAt, availableAt: retry ? new Date(observedAt.getTime() + 30_000) : observedAt, errorCode: failure.code, failureDetail: failure.detail.slice(0, 512) });
        const status = retry ? "pending" as const : "failed" as const;
        const errorCode = failure.code as Parameters<NonNullable<ExportLifecycleDependencies["metric"]>>[0]["dimensions"]["errorCode"];
        await emitMetric({ owner: { type: job.ownerOrgType, id: job.ownerOrgId }, metric: "export.failed", dimensions: dimensions(job, "generate", status, errorCode), value: 1, observedAt });
        if (retry) await emitMetric({ owner: { type: job.ownerOrgType, id: job.ownerOrgId }, metric: "export.retry_count", dimensions: dimensions(job, "generate", status, errorCode), value: 1, observedAt });
      }
      return true;
    },
    recoverStale: () => deps.repository.recoverStale(deps.now(), maximumAttempts),
  };
}
