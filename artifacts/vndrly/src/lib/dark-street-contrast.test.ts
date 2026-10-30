import { expect, it, vi } from "vitest";
import { applyDarkStreetContrast } from "./dark-street-contrast";

it("brightens dark roads and labels, preserves zoom width stops, and leaves other layers alone", () => {
  const setPaintProperty = vi.fn();
  const map = { getStyle: () => ({ layers: [
    { id:"road-street",type:"line","source-layer":"road",paint:{"line-width":["interpolate",["linear"],["zoom"],10,1,18,8]} },
    { id:"road-primary",type:"line","source-layer":"road" },
    { id:"road-label",type:"symbol","source-layer":"road_label" },
    { id:"building",type:"fill","source-layer":"building" },
    { id:"water",type:"fill","source-layer":"water" },
    { id:"vndrly-lines",type:"line",source:"vndrly-lines" },
  ] }), setPaintProperty };
  applyDarkStreetContrast(map as unknown as Parameters<typeof applyDarkStreetContrast>[0]);
  expect(setPaintProperty).toHaveBeenCalledWith("road-street","line-width",["interpolate",["linear"],["zoom"],10,1.15,18,9.2]);
  expect(setPaintProperty).toHaveBeenCalledWith("road-primary","line-color","#aebbc7");
  expect(setPaintProperty).toHaveBeenCalledWith("road-label","text-color","#e3eaf0");
  expect(setPaintProperty).toHaveBeenCalledWith("building","fill-outline-color","#6a7d8c");
  expect(setPaintProperty.mock.calls.some(([id])=>id==="water"||id==="vndrly-lines")).toBe(false);
  setPaintProperty.mockClear();
  applyDarkStreetContrast(map as unknown as Parameters<typeof applyDarkStreetContrast>[0],false);
  expect(setPaintProperty).toHaveBeenCalledWith("road-street","line-width",["interpolate",["linear"],["zoom"],10,1.15,18,9.2]);
  expect(setPaintProperty).toHaveBeenCalledWith("road-label","text-color","#273747");
  expect(setPaintProperty).toHaveBeenCalledWith("building","fill-outline-color","#7b8d9d");
});
