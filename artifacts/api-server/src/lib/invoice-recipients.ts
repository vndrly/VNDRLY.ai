import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const BILLING_NOTIFICATIONS_ROLE = "Billing Notifications";

// Find partner-side users to in-app-notify for billing events. Mirrors
// findPartnerVisitNotifierUserIds: joins partner_contacts (filtered by the
// "Billing Notifications" role) to user_org_memberships via case-insensitive
// email match. Returns distinct user IDs.
export async function findPartnerBillingUserIds(
  partnerId: number,
): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    select distinct m.user_id as id
    from user_org_memberships m
    join users u on u.id = m.user_id
    join partner_contacts pc
      on pc.partner_id = m.partner_id
      and lower(pc.email) = lower(u.username)
      and pc.deleted_at is null
    where m.org_type = 'partner'
      and m.partner_id = ${partnerId}
      and ${BILLING_NOTIFICATIONS_ROLE} = ANY(pc.roles)
  `);
  return (rows.rows ?? []).map((r) => r.id);
}

// Resolve the *email address* for sending invoice / reminder PDFs. Order:
//   1. explicit override (sender typed it in the Send modal)
//   2. invoice.billingContactEmail (cached from previous send)
//   3. partner_contacts with the Billing Notifications role
//   4. partners.contact_email (the partner-admin default — guaranteed
//      non-null by schema, so this is the safety net that keeps the
//      send / reminder loop working even when nobody has configured a
//      Billing Notifications contact)
//   5. null (caller must surface a 400)
export async function resolveBillingEmail(opts: {
  override?: string | null;
  cachedBillingEmail?: string | null;
  partnerId: number;
}): Promise<string | null> {
  if (opts.override && opts.override.trim()) return opts.override.trim();
  if (opts.cachedBillingEmail && opts.cachedBillingEmail.trim())
    return opts.cachedBillingEmail.trim();
  const billingRows = await db.execute<{ email: string }>(sql`
    select email
    from partner_contacts
    where partner_id = ${opts.partnerId}
      and deleted_at is null
      and ${BILLING_NOTIFICATIONS_ROLE} = ANY(roles)
    order by lower(email)
    limit 1
  `);
  const billing = billingRows.rows?.[0];
  if (billing?.email) return billing.email;
  const partnerRows = await db.execute<{ contact_email: string }>(sql`
    select contact_email
    from partners
    where id = ${opts.partnerId}
    limit 1
  `);
  const partner = partnerRows.rows?.[0];
  return partner?.contact_email?.trim() || null;
}

// Resolve the preferred locale for the recipient. Looks up the partner_contact
// matching the email; defaults to 'en' if no match or no preference set.
// Caller passes the resolved email (post-override) so the locale matches the
// actual addressee.
export async function resolveBillingLocale(opts: {
  email: string | null;
  partnerId: number;
}): Promise<"en" | "es"> {
  if (!opts.email) return "en";
  const rows = await db.execute<{ preferred_locale: string }>(sql`
    select preferred_locale
    from partner_contacts
    where partner_id = ${opts.partnerId}
      and lower(email) = lower(${opts.email})
      and deleted_at is null
    limit 1
  `);
  const row = rows.rows?.[0];
  return row?.preferred_locale === "es" ? "es" : "en";
}

// Resolve the preferred locale for a logged-in partner viewer. Looks up the
// session user's email (users.username — the canonical login email per
// schema) and joins partner_contacts on the same partner_id to pick up the
// matching contact's preferred_locale. Defaults to 'en' when no contact row
// matches or no preference is set. Used by the live PDF preview endpoint so
// a partner viewing /invoices/:id/pdf sees the same language they receive
// over email.
export async function resolvePartnerSessionLocale(opts: {
  userId: number;
  partnerId: number;
}): Promise<"en" | "es"> {
  const rows = await db.execute<{ preferred_locale: string }>(sql`
    select pc.preferred_locale as preferred_locale
    from users u
    join partner_contacts pc
      on pc.partner_id = ${opts.partnerId}
      and lower(pc.email) = lower(u.username)
      and pc.deleted_at is null
    where u.id = ${opts.userId}
    limit 1
  `);
  const row = rows.rows?.[0];
  return row?.preferred_locale === "es" ? "es" : "en";
}

// Find vendor-side users so we can in-app notify them when a payment is
// recorded. Same email-join pattern.
export async function findVendorUserIds(vendorId: number): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    select distinct m.user_id as id
    from user_org_memberships m
    where m.org_type = 'vendor' and m.vendor_id = ${vendorId}
  `);
  return (rows.rows ?? []).map((r) => r.id);
}
