import { it, expect } from "vitest";
import {
  installTransparentScenesStyle,
  TRANSPARENT_SCENE_SELECTOR,
} from "./transparent-scenes";
it("keeps navigation scenes transparent without hiding switch tracks", () => {
  const scene = document.createElement("div"),
    root = document.createElement("div"),
    track = document.createElement("div"),
    input = document.createElement("input");
  scene.className = track.className =
    "r-position-u8s1d r-bottom-1p0dtai r-top-ipm5af";
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  root.append(track, input);
  document.body.append(scene, root);
  expect(scene.matches(TRANSPARENT_SCENE_SELECTOR)).toBe(true);
  expect(track.matches(TRANSPARENT_SCENE_SELECTOR)).toBe(false);
  scene.remove();
  root.remove();
});
it("refreshes an already installed stylesheet instead of retaining the broken rule", () => {
  const old = document.createElement("style");
  old.id = "vndrly-mobile-transparent-scenes";
  old.textContent = "div {color:red}";
  document.head.append(old);
  installTransparentScenesStyle(document);
  expect(old.textContent).toContain(TRANSPARENT_SCENE_SELECTOR);
  expect(
    document.querySelectorAll("#vndrly-mobile-transparent-scenes").length,
  ).toBe(1);
  old.remove();
});
