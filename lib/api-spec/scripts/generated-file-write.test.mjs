import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retryGeneratedWrite } from "./generated-file-write.mjs";

test("recovers a transient file-open failure and writes the complete generated content", () => {
  const directory = mkdtempSync(join(tmpdir(), "vndrly-codegen-"));
  const target = join(directory, "output.ts");
  let attempts = 0;
  try {
    retryGeneratedWrite(() => {
      if (attempts++ === 0)
        throw Object.assign(new Error("Sharing violation"), {
          code: "UNKNOWN",
        });
      writeFileSync(target, "export const complete = true;\n");
    });
    assert.equal(
      readFileSync(target, "utf8"),
      "export const complete = true;\n",
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("does not hide permanent errors or retry them", () => {
  let attempts = 0;
  assert.throws(
    () =>
      retryGeneratedWrite(() => {
        attempts++;
        throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
      }),
    /Disk full/,
  );
  assert.equal(attempts, 1);
});

test("fails visibly if transient file-open errors persist", () => {
  assert.throws(
    () =>
      retryGeneratedWrite(() => {
        throw Object.assign(new Error("Still busy"), { code: "EBUSY" });
      }),
    /Still busy/,
  );
});
