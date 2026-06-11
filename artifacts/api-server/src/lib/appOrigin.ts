/** Public web app origin for deep links, QR codes, and email CTAs. */
export function getAppOrigin(): string {
  const raw =
    process.env.PUBLIC_APP_URL?.trim() || process.env.APP_BASE_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  return "http://localhost:5173";
}
