import bcrypt from "bcryptjs";

export const ADMIN_PIN_SCHEMA = `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_pin_hash text;`;
export const validAdminPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{4}$/.test(pin);
export function needsAdminPin(ctx: { role: string; membershipRole?: string | null; vendorRole?: string | null }) {
  return ctx.role === "admin" || ctx.membershipRole === "admin" || ctx.vendorRole === "office" || ctx.vendorRole === "both" ||
    ((ctx.role === "vendor" || ctx.role === "partner") && !ctx.vendorRole);
}
export async function hashAdminPin(pin: unknown) {
  if (!validAdminPin(pin)) throw new Error("PIN must contain exactly four digits.");
  return bcrypt.hash(pin, 12);
}
export async function verifyAdminPin(pin: unknown, hash: string | null) {
  return validAdminPin(pin) && !!hash && await bcrypt.compare(pin, hash);
}

// Storage callbacks are scoped by the authenticated route, never a client user ID.
export async function adminPinAction(input: { method: string; eligible: boolean; hash: string | null; body?: { action?: unknown; pin?: unknown; confirmPin?: unknown } }, store: { attempts: () => Promise<number>; create: (hash: string) => Promise<boolean> }) {
  const reply = (status: number, message: string) => ({ status, body: { message } });
  const { method, eligible, hash, body } = input;
  if (method === "GET") return { status: 200, body: { required: eligible && !hash, configured: !!hash } };
  if (method !== "POST") return reply(405, "Method not allowed.");
  if (!eligible) return reply(403, "An office or admin account is required.");
  if (await store.attempts() > 5) return reply(429, "Too many attempts. Try again in 15 minutes.");
  if (!validAdminPin(body?.pin)) return reply(400, "Enter a four-digit PIN.");
  if (body.action === "create") {
    if (hash) return reply(409, "A PIN is already configured.");
    if (body.pin !== body.confirmPin) return reply(400, "PINs do not match.");
    if (!await store.create(await hashAdminPin(body.pin))) return reply(409, "A PIN is already configured.");
  } else if (body.action === "verify") {
    if (!await verifyAdminPin(body.pin, hash)) return reply(403, "Incorrect PIN. Try again.");
  } else return reply(400, "Invalid PIN action.");
  return { status: 200, body: { ok: true } };
}
