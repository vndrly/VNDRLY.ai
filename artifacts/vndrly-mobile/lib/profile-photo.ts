import { getApiBase } from "./api";

export function resolveStoragePath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.startsWith("/api/")) return `${getApiBase()}${normalized}`;
  return `${getApiBase()}/api/storage${normalized}`;
}

/** Prefer canonical storage path over legacy direct photoUrl. */
export function resolveProfilePhotoUrl(
  profilePhotoPath: string | null | undefined,
  photoUrl: string | null | undefined,
): string | null {
  return resolveStoragePath(profilePhotoPath) ?? resolveStoragePath(photoUrl);
}

export function isVndrlyStoragePhotoUrl(url: string): boolean {
  const base = getApiBase().replace(/\/$/, "");
  return url.startsWith(base) && url.includes("/api/storage/");
}
