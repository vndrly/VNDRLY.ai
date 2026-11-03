import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const now = Date.parse("2026-11-03T12:00:00Z");
const course = (days: number, complete = false) => ({ id: String(days), title: "L01 — leadership", assignedAt: new Date(now - days * 86_400_000).toISOString(), complete });
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ dataUpdatedAt: now, data: { people: [{ userId: 7, name: "Alex", courses: [course(15)] }] } }) }));
vi.mock("./repository-client", () => ({ useRepository: () => ({ user: { userId: 1 }, owner: { type: "vendor", id: 1 } }) }));
import TeamTrainingProgress, { personTrainingStatus } from "./team-training-progress";
afterEach(cleanup);
it.each([[7, "#22c55e"], [7.01, "#f59e0b"], [14, "#f59e0b"], [14.01, "#f87171"]])("colors unfinished work at %s days", (days, color) => {
  expect(personTrainingStatus([course(days)], now).color).toBe(color);
});
it("keeps completed old work green and distinguishes no assignments", () => {
  expect(personTrainingStatus([course(30, true)], now).color).toBe("#22c55e");
  expect(personTrainingStatus([], now).label).toBe("No assigned training");
});
it("renders collapsed people and course lists without steppers", () => {
  render(<TeamTrainingProgress />);
  expect(document.querySelector("details[open]")).toBeNull();
  fireEvent.click(screen.getByText("Team Training"));
  fireEvent.click(screen.getByText("Alex"));
  expect(screen.getByRole("list", { name: "Alex courses" })).toBeTruthy();
  expect(screen.getByText("L01 | Leadership")).toBeTruthy();
  expect(document.querySelector("[aria-current=step]")).toBeNull();
});
