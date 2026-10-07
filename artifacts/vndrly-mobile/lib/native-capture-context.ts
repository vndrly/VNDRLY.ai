import { z } from "zod/v4";
import { apiFetch } from "./api";
import {
  captureAuthScope,
  getUser,
  isAuthScopeCurrent,
  type AuthScope,
} from "./auth";
import {
  NativeCaptureAccountSchema,
  nativeCaptureBinding,
} from "./native-capture-context-policy";
export {
  NativeCaptureAccountSchema,
  type NativeCaptureAccount,
} from "./native-capture-context-policy";
const sessionSchema = z.object({
  userId: z.number().int().positive(),
  activeMembershipId: z.number().int().positive(),
  sv: z.number().int().positive(),
  role: z.enum(["vendor", "partner", "field_employee", "admin", "guest"]),
  vendorId: z.number().int().positive().nullish(),
  partnerId: z.number().int().positive().nullish(),
  requiresContextChoice: z.boolean().optional(),
});
/** Stable across restarts, bound to fresh server-read signed-session context. Canonical effects still revalidate persisted authority. */
export async function currentNativeCaptureContext(
  scope: AuthScope = captureAuthScope(),
) {
  const stored = await getUser();
  const session = sessionSchema.parse(
    await apiFetch("/api/auth/me", {}, scope),
  );
  if (
    !stored ||
    stored.id !== session.userId ||
    stored.activeMembershipId !== session.activeMembershipId ||
    stored.requiresContextChoice ||
    session.requiresContextChoice ||
    !isAuthScopeCurrent(scope)
  )
    throw new Error("native_work_capture_account_changed");
  const orgType = session.role === "partner" ? "partner" : "vendor";
  const orgId = orgType === "partner" ? session.partnerId : session.vendorId;
  if (["guest", "admin"].includes(session.role) || !orgId)
    throw new Error("native_work_capture_account_required");
  if ((orgType === "partner" ? stored.partnerId : stored.vendorId) !== orgId)
    throw new Error("native_work_capture_account_changed");
  const account = NativeCaptureAccountSchema.parse({
    userId: session.userId,
    membershipId: session.activeMembershipId,
    sessionVersion: session.sv,
    orgType,
    orgId,
  });
  const binding = nativeCaptureBinding(account);
  const assertCurrent = () => {
    if (!isAuthScopeCurrent(scope))
      throw new Error("native_work_capture_account_changed");
  };
  assertCurrent();
  return { account, binding, scope, assertCurrent };
}
