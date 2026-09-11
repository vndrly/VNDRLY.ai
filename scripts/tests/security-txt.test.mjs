import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the public security contact document is complete and canonical", async () => {
  const document = await readFile(
    new URL("../../artifacts/vndrly/public/.well-known/security.txt", import.meta.url),
    "utf8",
  );

  assert.match(document, /^Contact: mailto:security@vndrly\.ai$/m);
  assert.match(document, /^Expires: \d{4}-\d{2}-\d{2}T00:00:00Z$/m);
  assert.match(
    document,
    /^Canonical: https:\/\/vndrly\.ai\/\.well-known\/security\.txt$/m,
  );
  assert.match(document, /^Preferred-Languages: en$/m);
});

test("the web release artifact includes hidden public documents", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/publish.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /name: Upload web build[\s\S]*include-hidden-files:\s*true/,
  );
});
