import React from "react";
import { afterEach, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LibraryBody } from "./library-body";
afterEach(cleanup);
it("renders authored sections, form tables and direct Library links as readable content", () => {
  render(<LibraryBody color="black" text={'## Required practice\n\n- **Stop** when controls fail.\n\n| Field | Entry |\n|---|---|\n| Owner | Fictional lead |\n\nPolicy\nhttps://vndrly.ai/work-hub/library/00000000-0000-4000-8000-000000000001'}/>);
  expect(screen.getByRole("heading",{name:"Required practice"})).toBeTruthy();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByRole("cell",{name:"Fictional lead"})).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toContain("/work-hub/library/");
});
it("treats HTML and unsafe link syntax as text rather than executable content", () => {
  const {container}=render(<LibraryBody color="black" text={'<script>bad()</script>\n\n[Unsafe](javascript:bad())'}/>);
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("a")).toBeNull();
  expect(screen.getByText("<script>bad()</script>")).toBeTruthy();
});
