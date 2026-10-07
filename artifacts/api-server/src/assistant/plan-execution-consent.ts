import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { currentPlanExecutionAuthority } from "./plan-execution-authorization";
import { withPlanExecutionRecords } from "./plan-execution-store";
import { storedPlanExecutionSchema } from "./plan-execution-repository";
import { createPlanExecution, planExecutionAuthorizationSchema, planExecutionFingerprint, type PlanExecutionAuthorization } from "./plan-execution";

const envelopeSchema = z.object({ purpose: z.literal("plan-execution-review-v1"), proposal: planExecutionAuthorizationSchema, reviewExpiresAt: z.number().int().positive() }).strict();
type Dependencies = { secret: string; now: () => number; authorize: typeof currentPlanExecutionAuthority; withRecords: typeof withPlanExecutionRecords };
function bind(proposal: PlanExecutionAuthorization, session: SessionPayload) {
  const organizationKey = session.role === "partner" && session.partnerId ? `partner:${session.partnerId}` : session.vendorId ? `vendor:${session.vendorId}` : null;
  if (session.userId !== proposal.requester.userId || organizationKey !== proposal.requester.organizationKey || session.activeMembershipId !== proposal.requester.membershipId || session.sv !== proposal.requester.sessionVersion) throw Error("Execution review account changed");
}
function proposalHash(value: PlanExecutionAuthorization) { const { approvedAt: _unused, ...proposal } = value; return planExecutionFingerprint(proposal); }
/** Signed review is not a runnable delegation. Only authenticated approval persists a run. */
export function createPlanExecutionConsentService(input: Pick<Dependencies, "secret"> & Partial<Omit<Dependencies, "secret">>) {
  if (input.secret.length < 32) throw Error("Execution signing secret unavailable");
  const deps: Dependencies = { now: Date.now, authorize: currentPlanExecutionAuthority, withRecords: withPlanExecutionRecords, ...input };
  const signature = (payload: string) => createHmac("sha256", deps.secret).update(`plan-execution-review-v1:${payload}`).digest("hex");
  const reviewOf = (proposal: PlanExecutionAuthorization) => { const { approvedAt: _unused, grantReference: _private, ...review } = proposal; return review; };
  function matching(records: unknown[], id: string) {
    return records.flatMap((value, index) => {
      const parsed = storedPlanExecutionSchema.safeParse(value);
      if (!parsed.success) {
        if (value && typeof value === "object" && "run" in value) {
          const run = value.run;
          if (run && typeof run === "object" && "authorization" in run && run.authorization && typeof run.authorization === "object" && "id" in run.authorization && run.authorization.id === id) throw Error("Execution binding invalid");
        }
        return [];
      }
      return parsed.data.run.authorization.id === id ? [{ ...parsed.data, index }] : [];
    });
  }
  function decode(token: string) {
    if (token.length > 240000 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token)) throw Error("Invalid execution review");
    const [payload, supplied] = token.split(".");
    if (!timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(payload), "hex"))) throw Error("Invalid execution review signature");
    const envelope = envelopeSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (deps.now() >= envelope.reviewExpiresAt || envelope.reviewExpiresAt > deps.now() + 300000 || deps.now() >= envelope.proposal.expiresAt) throw Error("Execution review expired");
    return envelope;
  }
  async function exactRecord(id: string, session: SessionPayload, requireEffectAuthority = true) {
    if (!z.uuid().safeParse(id).success || !session.userId) throw Error("Execution unavailable");
    const run = await deps.withRecords(session.userId, async records => {
      const matches = matching(records, id);
      if (matches.length !== 1) throw Error("Execution unavailable");
      const value = matches[0].run;
      if (planExecutionFingerprint(value.authorization) !== value.authorizationHash) throw Error("Execution binding invalid");
      bind(value.authorization, session);
      return structuredClone(value);
    });
    if (requireEffectAuthority) await deps.authorize(run.authorization);
    return run;
  }
  return {
    async prepare(raw: unknown, session: SessionPayload) {
      const proposal = planExecutionAuthorizationSchema.parse(raw);
      bind(proposal, session); await deps.authorize(proposal);
      const reviewExpiresAt = Math.min(deps.now() + 300000, proposal.expiresAt);
      if (reviewExpiresAt <= deps.now()) throw Error("Execution review expired");
      const payload = Buffer.from(JSON.stringify({ purpose: "plan-execution-review-v1", proposal, reviewExpiresAt })).toString("base64url");
      return { state: "prepared" as const, executionStarted: false as const, proposal: reviewOf(proposal), reviewExpiresAt, token: `${payload}.${signature(payload)}` };
    },
    async getPrepared(token: string, session: SessionPayload) {
      const envelope = decode(token); bind(envelope.proposal, session);
      await deps.authorize(envelope.proposal);
      return { state: "prepared" as const, executionStarted: false as const, proposal: reviewOf(envelope.proposal), reviewExpiresAt: envelope.reviewExpiresAt };
    },
    async approve(token: string, session: SessionPayload) {
      const { proposal } = decode(token); bind(proposal, session);
      await deps.authorize(proposal);
      const now = deps.now();
      const approved = planExecutionAuthorizationSchema.parse({ ...proposal, approvedAt: now });
      return deps.withRecords(proposal.requester.userId, async records => {
        if (deps.now() >= decode(token).reviewExpiresAt) throw Error("Execution review expired");
        const matches = matching(records, proposal.id);
        if (matches.length > 1) throw Error("Execution conflict");
        if (matches[0]) {
          const run = matches[0].run;
          if (proposalHash(run.authorization) !== proposalHash(proposal) || planExecutionFingerprint(run.authorization) !== run.authorizationHash) throw Error("Execution approval conflict");
          return structuredClone(run);
        }
        const run = createPlanExecution(approved);
        records.push({ run, fence: 0, leaseUntil: 0 });
        return structuredClone(run);
      });
    },
    status: (id: string, session: SessionPayload) => exactRecord(id, session),
    async statusMetadata(id: string, session: SessionPayload, grantReference?: string) {
      const run = await exactRecord(id, session, false);
      if (grantReference !== undefined && grantReference !== run.authorization.grantReference) throw Error("Execution connection changed");
      return {
        reference: run.authorization.id, state: run.state, revision: run.revision,
        cancelRequested: run.cancelRequested,
        workerAttemptStarted: run.steps.some(step => step.attempts > 0),
        notificationSaved: run.notificationSaved,
        delegationExpiresAt: run.authorization.expiresAt,
        steps: run.steps.map(step => ({ id: step.id, state: step.state, attempts: step.attempts, reconciliationAttempts: step.reconciliationAttempts })),
      };
    },
    async cancel(id: string, session: SessionPayload) {
      // The HTTP caller validates current browser identity. Revocation must remain
      // possible after delegation expiry, grant revocation or a saved-plan edit.
      const checked = await exactRecord(id, session, false);
      return deps.withRecords(checked.authorization.requester.userId, async records => {
        const matches = matching(records, id);
        if (matches.length !== 1) throw Error("Execution unavailable");
        const { index, ...record } = matches[0];
        bind(record.run.authorization, session);
        if (record.run.authorizationHash !== checked.authorizationHash || planExecutionFingerprint(record.run.authorization) !== record.run.authorizationHash) throw Error("Execution binding changed");
        if (record.run.cancelRequested || record.run.state === "completed") return structuredClone(record.run);
        if (record.fence >= Number.MAX_SAFE_INTEGER || record.run.revision >= Number.MAX_SAFE_INTEGER) throw Error("Execution capacity exceeded");
        record.fence++; record.leaseUntil = 0; record.run.revision++; record.run.cancelRequested = true;
        record.run.state = record.run.steps.some(step => step.state === "running" || step.state === "outcome_unknown") ? "outcome_unknown" : "cancelled";
        record.run.detail = "Cancellation recorded; prior unknown outcomes remain unverified and no further effects are authorized";
        records[index] = record;
        return structuredClone(record.run);
      });
    },
  };
}
