import type { WorkHubContextRef, WorkHubEventEnvelope, WorkHubOwner } from "@workspace/api-zod";

type PendingEvent = Omit<WorkHubEventEnvelope, "version" | "sequence" | "occurredAt">;
type Subscriber = (event: WorkHubEventEnvelope) => void;

export function createWorkHubEventBus() {
  let sequence = 0;
  const subscribers = new Map<number, Set<Subscriber>>();
  return {
    currentSequence: () => sequence,
    subscribe(userId: number, subscriber: Subscriber) {
      const set = subscribers.get(userId) ?? new Set<Subscriber>();
      set.add(subscriber);
      subscribers.set(userId, set);
      return () => {
        set.delete(subscriber);
        if (set.size === 0) subscribers.delete(userId);
      };
    },
    publish(input: PendingEvent): WorkHubEventEnvelope {
      const event: WorkHubEventEnvelope = {
        ...input, version: 1, sequence: ++sequence, occurredAt: new Date().toISOString(),
      };
      for (const subscriber of subscribers.get(input.recipientUserId) ?? []) subscriber(event);
      return event;
    },
  };
}

export const workHubEventBus = createWorkHubEventBus();

export function publishWorkHubEvent(input: {
  type: string; owner: WorkHubOwner; context: WorkHubContextRef;
  subject: { type: string; id: string | number }; recipientUserIds: number[];
}): WorkHubEventEnvelope[] {
  return [...new Set(input.recipientUserIds)].map((recipientUserId) => workHubEventBus.publish({
    type: input.type, owner: input.owner, context: input.context, subject: input.subject, recipientUserId,
  }));
}
