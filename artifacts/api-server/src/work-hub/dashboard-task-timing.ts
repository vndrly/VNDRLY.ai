type Event = { taskId: string; eventType: string; createdAt: Date };

/** Later edits or reassignments must not move a completed task's elapsed-time boundary. */
export function dashboardTaskTiming(task: { id: string; status: string; createdAt: Date }, events: Event[]) {
  const relevant = events.filter(event => event.taskId === task.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const completedAt = task.status === "completed" ? relevant.find(event => event.eventType === "status.completed")?.createdAt ?? null : null;
  const assignedAt = relevant.find(event => event.eventType === "assigned" && (!completedAt || event.createdAt <= completedAt))?.createdAt ?? task.createdAt;
  return { assignedAt, completedAt };
}
