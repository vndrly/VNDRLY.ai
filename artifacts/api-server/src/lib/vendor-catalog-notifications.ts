// Task #1156 — email digests fired from the catalog publish flow.
//
// Outbound email is disabled app-wide. These helpers remain as no-ops so
// paid-tier email can be wired later without API churn.

import { logger } from "./logger";

export interface VendorCatalogPublishedDigestArgs {
  vendorId: number;
  newVersionId: number;
  newVersion: number;
  flippedPartners: number[];
}

export async function sendVendorCatalogPublishedDigest(
  args: VendorCatalogPublishedDigestArgs,
): Promise<void> {
  if (args.flippedPartners.length === 0) return;
  logger.debug(
    { vendorId: args.vendorId, flippedPartners: args.flippedPartners.length },
    "vendor catalog published digest skipped (outbound email disabled)",
  );
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

export async function sendComplianceLapseAdminDigest(
  args: SendComplianceLapseAdminDigestArgs,
): Promise<void> {
  if (args.entries.length === 0) return;
  logger.debug(
    { vendorId: args.vendorId, entries: args.entries.length },
    "compliance lapse digest skipped (outbound email disabled)",
  );
}
