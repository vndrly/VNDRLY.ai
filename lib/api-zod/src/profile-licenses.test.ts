import { expect, it } from 'vitest';
import { ProfileLicenseBody } from './profile-licenses';
const license = { type: 'driver', issuer: 'State licensing office', jurisdiction: 'TX', number: 'TEST-ONLY', scope: 'Class A', restrictions: '', issuedDate: '2026-01-01', expirationDate: '2027-01-01', noExpiration: false, documentUrl: '', evaluationDate: '', evaluator: '', trainingReference: '' };
it('allows equipment licenses to be recorded with only the available details', () => {
  expect(ProfileLicenseBody.safeParse({ ...license, type: 'equipment-license' }).success).toBe(true);
  for (const key of ['issuer', 'number', 'jurisdiction', 'scope']) expect(ProfileLicenseBody.safeParse({ ...license, type: 'equipment-license', [key]: '' }).success).toBe(true);
});
it('keeps employer authorization distinct without requiring evaluation fields', () => {
  const record = { ...license, type: 'equipment-authorization', number: '', jurisdiction: '', scope: 'Forklift class IV', evaluationDate: '2026-01-01', evaluator: 'Qualified evaluator', trainingReference: 'Employer evaluation record TEST-1' };
  expect(ProfileLicenseBody.safeParse(record).success).toBe(true);
  for (const key of ['scope', 'evaluationDate', 'evaluator', 'trainingReference']) expect(ProfileLicenseBody.safeParse({ ...record, [key]: '' }).success).toBe(true);
});
it('rejects fake dates, inconsistent expiration, unsafe documents and client verification claims', () => {
  for (const patch of [{ issuedDate: '2026-02-30' }, { noExpiration: true }, { expirationDate: '2025-01-01' }, { documentUrl: 'https://example.org/id.pdf' }, { verifiedAt: '2026-01-01' }]) expect(ProfileLicenseBody.safeParse({ ...license, ...patch }).success).toBe(false);
  expect(ProfileLicenseBody.safeParse({ ...license, expirationDate: '' }).success).toBe(true);
  expect(ProfileLicenseBody.safeParse({ ...license, expirationDate: '', noExpiration: true }).success).toBe(true);
});
