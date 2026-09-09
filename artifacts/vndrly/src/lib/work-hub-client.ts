export type WorkHubOwner = { type: "vendor" | "partner"; id: number };
export type WorkHubUser = {
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  membershipRole?: string | null;
  activeMembershipId?: number | null;
  availableMemberships?: Array<{ id: number; role: string }>;
};

export function canManageWorkHubChannels(
  user: WorkHubUser | null | undefined,
): boolean {
  const activeMembershipRole = user?.availableMemberships?.find(
    (membership) => membership.id === user.activeMembershipId,
  )?.role;
  return Boolean(
    user &&
      (user.role === "admin" ||
        user.membershipRole === "admin" ||
        activeMembershipRole === "admin"),
  );
}

export const isWorkHubAdmin = canManageWorkHubChannels;

export function ownerForUser(
  user: WorkHubUser | null | undefined,
): WorkHubOwner | null {
  if (!user) return null;
  if (user.partnerId) return { type: "partner", id: user.partnerId };
  if (user.vendorId) return { type: "vendor", id: user.vendorId };
  return null;
}

export function commandEnvelope<T>(
  owner: WorkHubOwner,
  payload: T,
  operationId = crypto.randomUUID(),
  expectedVersion?: number,
) {
  return {
    operationId,
    owner,
    context: { kind: "organization" as const, id: owner.id },
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    payload,
  };
}

export async function workHubRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/work-hub${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error?.message ??
        body?.message ??
        `Request failed (${response.status})`,
    );
  }
  return response.json();
}

export function workHubModulePath(subjectType: string, subjectId: string) {
  if (["message", "channel", "note", "file"].includes(subjectType))
    return `/work-hub/channels?${subjectType}=${encodeURIComponent(subjectId)}`;
  if (["meeting", "meeting_occurrence"].includes(subjectType))
    return `/work-hub/meetings?meeting=${encodeURIComponent(subjectId)}`;
  if (
    ["task", "form", "checklist", "announcement", "approval"].includes(
      subjectType,
    )
  )
    return `/work-hub/tasks?${subjectType}=${encodeURIComponent(subjectId)}`;
  return "/work-hub/search";
}
