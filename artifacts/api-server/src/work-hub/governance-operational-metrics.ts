import { createHash } from "node:crypto";
import { createOperationalMetricEvent, operationalMetricReadQuerySchema, operationalMetricReadoutSchema, type WorkHubGovernanceOwner, type WorkHubOperationalMetric, type WorkHubOperationalMetricEvent, type WorkHubOperationalMetricReadQuery, type WorkHubOperationalMetricReadout } from "@workspace/api-zod";

export type OperationalMetricBucketRow = { metricName: string; intervalStart: Date; dimensions: Record<string, string>; count: number; sum: number; max: number; ownerOrgType?: string; ownerOrgId?: number; dimensionHash?: string };
type MetricUpsert = { owner: WorkHubGovernanceOwner; metric: WorkHubOperationalMetric["metric"]; intervalStart: Date; dimensions: WorkHubOperationalMetric["dimensions"]; dimensionHash: string; count: 1; sum: number; max: number; observedAt: Date };
const DIMENSION_ORDER = ["dataset", "format", "phase", "source", "status", "errorCode"] as const;

function canonicalDimensions(dimensions: WorkHubOperationalMetric["dimensions"]): WorkHubOperationalMetric["dimensions"] {
  return Object.fromEntries(DIMENSION_ORDER.flatMap((key) => dimensions[key] === undefined ? [] : [[key, dimensions[key]]])) as WorkHubOperationalMetric["dimensions"];
}

export function createOperationalMetricRecorder(deps: { upsert(input: MetricUpsert): Promise<void> }) {
  return async (raw: Omit<WorkHubOperationalMetricEvent, "observedAt"> & { observedAt: Date }) => {
    const event = createOperationalMetricEvent({ ...raw, observedAt: raw.observedAt.toISOString() });
    const dimensions = canonicalDimensions(event.dimensions);
    const intervalStart = new Date(event.observedAt);
    intervalStart.setUTCMinutes(0, 0, 0);
    await deps.upsert({ owner: event.owner, metric: event.metric, intervalStart, dimensions, dimensionHash: createHash("sha256").update(JSON.stringify(dimensions)).digest("hex"), count: 1, sum: event.value, max: event.value, observedAt: new Date(event.observedAt) });
  };
}

type MetricsDependencies = {
  authorizeOwnerAdmin(userId: number, owner: WorkHubGovernanceOwner): Promise<void>;
  authorizePlatformAdmin(userId: number): Promise<void>;
  readOwner(input: { owner: WorkHubGovernanceOwner; from: Date; to: Date }): Promise<OperationalMetricBucketRow[]>;
  readPlatform(input: { from: Date; to: Date }): Promise<OperationalMetricBucketRow[]>;
};

function project(query: WorkHubOperationalMetricReadQuery, rows: OperationalMetricBucketRow[]): WorkHubOperationalMetricReadout {
  if (rows.length > 10_000) throw new Error("Metric query returned too many aggregate buckets");
  return operationalMetricReadoutSchema.parse({ from: query.from, to: query.to, buckets: rows.map((row) => ({ metric: row.metricName, intervalStart: row.intervalStart.toISOString(), dimensions: row.dimensions, count: Number(row.count), sum: Number(row.sum), max: Number(row.max) })) });
}

export function createOperationalMetricsService(deps: MetricsDependencies) {
  return {
    async readOwner(input: { actorUserId: number; owner: WorkHubGovernanceOwner; query: unknown }) {
      const query = operationalMetricReadQuerySchema.parse(input.query);
      await deps.authorizeOwnerAdmin(input.actorUserId, input.owner);
      return project(query, await deps.readOwner({ owner: input.owner, from: new Date(query.from), to: new Date(query.to) }));
    },
    async readPlatform(input: { actorUserId: number; query: unknown }) {
      const query = operationalMetricReadQuerySchema.parse(input.query);
      await deps.authorizePlatformAdmin(input.actorUserId);
      return project(query, await deps.readPlatform({ from: new Date(query.from), to: new Date(query.to) }));
    },
  };
}
