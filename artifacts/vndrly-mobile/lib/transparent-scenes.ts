// React Native Web switches share absolute-position classes with navigation
// scenes. Their track has a following native checkbox and must retain its fill.
export const TRANSPARENT_SCENE_SELECTOR =
  'div[class*="r-position-u8s1d"][class*="r-bottom-1p0dtai"][class*="r-top-ipm5af"]:not(:has(~ input[role="switch"]))';
export function installTransparentScenesStyle(doc: Document) {
  const id = "vndrly-mobile-transparent-scenes";
  const style =
    (doc.getElementById(id) as HTMLStyleElement | null) ??
    doc.createElement("style");
  style.id = id;
  // Replace retained CSS on Fast Refresh as well as installing on first entry.
  style.textContent = `${TRANSPARENT_SCENE_SELECTOR}{background-color:transparent !important;}`;
  if (!style.parentNode) doc.head.appendChild(style);
}
