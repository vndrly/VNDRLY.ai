import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const geoPath =
  process.argv[2] ??
  path.join(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../../.cursor/projects/c-Users-JohnElerick-DEV-VNDRLY-ai/agent-tools/e3166e80-a7fe-440c-9dc2-3a757eb28a7c.txt",
  );

const geo = JSON.parse(fs.readFileSync(geoPath, "utf8"));
const us = geo.features.find((f) => f.properties.ADMIN === "United States of America");
if (!us) {
  console.error("United States feature not found");
  process.exit(1);
}

const w = 959;
const h = 593;
const pad = 24;
const lonMin = -125;
const lonMax = -66;
const latMin = 24;
const latMax = 50;

const proj = ([lon, lat]) => [
  pad + ((lon - lonMin) / (lonMax - lonMin)) * (w - 2 * pad),
  pad + (1 - (lat - latMin) / (latMax - latMin)) * (h - 2 * pad),
];

function ringToPath(ring) {
  return (
    ring
      .map((c, i) => `${i === 0 ? "M" : "L"}${proj(c).map((n) => n.toFixed(1)).join(",")}`)
      .join(" ") + " Z"
  );
}

const rings =
  us.geometry.type === "MultiPolygon"
    ? us.geometry.coordinates.flat()
    : [us.geometry.coordinates[0]];

const scored = rings.map((r) => {
  const area = Math.abs(
    r.reduce((acc, c, i, arr) => {
      const [x1, y1] = proj(arr[i]);
      const [x2, y2] = proj(arr[(i + 1) % arr.length]);
      return acc + x1 * y2 - x2 * y1;
    }, 0) / 2,
  );
  return { r, area };
});
scored.sort((a, b) => b.area - a.area);
const dPath = ringToPath(scored[0].r);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="none" aria-hidden="true">
  <defs>
    <pattern id="us-halftone-dots" width="7" height="7" patternUnits="userSpaceOnUse">
      <circle cx="3.5" cy="3.5" r="1.35" fill="#ffffff" fill-opacity="0.95"/>
    </pattern>
  </defs>
  <path d="${dPath}" fill="url(#us-halftone-dots)"/>
</svg>
`;

const out = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../attached_assets/nav-pane-us-halftone.svg",
);
fs.writeFileSync(out, svg);
console.log(`Wrote ${out} (${dPath.length} path chars)`);
