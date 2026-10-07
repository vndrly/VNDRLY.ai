import { z } from "zod/v4";
const memberSchema = z.object({
  id: z.string().uuid(),
  userId: z.number().int().positive(),
  email: z.string().nullable(),
  mode: z.string(),
  displayName: z.string().nullable(),
});
export type ChannelMemberAttempt = { channelId: string; email: string };
export async function addWorkHubChannelMember(
  attempt: ChannelMemberAttempt,
  deps: {
    request: (path: string, init?: RequestInit) => Promise<unknown>;
    assertCurrent: () => void;
  },
) {
  const channelId = z.string().uuid().parse(attempt.channelId),
    email = z.string().trim().email().parse(attempt.email).toLowerCase(),
    base = "/api/work-hub/channels/" + channelId;
  deps.assertCurrent();
  const access = z
    .object({ canManage: z.boolean() })
    .parse(await deps.request(base + "/member-access"));
  deps.assertCurrent();
  if (!access.canManage) throw Error("channel_management_unavailable");
  const rows = z
    .array(memberSchema)
    .parse(await deps.request(base + "/members"));
  deps.assertCurrent();
  const existing = rows.find(
    (row) => row.email?.trim().toLowerCase() === email,
  );
  if (existing)
    return { member: existing, evidence: "current_membership" as const };
  const raw = z
    .object({
      id: z.string().uuid(),
      channelId: z.string().uuid(),
      userId: z.number().int().positive(),
      mode: z.string(),
    })
    .parse(
      await deps.request(base + "/members", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    );
  deps.assertCurrent();
  if (raw.channelId !== channelId) throw Error("unverified_member");
  const fresh = z
    .array(memberSchema)
    .parse(await deps.request(base + "/members"));
  deps.assertCurrent();
  const saved = fresh.find(
    (row) =>
      row.id === raw.id &&
      row.userId === raw.userId &&
      row.email?.trim().toLowerCase() === email &&
      row.mode === raw.mode,
  );
  if (!saved) throw Error("unverified_member");
  return { member: saved, evidence: "current_membership" as const };
}
