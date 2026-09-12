import type { WorkHubContextRef, WorkHubEventEnvelope, WorkHubOwner } from "@workspace/api-zod";

type PendingEvent = Omit<WorkHubEventEnvelope, "version" | "sequence" | "occurredAt">;
type Subscriber = (event: WorkHubEventEnvelope) => void;
const persistedEvents = new WeakSet<WorkHubEventEnvelope>();

export function createWorkHubEventBus() {
  let sequence = 0;
  const subscribers = new Map<string, Set<Subscriber>>();
  const key = (userId: number, owner: WorkHubOwner) => `${userId}:${owner.type}:${owner.id}`;
  return {
    currentSequence: () => sequence,
    subscribe(actor: { userId: number; owner: WorkHubOwner }, subscriber: Subscriber) {
      const subscriptionKey = key(actor.userId, actor.owner);
      const set = subscribers.get(subscriptionKey) ?? new Set<Subscriber>();
      set.add(subscriber);
      subscribers.set(subscriptionKey, set);
      return () => {
        set.delete(subscriber);
        if (set.size === 0) subscribers.delete(subscriptionKey);
      };
    },
    publish(input: PendingEvent): WorkHubEventEnvelope {
      const event: WorkHubEventEnvelope = {
        ...input, version: 1, sequence: ++sequence, occurredAt: new Date().toISOString(),
      };
      for (const subscriber of subscribers.get(key(input.recipientUserId, input.owner)) ?? []) subscriber(event);
      return event;
    },
    publishPersisted(event: WorkHubEventEnvelope): WorkHubEventEnvelope {
      persistedEvents.add(event);
      sequence = Math.max(sequence, event.sequence);
      for (const subscriber of subscribers.get(key(event.recipientUserId, event.owner)) ?? []) subscriber(event);
      return event;
    },
  };
}

export function fanOutPersistedWorkHubEvent(input: {
  sequence: number; userId: number; owner: WorkHubOwner; eventType: string;
  payload: Record<string, unknown>; createdAt: Date;
}): WorkHubEventEnvelope {
  const rawContext = input.payload.context as WorkHubContextRef | undefined;
  const rawSubject = input.payload.subject as { type?: unknown; id?: unknown } | undefined;
  const context: WorkHubContextRef = rawContext ?? { kind: "organization", id: input.owner.id };
  const subject = rawSubject && typeof rawSubject.type === "string" &&
      ((typeof rawSubject.id === "number" && Number.isInteger(rawSubject.id) && rawSubject.id > 0) ||
       (typeof rawSubject.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawSubject.id)))
    ? { type: rawSubject.type.slice(0, 80), id: rawSubject.id as string | number }
    : { type: "organization", id: input.owner.id };
  return workHubEventBus.publishPersisted({
    version: 1, sequence: input.sequence, type: input.eventType,
    owner: input.owner, context, subject,
    recipientUserId: input.userId, occurredAt: input.createdAt.toISOString(), payload: input.payload,
  });
}

export const workHubEventBus = createWorkHubEventBus();

export function isPersistedWorkHubEvent(event: WorkHubEventEnvelope): boolean {
  return persistedEvents.has(event);
}

export function publishWorkHubEvent(input: {
  type: string; owner: WorkHubOwner; context: WorkHubContextRef;
  subject: { type: string; id: string | number }; recipientUserIds: number[];
}): WorkHubEventEnvelope[] {
  return [...new Set(input.recipientUserIds)].map((recipientUserId) => workHubEventBus.publish({
    type: input.type, owner: input.owner, context: input.context, subject: input.subject, recipientUserId,
  }));
}
