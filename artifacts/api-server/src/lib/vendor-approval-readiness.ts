export interface VendorApprovalReadiness {
  federalTaxId: string | null;
  coiDocumentUrl: string | null;
  insuranceExpirationDate: string | null;
}

/** Required business/compliance data is independent of catalog publishing. */
export function missingVendorApprovalFields(vendor: VendorApprovalReadiness, now = new Date()): string[] {
  const missing: string[] = [];
  if (!vendor.federalTaxId?.trim()) missing.push("federalTaxId");
  if (!vendor.coiDocumentUrl?.trim()) missing.push("coiDocumentUrl");
  const expiration = vendor.insuranceExpirationDate?.trim();
  const date = expiration ? new Date(expiration) : null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expiration || date.getTime() < today) {
    missing.push("insuranceExpirationDate");
  }
  return missing;
}
