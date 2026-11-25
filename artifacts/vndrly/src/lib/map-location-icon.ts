/** Brandable vector silhouettes; currentColor comes from the marker's brand. */
export function mapLocationIcon(kind: "gate" | "site") {
  const shape = kind === "gate"
    ? '<path d="M4 27V13h6v14M23 27V13h5v14M9 16h15v6H9z"/><path d="m11 21 4-5m3 5 4-5" stroke="#24343b" stroke-width="2"/><path d="M3 12V7l4-3 5 3v5z"/>'
    : '<path d="M3 27h26v3H3zM12 27l4-17 5 17h-4l-1-7-1 7zM5 10 25 3l3 3-2 9-4-2 1-5L6 14z"/><path d="M6 14v12M26 15v12M12 21h8" fill="none"/>';
  return `<svg class="vndrly-map-location-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true"><g fill="currentColor" stroke="#fff" stroke-width="1.5" stroke-linejoin="round">${shape}</g></svg>`;
}
