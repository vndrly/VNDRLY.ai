export type WorkHubOwner = { type: "vendor" | "partner"; id: number };
export type WorkHubUser = {
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  membershipRole?: string | null;
  activeMembershipId?: number | null;
  availableMemberships?: Array<{ id: number; role: string }>;
  vendorRole?: string | null;
};

type WorkHubCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
};

export function createWorkHubOperationId(
  cryptoApi: WorkHubCrypto | undefined = globalThis.crypto,
): string {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

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

export function isWorkHubScheduler(
  user: WorkHubUser | null | undefined,
): boolean {
  return isWorkHubAdmin(user) || user?.vendorRole === "gate_supervisor";
}

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
  operationId = createWorkHubOperationId(),
  expectedVersion?: number,
  context: {
    kind:
      | "organization"
      | "ticket"
      | "site"
      | "crew"
      | "gate"
      | "project"
      | "channel"
      | "meeting";
    id: number | string;
  } = {
    kind: "organization",
    id: owner.id,
  },
) {
  return {
    operationId,
    owner,
    context,
    expectedVersion: expectedVersion ?? null,
    payloadVersion: 1 as const,
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
