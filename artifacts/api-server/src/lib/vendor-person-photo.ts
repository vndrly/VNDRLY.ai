/** Build `/api/storage/...` URL from an object store path (`/objects/uploads/...`). */
export function storageApiPathFromObjectPath(objectPath: string): string {
  const normalized = objectPath.startsWith("/") ? objectPath : `/${objectPath}`;
  return `/api/storage${normalized}`;
}

/**
 * Resolve the display URL for a vendor person profile photo.
 * Canonical `profilePhotoPath` wins over legacy `photoUrl` so a stale
 * onboarding URL cannot mask a newer mobile upload.
 */
export function resolveVendorPersonPhotoUrl(
  profilePhotoPath: string | null | undefined,
  photoUrl: string | null | undefined,
): string | null {
  if (profilePhotoPath) {
    if (profilePhotoPath.startsWith("http")) return profilePhotoPath;
    return storageApiPathFromObjectPath(profilePhotoPath);
  }
  return photoUrl ?? null;
}
