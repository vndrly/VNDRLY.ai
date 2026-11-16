import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MapViewport } from "./map-viewport";

afterEach(() => { cleanup(); Reflect.deleteProperty(window, "ReactNativeWebView"); });

it("escapes a clipped card and returns the same map node, notifying the native shell", () => {
  const postMessage = vi.fn();
  Object.assign(window, { ReactNativeWebView: { postMessage } });
  const view = (expanded: boolean) => <section data-testid="card" style={{ transform: "translateZ(0)", overflow: "hidden" }}><MapViewport expanded={expanded}><div data-testid="map">Map camera</div></MapViewport></section>;
  const { rerender, unmount } = render(view(false));
  const map = screen.getByTestId("map");
  expect(screen.getByTestId("card").contains(map)).toBe(true);
  rerender(view(true));
  expect(screen.getByTestId("map")).toBe(map);
  expect(screen.getByTestId("card").contains(map)).toBe(false);
  expect(document.body.contains(map)).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  expect(JSON.parse(postMessage.mock.lastCall![0])).toEqual({ type: "gate-map-fullscreen", expanded: true });
  rerender(view(false));
  expect(screen.getByTestId("map")).toBe(map);
  expect(screen.getByTestId("card").contains(map)).toBe(true);
  expect(document.body.style.overflow).not.toBe("hidden");
  rerender(view(true));
  unmount();
  expect(JSON.parse(postMessage.mock.lastCall![0]).expanded).toBe(false);
  expect(document.body.contains(map)).toBe(false);
});
