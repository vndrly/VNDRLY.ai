import { expect, it } from "vitest";
import { formatTrainingTitle } from "./training-title";

it.each([
  ["GateGo | Shared foundation — training assurance", "Shared foundation | Training Assurance"],
  ["L01 — leadership commitment and accountable safety roles", "L01 | Leadership Commitment And Accountable Safety Roles"],
  ["GateGo | Gatekeeping — H2S detector use", "Gatekeeping | H2S Detector Use"],
  ["Shared foundation | Training Assurance", "Shared foundation | Training Assurance"],
  ["Standalone courses", "Standalone courses"],
])("formats %s consistently", (input, expected) => {
  expect(formatTrainingTitle(input)).toBe(expected);
  expect(formatTrainingTitle(expected)).toBe(expected);
});
