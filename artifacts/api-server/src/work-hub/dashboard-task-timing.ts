type Event = { taskId: string; eventType: string; createdAt: Date; detail?: unknown };

/** Later edits or reassignments must not move a completed task's elapsed-time boundary. */
export function dashboardTaskTiming(task: { id: string; status: string; createdAt: Date }, events: Event[]) {
  const relevant = events.filter(event => event.taskId === task.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const completedAt = task.status === "completed" ? relevant.find(event => event.eventType === "status.completed")?.createdAt ?? null : null;
  const assignedAt = relevant.find(event => event.eventType === "assigned" && (!completedAt || event.createdAt <= completedAt))?.createdAt ?? task.createdAt;
  const detail = completedAt ? relevant.find(event => event.eventType === "status.completed")?.detail as { resolution?: unknown } | undefined : undefined;
  return { assignedAt, completedAt, completionResolution: typeof detail?.resolution === "string" ? detail.resolution : null };
}
