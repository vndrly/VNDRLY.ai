import { describe, expect, it } from "vitest";
import { meetingParticipantPhotoUrls } from "./meeting-participant-photos";

describe("meetingParticipantPhotoUrls", () => {
  it("maps only active undeleted vendor attendees and prefers the canonical profile path", () => {
    const photos = meetingParticipantPhotoUrls({
      ownerOrgType: "vendor",
      ownerOrgId: 22,
      attendeeUserIds: [10, 20, 30, 40, 50, 60, 70],
      canViewOwnerProfiles: true,
      vendorPeople: [
        { userId: 10, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: "/objects/uploads/canonical", photoUrl: "https://legacy.example/10.jpg" },
        { userId: 20, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: null, photoUrl: "https://legacy.example/20.jpg" },
        { userId: 30, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: null, photoUrl: null },
        { userId: 40, vendorId: 22, isActive: true, deletedAt: new Date("2026-09-01T00:00:00Z"), profilePhotoPath: "/objects/uploads/deleted", photoUrl: null },
        { userId: 50, vendorId: 22, isActive: false, deletedAt: null, profilePhotoPath: "/objects/uploads/inactive", photoUrl: null },
        { userId: 60, vendorId: 99, isActive: true, deletedAt: null, profilePhotoPath: "/objects/uploads/other-vendor", photoUrl: null },
        { userId: 70, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: "/objects/uploads/ambiguous-a", photoUrl: null },
        { userId: 70, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: "/objects/uploads/ambiguous-b", photoUrl: null },
        { userId: 80, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: "/objects/uploads/not-an-attendee", photoUrl: null },
      ],
      partnerContacts: [],
    });

    expect(photos).toEqual(new Map([
      [10, "/api/storage/objects/uploads/canonical"],
      [20, "https://legacy.example/20.jpg"],
      [30, null],
      [40, null],
      [50, null],
      [60, null],
      [70, null],
    ]));
  });

  it("uses only undeleted contacts from the owner partner and ignores vendor identity rows", () => {
    const photos = meetingParticipantPhotoUrls({
      ownerOrgType: "partner",
      ownerOrgId: 91,
      attendeeUserIds: [10, 20, 30],
      canViewOwnerProfiles: true,
      vendorPeople: [
        { userId: 20, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: "/objects/uploads/vendor-photo", photoUrl: null },
      ],
      partnerContacts: [
        { userId: 10, partnerId: 91, deletedAt: null, photoUrl: "https://photos.example/partner-10.jpg" },
        { userId: 20, partnerId: 92, deletedAt: null, photoUrl: "https://photos.example/other-partner.jpg" },
        { userId: 30, partnerId: 91, deletedAt: new Date("2026-09-01T00:00:00Z"), photoUrl: "https://photos.example/deleted.jpg" },
        { userId: 40, partnerId: 91, deletedAt: null, photoUrl: "https://photos.example/not-an-attendee.jpg" },
      ],
    });

    expect(photos).toEqual(new Map([
      [10, "https://photos.example/partner-10.jpg"],
      [20, null],
      [30, null],
    ]));
  });

  it("returns no photos when the requester cannot view the owner organization's profiles", () => {
    const photos = meetingParticipantPhotoUrls({
      ownerOrgType: "vendor",
      ownerOrgId: 22,
      attendeeUserIds: [10, 20],
      canViewOwnerProfiles: false,
      vendorPeople: [
        { userId: 10, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: "/objects/uploads/private", photoUrl: null },
      ],
      partnerContacts: [],
    });

    expect(photos).toEqual(new Map([
      [10, null],
      [20, null],
    ]));
  });
});
