export function publicCampaignState<
  T extends { policyAttachmentSnapshot?: unknown },
>(state: T): Omit<T, "policyAttachmentSnapshot"> {
  const { policyAttachmentSnapshot: _, ...publicState } = state;
  return publicState;
}
export function projectCampaignReceipts(
  config: { kind: string; anonymous: boolean },
  state: { deadline?: string | null },
  assigned: { id: string; assigneeUserId: number | null }[],
  people: { userId: number; name: string | null; email: string | null }[],
  latest: Map<string, { submittedAt: Date; values: Record<string, unknown> }>,
  visible: boolean,
) {
  if (config.anonymous) return null;
  return assigned.map((i) => {
    const person = people.find((p) => p.userId === i.assigneeUserId),
      receipt = latest.get(i.id);
    return {
      instanceId: i.id,
      userId: i.assigneeUserId,
      name: person?.name ?? "Excluded employee",
      email: person?.email ?? null,
      excluded: !person,
      submittedAt: receipt?.submittedAt.toISOString() ?? null,
      late:
        !!receipt &&
        !!state.deadline &&
        receipt.submittedAt.getTime() >= Date.parse(state.deadline),
      ...(config.kind === "form" || (config.kind === "poll" && visible)
        ? { values: receipt?.values ?? null }
        : {}),
    };
  });
}
