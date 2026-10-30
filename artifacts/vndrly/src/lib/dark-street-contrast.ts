import type { Map, ExpressionSpecification } from "mapbox-gl";

/** Preserve zoom-dependent widths while giving smaller roads a modest lift. */
function strongerWidth(value: unknown): number | ExpressionSpecification | undefined {
  if (typeof value === "number") return value * 1.15;
  if (!Array.isArray(value)) return undefined;
  const expression = [...value];
  // Zoom expressions must remain at the root of the paint expression.
  if (expression[0] === "interpolate") {
    for (let index = 4; index < expression.length; index += 2) {
      expression[index] = typeof expression[index] === "number" ? expression[index] * 1.15 : ["*", expression[index], 1.15];
    }
    return expression as ExpressionSpecification;
  }
  if (expression[0] === "step") {
    for (let index = 2; index < expression.length; index += 2) {
      expression[index] = typeof expression[index] === "number" ? expression[index] * 1.15 : ["*", expression[index], 1.15];
    }
    return expression as ExpressionSpecification;
  }
  return ["*", value, 1.15] as ExpressionSpecification;
}

/** Keep enhanced street detail in either palette, before company overlays are added. */
export function applyDarkStreetContrast(map: Pick<Map, "getStyle" | "setPaintProperty">, dark = true) {
  for (const layer of map.getStyle()?.layers ?? []) {
    const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
    if (layer.type === "line" && sourceLayer === "road" && !/rail|ferry/.test(layer.id)) {
      const casing = /casing|outline/.test(layer.id);
      const major = /motorway|trunk|primary/.test(layer.id);
      map.setPaintProperty(layer.id, "line-color", dark ? casing ? "#18212a" : major ? "#aebbc7" : "#788c9d" : casing ? "#f4f6f8" : major ? "#506578" : "#7a8997");
      if (/street|minor|service|secondary|tertiary/.test(layer.id)) {
        const width = strongerWidth(layer.paint?.["line-width"]);
        if (width !== undefined) map.setPaintProperty(layer.id, "line-width", width);
      }
    } else if (layer.type === "symbol" && (sourceLayer === "road_label" || sourceLayer === "road" || /road.*label/.test(layer.id))) {
      map.setPaintProperty(layer.id, "text-color", dark ? "#e3eaf0" : "#273747");
      map.setPaintProperty(layer.id, "text-halo-color", dark ? "#111820" : "#ffffff");
    } else if (layer.type === "fill" && sourceLayer === "building") {
      map.setPaintProperty(layer.id, "fill-color", dark ? "#34424d" : "#c7d0d8");
      map.setPaintProperty(layer.id, "fill-outline-color", dark ? "#6a7d8c" : "#7b8d9d");
    }
  }
}
