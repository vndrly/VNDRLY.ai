import type { Request } from "express";

/** Turn `/api/storage/upload/:id` into an absolute URL for mobile clients. */
export function absoluteUploadUrl(req: Request, uploadURL: string): string {
  if (/^https?:\/\//i.test(uploadURL)) return uploadURL;
  const configured = process.env.PUBLIC_API_BASE?.replace(/\/$/, "");
  if (configured) {
    return `${configured}${uploadURL.startsWith("/") ? uploadURL : `/${uploadURL}`}`;
  }
  const host = req.get("x-forwarded-host") || req.get("host");
  const proto =
    req.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host?.includes("localhost") ? "http" : "https");
  if (host) {
    return `${proto}://${host}${uploadURL.startsWith("/") ? uploadURL : `/${uploadURL}`}`;
  }
  return uploadURL;
}
