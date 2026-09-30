/**
 * Preserve native provenance while giving the dedicated Ask V screen the
 * complete, role-filtered Work Hub toolbox. Other screens stay page-scoped.
 */
export function nativeAskVContextPath(pathname: string): string {
  const raw = pathname.trim().split(/[?#]/)[0] || "/";
  const withoutGroups = raw.replace(/\/\([^/]+\)/g, "");
  const normalized = withoutGroups.startsWith("/") ? withoutGroups : `/${withoutGroups}`;
  if (normalized === "/mobile" || normalized.startsWith("/mobile/")) {
    return normalized;
  }
  if (normalized === "/askv" || normalized === "/work-hub/askv") {
    return "/mobile/work-hub/askv";
  }
  return `/mobile${normalized === "/" ? "" : normalized}` || "/mobile";
}
