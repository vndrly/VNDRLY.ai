import { resolveVendorPersonPhotoUrl } from "../lib/vendor-person-photo";

type VendorPersonPhoto = {
  userId: number | null;
  vendorId: number;
  isActive: boolean;
  deletedAt: Date | null;
  profilePhotoPath: string | null;
  photoUrl: string | null;
};

type PartnerContactPhoto = {
  userId: number | null;
  partnerId: number;
  deletedAt: Date | null;
  photoUrl: string | null;
};

type MeetingParticipantPhotoInput = {
  ownerOrgType: string;
  ownerOrgId: number;
  attendeeUserIds: number[];
  canViewOwnerProfiles: boolean;
  vendorPeople: VendorPersonPhoto[];
  partnerContacts: PartnerContactPhoto[];
};

export function meetingParticipantPhotoUrls({
  ownerOrgType,
  ownerOrgId,
  attendeeUserIds,
  canViewOwnerProfiles,
  vendorPeople,
  partnerContacts,
}: MeetingParticipantPhotoInput): Map<number, string | null> {
  const attendeeIds = new Set(attendeeUserIds);
  const photos = new Map<number, string | null>([...attendeeIds].map((userId) => [userId, null]));
  if (!canViewOwnerProfiles) return photos;

  const candidates = new Map<number, Array<string | null>>();
  const addCandidate = (userId: number | null, photoUrl: string | null) => {
    if (userId === null || !attendeeIds.has(userId)) return;
    candidates.set(userId, [...(candidates.get(userId) ?? []), photoUrl]);
  };

  if (ownerOrgType === "vendor") {
    for (const person of vendorPeople) {
      if (person.vendorId !== ownerOrgId || !person.isActive || person.deletedAt) continue;
      addCandidate(person.userId, resolveVendorPersonPhotoUrl(person.profilePhotoPath, person.photoUrl));
    }
  } else if (ownerOrgType === "partner") {
    for (const contact of partnerContacts) {
      if (contact.partnerId !== ownerOrgId || contact.deletedAt) continue;
      addCandidate(contact.userId, contact.photoUrl);
    }
  }

  for (const [userId, matches] of candidates) {
    if (matches.length === 1) photos.set(userId, matches[0]);
  }
  return photos;
}
