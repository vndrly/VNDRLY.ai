import { randomUUID } from "node:crypto";

export type SubscriptionPayor = { type: "vendor" | "partner"; id: number };
export type WorkerPlan = "gate_only" | "full_worker";
export type WorkerSubscriptionState = "active" | "paused" | "terminated";

export type WorkerSubscription = {
  id: string;
  payor: SubscriptionPayor;
  workerUserId: number;
  plan: WorkerPlan;
  monthlyPriceCents: number;
  currency: "USD";
  renewalAt: Date;
  state: WorkerSubscriptionState;
  renews: boolean;
  accessEndsAt: Date | null;
  billingEndsAt: Date | null;
  foundingSiteLocationId: number | null;
  previewAccess: boolean;
  archivedAt: Date | null;
  auditActorUserId: number;
  createdAt: Date;
  updatedAt: Date;
};

export interface WorkerSubscriptionRepository {
  create(seat: WorkerSubscription): Promise<WorkerSubscription>;
  get(id: string): Promise<WorkerSubscription | null>;
  save(seat: WorkerSubscription): Promise<WorkerSubscription>;
  listForPayor(payor: SubscriptionPayor): Promise<WorkerSubscription[]>;
}

export class WorkerSubscriptionError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}

export function createMemoryWorkerSubscriptionRepository(): WorkerSubscriptionRepository {
  const seats = new Map<string, WorkerSubscription>();
  const clone = (seat: WorkerSubscription) => structuredClone(seat);
  return {
    async create(seat) { seats.set(seat.id, clone(seat)); return clone(seat); },
    async get(id) { const seat = seats.get(id); return seat ? clone(seat) : null; },
    async save(seat) { seats.set(seat.id, clone(seat)); return clone(seat); },
    async listForPayor(payor) {
      return [...seats.values()].filter((seat) => seat.payor.type === payor.type && seat.payor.id === payor.id).map(clone);
    },
  };
}

export function createWorkerSubscriptionService(
  repository: WorkerSubscriptionRepository,
  now: () => Date = () => new Date(),
) {
  async function required(id: string) {
    const seat = await repository.get(id);
    if (!seat) throw new WorkerSubscriptionError("worker_subscription.not_found", 404);
    return seat;
  }

  async function previewSeatChange(input: {
    payor: SubscriptionPayor; workerUserId?: number; plan: WorkerPlan;
    monthlyPriceCents: number; renewalAt: Date;
  }) {
    const seats = await repository.listForPayor(input.payor);
    const activeCount = seats.filter((seat) => seat.state !== "terminated").length;
    return {
      confirmationRequired: true as const,
      payor: input.payor,
      plan: input.plan,
      monthlyPriceCents: input.monthlyPriceCents,
      currency: "USD" as const,
      renewalAt: input.renewalAt,
      resultingSeatCount: activeCount + 1,
    };
  }

  async function activateSeat(input: {
    payor: SubscriptionPayor; workerUserId: number; plan: WorkerPlan;
    monthlyPriceCents: number; renewalAt: Date; confirmed: boolean;
    auditActorUserId: number; foundingSiteLocationId?: number | null; previewAccess?: boolean;
  }) {
    if (!input.confirmed) return { status: "blocked" as const, code: "worker_subscription.confirmation_required" as const };
    if (!Number.isSafeInteger(input.monthlyPriceCents) || input.monthlyPriceCents < 0) throw new WorkerSubscriptionError("worker_subscription.invalid_price", 400);
    const existing = (await repository.listForPayor(input.payor)).find((seat) => seat.workerUserId === input.workerUserId && seat.state !== "terminated");
    if (existing) throw new WorkerSubscriptionError("worker_subscription.already_exists");
    const timestamp = now();
    const seat: WorkerSubscription = {
      id: randomUUID(), payor: input.payor, workerUserId: input.workerUserId,
      plan: input.plan, monthlyPriceCents: input.monthlyPriceCents, currency: "USD",
      renewalAt: input.renewalAt, state: "active", renews: true,
      accessEndsAt: null, billingEndsAt: null,
      foundingSiteLocationId: input.foundingSiteLocationId ?? null,
      previewAccess: input.previewAccess ?? false, archivedAt: null,
      auditActorUserId: input.auditActorUserId, createdAt: timestamp, updatedAt: timestamp,
    };
    return { status: "applied" as const, seat: await repository.create(seat) };
  }

  async function pauseSeat(id: string, auditActorUserId: number) {
    const seat = await required(id);
    if (seat.state === "terminated") throw new WorkerSubscriptionError("worker_subscription.terminated");
    const timestamp = now();
    return repository.save({ ...seat, state: "paused", renews: false, accessEndsAt: timestamp, billingEndsAt: seat.renewalAt, auditActorUserId, updatedAt: timestamp });
  }

  async function terminateSeat(id: string, auditActorUserId: number) {
    const seat = await required(id);
    const timestamp = now();
    return repository.save({ ...seat, state: "terminated", renews: false, accessEndsAt: timestamp, billingEndsAt: seat.billingEndsAt ?? seat.renewalAt, archivedAt: timestamp, auditActorUserId, updatedAt: timestamp });
  }

  async function reactivateSeat(id: string, input: { renewalAt: Date; auditActorUserId: number }) {
    const seat = await required(id);
    const timestamp = now();
    return repository.save({ ...seat, state: "active", renews: true, renewalAt: input.renewalAt, accessEndsAt: null, billingEndsAt: null, archivedAt: null, auditActorUserId: input.auditActorUserId, updatedAt: timestamp });
  }

  function resolveEntitlement(seat: WorkerSubscription, input: { module: string; siteLocationId?: number | null }) {
    if (seat.state !== "active") return { allowed: false as const, mode: "none" as const, reason: `seat_${seat.state}` };
    if (seat.foundingSiteLocationId !== null && input.siteLocationId !== seat.foundingSiteLocationId) return { allowed: false as const, mode: "none" as const, reason: "site_not_entitled" };
    if (seat.plan === "full_worker" || input.module === "gate" || input.module === "work_hub") return { allowed: true as const, mode: "live" as const };
    if (seat.previewAccess) return { allowed: true as const, mode: "preview" as const };
    return { allowed: false as const, mode: "none" as const, reason: "plan_not_entitled" };
  }

  return { previewSeatChange, activateSeat, pauseSeat, terminateSeat, reactivateSeat, resolveEntitlement };
}
