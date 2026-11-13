import { z } from 'zod/v4';
import { EXTERNAL_CERTIFICATION_CATALOG } from '@workspace/api-zod';

export const ExternalTrainingCreditSchema = z.object({
  version: z.literal(1),
  reviewedAt: z.iso.datetime(),
  reviewedByUserId: z.number().int().positive(),
  reviewNote: z.string().trim().min(10).max(2000),
  evidenceFingerprint: z.string(),
  families: z.array(z.object({ familyId: z.string(), sourceSha256: z.string() })).max(200),
});
export type ExternalCertificate = {
  id: number; name: string; issuer: string | null; certNumber: string | null;
  issuedDate: string | null; expirationDate: string | null;
  documentUrl: string | null; documentPath: string | null;
  vendorVerifiedAt: unknown; deletedAt?: unknown; trainingCredit?: unknown;
  qualificationDetails?: Record<string, string> | null;
};
// Bind the review to the actual evidence, so editing a certificate never silently
// transfers credit to a different credential or extends its accepted validity.
export function certificateEvidenceFingerprint(c: ExternalCertificate) {
  return JSON.stringify([c.name,c.issuer,c.certNumber,c.issuedDate,c.expirationDate,c.documentUrl,c.documentPath,
    Object.entries(c.qualificationDetails ?? {}).sort(([a],[b])=>a.localeCompare(b))]);
}
export function hasCurrentCertificateDates(c: Pick<ExternalCertificate,'name'|'issuedDate'|'expirationDate'>, today: string) {
  if (c.issuedDate && c.issuedDate > today) return false;
  return c.expirationDate ? c.expirationDate >= today : EXTERNAL_CERTIFICATION_CATALOG.some(item => item.name === c.name && item.nonExpiring);
}
export function acceptedExternalTraining(c: ExternalCertificate, today: string) {
  const review = ExternalTrainingCreditSchema.safeParse(c.trainingCredit);
  if (!review.success || !c.vendorVerifiedAt || c.deletedAt || !c.certNumber?.trim() ||
      !c.issuer?.trim() || !hasCurrentCertificateDates(c, today) || review.data.reviewedAt.slice(0,10) > today ||
      review.data.evidenceFingerprint !== certificateEvidenceFingerprint(c)) return [];
  return review.data.families.map(f => ({...f, certificateId:c.id, expiresAt:c.expirationDate}));
}
