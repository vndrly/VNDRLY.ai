/** Equipment mutations store the canonical private-storage route, never an API origin. */
export function equipmentPhotoPath(objectPath: string, apiBase: string): string {
  const base = new URL(apiBase), url = new URL(objectPath, base);
  if (url.origin !== base.origin || url.search || url.hash) throw new Error("Unexpected equipment photo path");
  const path = url.pathname.startsWith("/objects/uploads/") ? `/api/storage${url.pathname}` : url.pathname;
  if (!/^\/api\/storage\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)) throw new Error("Unexpected equipment photo path");
  return path;
}
