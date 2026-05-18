// Task #1156 — email digests fired from the catalog publish flow.
//
// Two distinct shapes:
//
//   sendVendorCatalogPublishedDigest
//     Per-partner summary "vendor X published a new catalog and your
//     approval was rolled to auto_unapproved; click here to review +
//     re-accept the EULA." Sent in EN or ES based on the recipient's
//     org locale (falls back to EN). Best-effort throughout — a
//     SendGrid hiccup must not crash the publish path.
//
//   sendComplianceLapseAdminDigest
//     Sent to VNDRLY system admins + the vendor itself when the
//     6h cron flips any (partner, vendor) row to `auto_unapproved`
//     for an expiration reason. Aggregates partners affected so the
//     vendor doesn't get one email per partner.
//
// Both helpers are import-on-demand from the catalog publish
// endpoint and recompute worker so the bundler doesn't drag SendGrid
// init into hot routes.

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  vendorsTable,
  partnersTable,
  partnerContactsTable,
  usersTable,
  userOrgMembershipsTable,
  vendorCatalogVersionsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { getUncachableSendGridClient } from "./sendgrid";

export interface VendorCatalogPublishedDigestArgs {
  vendorId: number;
  newVersionId: number;
  newVersion: number;
  flippedPartners: number[];
}

/**
 * For each partner that was flipped to `auto_unapproved` by the
 * publish, look up the partner's primary contact email + locale and
 * send a one-line digest with a deep link to the partner's vendor-
 * approvals page. Failures are swallowed (logged) so the publish
 * endpoint can complete without taking on SendGrid availability as
 * a hard dependency.
 */
export async function sendVendorCatalogPublishedDigest(
  args: VendorCatalogPublishedDigestArgs,
): Promise<void> {
  if (args.flippedPartners.length === 0) return;

  let sg: Awaited<ReturnType<typeof getUncachableSendGridClient>>;
  let fromEmail: string;
  try {
    const client = await getUncachableSendGridClient();
    sg = client;
    fromEmail = client.fromEmail;
  } catch (err) {
    logger.warn(
      { err, vendorId: args.vendorId },
      "SendGrid client unavailable; skipping vendor catalog digest",
    );
    return;
  }

  const [vendor] = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, args.vendorId))
    .limit(1);
  if (!vendor) return;

  const [version] = await db
    .select({
      changeSummary: vendorCatalogVersionsTable.changeSummary,
    })
    .from(vendorCatalogVersionsTable)
    .where(eq(vendorCatalogVersionsTable.id, args.newVersionId))
    .limit(1);
  const summary = version?.changeSummary ?? null;

  // Pull every non-deleted partner contact for the affected partners.
  // We don't have an `is_primary` flag on partner_contacts, so just
  // notify all of them — the dedupe surface for now is "one email per
  // contact row that exists".
  const partners = await db
    .select({
      id: partnersTable.id,
      name: partnersTable.name,
      contactEmail: partnerContactsTable.email,
      locale: partnerContactsTable.preferredLocale,
    })
    .from(partnersTable)
    .leftJoin(
      partnerContactsTable,
      and(
        eq(partnerContactsTable.partnerId, partnersTable.id),
        isNull(partnerContactsTable.deletedAt),
      ),
    )
    .where(inArray(partnersTable.id, args.flippedPartners));

  for (const p of partners) {
    if (!p.contactEmail) continue;
    const locale = p.locale === "es" ? "es" : "en";
    const subject =
      locale === "es"
        ? `Reaprobación requerida: ${vendor.name} publicó un nuevo catálogo`
        : `Re-approval required: ${vendor.name} published a new catalog`;
    const intro =
      locale === "es"
        ? `${vendor.name} publicó la versión ${args.newVersion} de su catálogo. La relación con ${p.name} pasó automáticamente a "Reaprobación pendiente".`
        : `${vendor.name} published version ${args.newVersion} of their catalog. The relationship with ${p.name} was automatically moved to "Re-approval pending".`;
    const action =
      locale === "es"
        ? "Revise los cambios y vuelva a aceptar el EULA del proveedor para reaprobar."
        : "Review the changes and re-accept the vendor EULA to re-approve.";
    const html = `
      <p>${escapeHtml(intro)}</p>
      ${summary ? `<blockquote>${escapeHtml(summary)}</blockquote>` : ""}
      <p>${escapeHtml(action)}</p>
    `;
    try {
      await sg.client.send({
        to: p.contactEmail,
        from: fromEmail,
        subject,
        html,
        text: `${intro}\n\n${summary ?? ""}\n\n${action}`,
      });
    } catch (err) {
      logger.warn(
        { err, vendorId: args.vendorId, partnerId: p.id },
        "vendor catalog published digest send failed",
      );
    }
  }
}

export interface ComplianceLapseEntry {
  partnerId: number;
  partnerName: string;
  reason: string;
  detail: string | null;
}

export interface SendComplianceLapseAdminDigestArgs {
  vendorId: number;
  entries: ComplianceLapseEntry[];
}

/**
 * Aggregate notification when the 6h cron auto-unapproves one or more
 * (partner, vendor) pairs for compliance/expiration reasons. Sent to
 * VNDRLY system admins (role='admin') plus any vendor-side admin so
 * the vendor knows their docs need refreshing. Idempotent on the
 * caller's side — this helper just sends; the worker decides when.
 */
export async function sendComplianceLapseAdminDigest(
  args: SendComplianceLapseAdminDigestArgs,
): Promise<void> {
  if (args.entries.length === 0) return;
  let sg: Awaited<ReturnType<typeof getUncachableSendGridClient>>;
  let fromEmail: string;
  try {
    const client = await getUncachableSendGridClient();
    sg = client;
    fromEmail = client.fromEmail;
  } catch (err) {
    logger.warn(
      { err, vendorId: args.vendorId },
      "SendGrid unavailable; skipping compliance digest",
    );
    return;
  }
  const [vendor] = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, args.vendorId))
    .limit(1);
  if (!vendor) return;
  // System admins. usersTable does not carry a locale column today so
  // every admin email defaults to EN — partners get localized digests
  // via partner_contacts.preferred_locale instead.
  const sysAdmins = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), isNotNull(usersTable.email)));
  // Vendor-side admins
  const vendorAdmins = await db
    .select({ email: usersTable.email })
    .from(userOrgMembershipsTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, userOrgMembershipsTable.userId),
    )
    .where(
      and(
        eq(userOrgMembershipsTable.orgType, "vendor"),
        eq(userOrgMembershipsTable.vendorId, args.vendorId),
        eq(userOrgMembershipsTable.role, "admin"),
        isNotNull(usersTable.email),
      ),
    );
  const recipients = [...sysAdmins, ...vendorAdmins].filter(
    (r): r is { email: string } => !!r.email,
  );
  if (recipients.length === 0) return;

  // usersTable lacks a locale column; admin digests are EN-only today.
  const locale: "en" = "en";
  const subject = `Vendor compliance lapse: ${vendor.name}`;
  const intro = `The following partner approvals were automatically revoked due to a compliance or qualified-employee lapse on ${vendor.name}:`;
  for (const r of recipients) {
    const rows = args.entries
      .map((e) => {
        const reasonLabel = formatReason(e.reason, locale);
        const detail = e.detail ? ` (${escapeHtml(e.detail)})` : "";
        return `<li>${escapeHtml(e.partnerName)} — ${reasonLabel}${detail}</li>`;
      })
      .join("");
    const html = `<p>${escapeHtml(intro)}</p><ul>${rows}</ul>`;
    const text = `${intro}\n${args.entries.map((e) => `- ${e.partnerName}: ${formatReason(e.reason, locale)}${e.detail ? ` (${e.detail})` : ""}`).join("\n")}`;
    try {
      await sg.client.send({
        to: r.email,
        from: fromEmail,
        subject,
        html,
        text,
      });
    } catch (err) {
      logger.warn(
        { err, vendorId: args.vendorId, recipient: r.email },
        "compliance lapse digest send failed",
      );
    }
  }
}

function formatReason(reason: string, locale: "en" | "es" = "en"): string {
  const map: Record<string, { en: string; es: string }> = {
    coi_expired: { en: "COI expired", es: "COI caducado" },
    wc_expired: {
      en: "Workers' comp expired",
      es: "Compensación laboral caducada",
    },
    gl_expired: {
      en: "General liability expired",
      es: "Responsabilidad general caducada",
    },
    auto_liability_expired: {
      en: "Auto liability expired",
      es: "Responsabilidad de auto caducada",
    },
    qualified_employee_lapse: {
      en: "No qualified employee on roster",
      es: "Sin empleados calificados en plantilla",
    },
    vendor_catalog_published: {
      en: "Vendor catalog re-published",
      es: "Catálogo del proveedor republicado",
    },
  };
  return map[reason]?.[locale] ?? reason;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
