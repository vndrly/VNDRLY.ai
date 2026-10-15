import { expect, it } from "vitest";
import {
  validateLibraryValues,
  assignmentDeadline,
  publicTraining,
} from "./library-policy";
import { gradeTraining } from "./training-policy";
const question = {
  id: "q",
  prompt: "Choose",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  correctOptionIds: ["a", "b"],
  multiple: true,
};
it("scores exact multiple answer sets and enforces unrounded passing ratio", () => {
  expect(
    gradeTraining(
      { questions: [question], passingPercent: 100 },
      { q: ["a", "b"] },
    ).passed,
  ).toBe(true);
  expect(
    gradeTraining(
      { questions: [question], passingPercent: 100 },
      { q: ["a", "b", "c"] },
    ).passed,
  ).toBe(false);
  expect(() =>
    gradeTraining(
      { questions: [question], passingPercent: 100 },
      { q: ["wrong"] },
    ),
  ).toThrow();
});
it("never sends answer keys in employee training content", () => {
  expect(
    JSON.stringify(publicTraining({ questions: [question] })),
  ).not.toContain("correctOptionIds");
});
it("validates required date and choice fields without accepting unknown values", () => {
  const fields = [
    { id: "date", label: "Date", type: "date", required: true },
    {
      id: "choice",
      label: "Choice",
      type: "choice",
      options: [{ id: "a", label: "A" }],
      required: true,
    },
  ];
  expect(() =>
    validateLibraryValues(fields, { date: "2026-02-30", choice: "a" }),
  ).toThrow();
  expect(() =>
    validateLibraryValues(fields, { date: "2026-10-14", choice: "unknown" }),
  ).toThrow();
  expect(
    validateLibraryValues(fields, { date: "2026-10-14", choice: "a" }),
  ).toEqual({ date: "2026-10-14", choice: "a" });
});
it("starts a new hire policy deadline at assignment but preserves poll close", () => {
  const at = new Date("2026-11-15T12:00:00Z");
  expect(assignmentDeadline("policy", 720, null, at).toISOString()).toBe(
    "2026-12-15T12:00:00.000Z",
  );
  expect(() =>
    assignmentDeadline("poll", 24, "2026-11-14T12:00:00Z", at),
  ).toThrow("closed");
});

import { trainingCompletionReady } from "./training-policy";
it("checkoffs cannot complete training that requires a passing quiz", () => {
  const c = { completionMode: "both", lessons: [{ id: "intro" }] };
  expect(trainingCompletionReady(c, ["intro"], true, false)).toBe(false);
  expect(trainingCompletionReady(c, ["intro"], false, true)).toBe(false);
  expect(trainingCompletionReady(c, ["intro"], true, true)).toBe(true);
});

import { safeLibraryContent } from "./library-policy";
it("employee library preview omits quiz keys and private attachment locators", () => {
  const m = {
    kind: "training",
    content: { training: { questions: [question] } },
    fileSnapshots: {
      file: { storageKey: "private-object", checksumSha256: "private-hash" },
    },
  };
  const employee = JSON.stringify(safeLibraryContent(m as any, false));
  expect(employee).not.toContain("correctOptionIds");
  expect(employee).not.toContain("private-object");
  expect(JSON.stringify(safeLibraryContent(m as any, true))).toContain(
    "correctOptionIds",
  );
  expect(JSON.stringify(safeLibraryContent(m as any, true))).not.toContain(
    "private-object",
  );
});

import { validateTrainingProgress } from "./training-policy";
it("saved quiz progress accepts partial answers but rejects foreign options and repeated selections", () => {
  expect(() =>
    validateTrainingProgress({ questions: [question] }, {}),
  ).not.toThrow();
  expect(() =>
    validateTrainingProgress({ questions: [question] }, { q: [] }),
  ).not.toThrow();
  expect(() =>
    validateTrainingProgress({ questions: [question] }, { q: ["foreign"] }),
  ).toThrow();
  expect(() =>
    validateTrainingProgress({ questions: [question] }, { q: ["a", "a"] }),
  ).toThrow();
  expect(() =>
    validateTrainingProgress(
      { questions: [{ ...question, multiple: false }] },
      { q: ["a", "b"] },
    ),
  ).toThrow();
});

import { shouldReuseLibraryAssignment } from "./library-policy";
it("does not duplicate active obligations on renewal, but can renew completed training",()=>{
 expect(shouldReuseLibraryAssignment("assigned",true,"training")).toBe(true);
 expect(shouldReuseLibraryAssignment("in_progress",true,"policy")).toBe(true);
 expect(shouldReuseLibraryAssignment("completed",true,"training")).toBe(false);
 expect(shouldReuseLibraryAssignment("completed",true,"poll")).toBe(true);
 expect(shouldReuseLibraryAssignment("completed",false,"training")).toBe(true);
});
