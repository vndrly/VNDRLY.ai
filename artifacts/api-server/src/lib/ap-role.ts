import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// String must match the literal stored in partner_contacts.roles. The same
// label is what the partner-detail UI surfaces in COMPANY_ROLES — kept in
// lockstep so a partner contact tagged "Accounts Payable" through the UI is
// the one allowed to disperse funds.
export const ACCOUNTS_PAYABLE_ROLE = "Accounts Payable";

// Find AP-contact email addresses for a partner. Used by the weekly
// awaiting-payment digest (Task #505) to route the email to the people
// actually responsible for cutting checks. Returns distinct,
// case-folded emails sorted for stable digest ordering. Falls back to
// the partner's primary `contact_email` only when zero AP contacts are
// configured — the digest job uses the empty result to skip sending
// (rather than fanning out to a generic mailbox).
export interface ApContact {
  email: string;
  preferredLocale: "en" | "es";
}

export async function findPartnerApContactEmails(
  partnerId: number,
): Promise<ApContact[]> {
  const rows = await db.execute<{ email: string; preferred_locale: string }>(sql`
    select lower(email) as email,
           min(coalesce(preferred_locale, 'en')) as preferred_locale
    from partner_contacts
    where partner_id = ${partnerId}
      and deleted_at is null
      and ${ACCOUNTS_PAYABLE_ROLE} = ANY(roles)
    group by lower(email)
    order by lower(email)
  `);
  return (rows.rows ?? []).map((r) => ({
    email: r.email,
    preferredLocale: r.preferred_locale === "es" ? "es" : "en",
  }));
}

// Returns true when the user is allowed to disperse funds against the given
// partner. Authoritative rule:
//   1. The user has an org-admin OR org-ap row in user_org_memberships for
//      this partner (partner admins are AP by default; 'ap' role grants AP
//      authority without the broader admin powers).
//   2. OR the user's login (username OR email column, case-insensitive)
//      matches a partner_contacts row whose `roles` array contains
//      "Accounts Payable" — preserves backward compatibility with the
//      pre-existing email-match path used by findPartnerBillingUserIds.
//
// Tenancy (does the user even belong to this partner) is the caller's
// responsibility — we only answer the role question.
export async function userHasApRole(
  userId: number,
  partnerId: number,
): Promise<boolean> {
  const rows = await db.execute<{ has_role: boolean }>(sql`
    select exists (
      select 1
      from user_org_memberships m
      where m.user_id = ${userId}
        and m.org_type = 'partner'
        and m.partner_id = ${partnerId}
        and m.role IN ('admin', 'ap')
    )
    or exists (
      select 1
      from user_org_memberships m
      join users u on u.id = m.user_id
      join partner_contacts pc
        on pc.partner_id = m.partner_id
        and (
          lower(pc.email) = lower(u.username)
          or lower(pc.email) = lower(coalesce(u.email, ''))
        )
        and pc.deleted_at is null
      where m.user_id = ${userId}
        and m.org_type = 'partner'
        and m.partner_id = ${partnerId}
        and ${ACCOUNTS_PAYABLE_ROLE} = ANY(pc.roles)
    ) as has_role
  `);
  return rows.rows?.[0]?.has_role === true;
}
